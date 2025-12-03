import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
import numpy as np

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 (주가 + 가중 RS) 시작!")

# ---------------------------------------------------------
# 1. 종목 리스트 로딩 & DB 이름 동기화
# ---------------------------------------------------------
print("1. 종목 리스트 및 DB 동기화...")
try:
    df_krx = fdr.StockListing('KRX')
    real_companies = df_krx[df_krx['Sector'].notnull()]
    
    # 이름 변경 등 최신 정보 업데이트
    companies_data = []
    for _, row in real_companies.iterrows():
        companies_data.append({
            "code": row['Code'],
            "name": row['Name'],
            "market": row['Market']
        })
    
    chunk_size = 1000
    for i in range(0, len(companies_data), chunk_size):
        chunk = companies_data[i:i + chunk_size]
        supabase.table("companies").upsert(chunk).execute()
        
    target_stocks = real_companies[['Code', 'Name']].to_dict('records')
    print(f"✅ 대상 종목: {len(target_stocks)}개")

except Exception as e:
    print(f"❌ 실패: {e}")
    exit()

# ---------------------------------------------------------
# 2. 데이터 수집 & 가중 RS 계산
# ---------------------------------------------------------
# 가중 RS를 계산하려면 최소 1년 전 데이터가 필요함
TODAY = datetime.now()
START_DATE = (TODAY - timedelta(days=380)).strftime('%Y-%m-%d') # 넉넉하게 380일 전

print(f"2. {START_DATE} ~ 오늘 데이터 분석 중 (시간 소요됨)...")

failed_list = []
daily_data_list = [] # DB에 넣을 최종 데이터 (오늘자)
rs_calc_list = []    # 랭킹 산정용 리스트

total_count = len(target_stocks)

for idx, stock in enumerate(target_stocks):
    code = stock['Code']
    name = stock['Name']
    
    if idx % 50 == 0:
        print(f"[{idx+1}/{total_count}] 진행 중...")

    try:
        # 1년 치 데이터 가져오기 (가중 RS 계산을 위해)
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty or len(df) < 5: continue

        # --- [가중 RS 계산 로직] ---
        # 데이터프레임의 마지막(오늘)을 기준으로 과거 시점 찾기
        # 영업일 기준: 1달=21일, 3달=63일
        
        price_now = df['Close'].iloc[-1]
        
        # 데이터가 충분한지 확인하고 시점별 가격 추출
        # (데이터가 부족하면 가장 첫 날짜 데이터 사용)
        def get_past_price(days_ago):
            if len(df) > days_ago:
                return df['Close'].iloc[-days_ago - 1]
            else:
                return df['Close'].iloc[0]

        price_3m = get_past_price(63)
        price_6m = get_past_price(126)
        price_9m = get_past_price(189)
        price_12m = get_past_price(252)

        # 수익률 계산 (가격이 0이면 0 처리)
        def calc_ret(p_new, p_old):
            if p_old == 0: return 0
            return (p_new - p_old) / p_old

        ret_q1 = calc_ret(price_now, price_3m)
        ret_q2 = calc_ret(price_3m, price_6m)
        ret_q3 = calc_ret(price_6m, price_9m)
        ret_q4 = calc_ret(price_9m, price_12m)

        # 가중 합산 점수 (Weighted Score)
        weighted_score = (0.4 * ret_q1) + (0.2 * ret_q2) + (0.2 * ret_q3) + (0.2 * ret_q4)
        
        # ---------------------------

        # DB에 저장할 데이터 준비 (최근 5일 치만 갱신 - 안전하게)
        # 하지만 RS 점수는 '오늘' 데이터에만 매기면 됨.
        
        # 최근 5일치 데이터를 리스트에 담음
        df_recent = df.tail(5).reset_index()
        latest_date_str = df_recent['Date'].iloc[-1].strftime('%Y-%m-%d')

        for _, row in df_recent.iterrows():
            d_str = row['Date'].strftime('%Y-%m-%d')
            
            # 일단 리스트에 담아둠 (RS 점수는 랭킹 후 채움)
            daily_data_list.append({
                "code": code,
                "date_str": d_str,
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume']),
                "weighted_score": weighted_score if d_str == latest_date_str else None # 임시 점수
            })
            
        # 랭킹용 리스트에 추가 (오늘 날짜, 코드, 점수)
        rs_calc_list.append({
            "code": code,
            "score": weighted_score
        })

    except Exception as e:
        failed_list.append(code)
        
    # 속도 조절 (너무 빠르면 차단)
    if idx % 50 == 0: time.sleep(0.5)

# ---------------------------------------------------------
# 3. 랭킹 산정 및 매핑
# ---------------------------------------------------------
print("3. 가중 RS 랭킹(1~99) 산정 중...")

if rs_calc_list:
    df_rank = pd.DataFrame(rs_calc_list)
    # 점수 기준 랭킹 (Percentile)
    df_rank['rs_rating'] = df_rank['score'].rank(pct=True) * 99
    df_rank['rs_rating'] = df_rank['rs_rating'].fillna(0).round().astype(int).clip(1, 99)
    
    # 코드별 RS 점수 맵 { '005930': 85, ... }
    rs_map = df_rank.set_index('code')['rs_rating'].to_dict()
    
    # 최종 업로드용 리스트 생성
    final_upload_data = []
    
    for item in daily_data_list:
        final_rs = None
        # 이 데이터가 '오늘(최신)' 데이터이고, 랭킹 맵에 점수가 있다면
        if item['weighted_score'] is not None and item['code'] in rs_map:
            final_rs = rs_map[item['code']]
            
        final_upload_data.append({
            "code": item['code'],
            "date_str": item['date_str'],
            "open": item['open'],
            "high": item['high'],
            "low": item['low'],
            "close": item['close'],
            "volume": item['volume'],
            "rs_rating": final_rs # ★ 최종 결정된 등수
        })

    # ---------------------------------------------------------
    # 4. DB 업로드
    # ---------------------------------------------------------
    print(f"4. DB 업로드 시작 ({len(final_upload_data)}건)...")
    
    chunk_size = 1000
    for i in range(0, len(final_upload_data), chunk_size):
        chunk = final_upload_data[i:i + chunk_size]
        try:
            supabase.table("daily_prices").upsert(chunk, on_conflict="code, date_str").execute()
        except Exception as e:
            print(f"   ❌ 업로드 실패: {e}")
            time.sleep(5)

print(f"\n🎉 오늘의 업데이트(가중 RS 포함) 완료! (실패: {len(failed_list)}건)")