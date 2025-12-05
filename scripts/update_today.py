import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
import numpy as np
import json

# 로컬 테스트용
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
# [수정] 키 이름 변경: SUPABASE_SERVICE_KEY -> SUPABASE_SERVICE_ROLE_KEY
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류: Supabase URL 또는 Key가 설정되지 않았습니다.")
    exit()

supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 (주가 + 가중 RS) 시작!")

# ---------------------------------------------------------
# 1. 종목 리스트 로딩 & DB 이름 동기화
# ---------------------------------------------------------
print("1. 종목 리스트 및 DB 동기화...")
try:
    # 'KRX' 옵션 사용
    df_krx = fdr.StockListing('KRX')
    
    # 'Sector' 대신 'Name'을 분석해서 필터링
    filter_mask = (
        ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False) & 
        ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
    )
    
    real_companies = df_krx[filter_mask]
    
    companies_data = []
    for _, row in real_companies.iterrows():
        companies_data.append({
            "code": str(row['Code']),
            "name": row['Name'],
            "market": row['Market']
        })
    
    chunk_size = 1000
    for i in range(0, len(companies_data), chunk_size):
        chunk = companies_data[i:i + chunk_size]
        supabase.table("companies").upsert(chunk).execute()
        
    target_stocks = real_companies[['Code', 'Name']].to_dict('records')
    print(f"✅ 대상 종목: {len(target_stocks)}개 (필터링 완료)")

except Exception as e:
    print(f"❌ 1단계(종목 리스트) 실패: {e}")
    exit()

# ---------------------------------------------------------
# 2. 데이터 수집 & 가중 RS 계산
# ---------------------------------------------------------
TODAY = datetime.now()
START_DATE = (TODAY - timedelta(days=380)).strftime('%Y-%m-%d')

print(f"2. {START_DATE} ~ 오늘 데이터 분석 중...")

failed_list = []
daily_data_list = []
rs_calc_list = []

total_count = len(target_stocks)

for idx, stock in enumerate(target_stocks):
    code = str(stock['Code'])
    name = stock['Name']
    
    if idx % 50 == 0:
        print(f"[{idx+1}/{total_count}] {name}({code}) 처리 중...")

    try:
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        # [수정] 거래정지 종목 필터링 (최근 5일간 거래량 합계 0이면 제외)
        # 에이디칩스 등 거래정지 중 감자/액면분할로 가격만 튀는 경우 방지
        recent_vol_sum = df['Volume'].tail(5).sum()
        
        if df.empty or len(df) < 253: 
            # 데이터 부족 시 최신 주가만 저장하고 RS는 스킵
            pass
        elif recent_vol_sum == 0:
            print(f"⚠️ [Suspended] {name}({code}): 최근 5일 거래량 0. RS 제외.")
            # 거래정지 종목은 RS 계산 제외
            pass
        else:
            price_now = float(df['Close'].iloc[-1])
            
            def get_past_price(days_ago):
                if len(df) > days_ago:
                    return float(df['Close'].iloc[-days_ago - 1])
                return None # 데이터 부족 시 None 반환

            price_3m = get_past_price(63)
            price_6m = get_past_price(126)
            price_9m = get_past_price(189)
            price_12m = get_past_price(252)

            if None not in [price_3m, price_6m, price_9m, price_12m]:
                def calc_ret(p_new, p_old):
                    if p_old == 0: return 0.0
                    return (p_new - p_old) / p_old

                ret_q1 = calc_ret(price_now, price_3m)
                ret_q2 = calc_ret(price_3m, price_6m)
                ret_q3 = calc_ret(price_6m, price_9m)
                ret_q4 = calc_ret(price_9m, price_12m)

                weighted_score = (0.4 * ret_q1) + (0.2 * ret_q2) + (0.2 * ret_q3) + (0.2 * ret_q4)
                
                rs_calc_list.append({
                    "code": code,
                    "score": weighted_score
                })
                
                # [디버깅] 점수가 너무 높으면 로그 출력
                if weighted_score > 2.0: # 200% 이상 상승 효과
                    print(f"⚠️ [High RS] {name}({code}): Score={weighted_score:.2f}, Now={price_now}, 1Y={price_12m}")

        
        df_recent = df.tail(5).reset_index()
        
        # [수정] 날짜 변환 오류 방지
        latest_date_str = pd.to_datetime(df_recent['Date'].iloc[-1]).strftime('%Y-%m-%d')

        for _, row in df_recent.iterrows():
            d_str = pd.to_datetime(row['Date']).strftime('%Y-%m-%d')
            
            # [중요] 오늘(최신) 날짜 데이터만 업로드 리스트에 추가
            # 과거 데이터를 같이 올리면 RS 점수가 null로 덮어씌워질 위험이 있음
            if d_str != latest_date_str:
                continue

            daily_data_list.append({
                "code": code,
                "date_str": d_str,
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume']),
                "weighted_score": weighted_score # 오늘 날짜이므로 점수 할당
            })
            
        rs_calc_list.append({
            "code": code,
            "score": weighted_score
        })

    except Exception as e:
        failed_list.append(code)
        
    if idx % 50 == 0: time.sleep(0.5)

# ---------------------------------------------------------
# 3. 랭킹 산정 및 매핑
# ---------------------------------------------------------
print("3. 가중 RS 랭킹(1~99) 산정 중...")

if rs_calc_list:
    df_rank = pd.DataFrame(rs_calc_list)
    df_rank['rs_rating'] = df_rank['score'].rank(pct=True) * 99
    df_rank['rs_rating'] = df_rank['rs_rating'].fillna(0).round().astype(int).clip(1, 99)
    
    rs_map = df_rank.set_index('code')['rs_rating'].to_dict()
    
    final_upload_data = []
    
    for item in daily_data_list:
        final_rs = None
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
            "rs_rating": final_rs 
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
            print(f"   ❌ 업로드 청크 실패: {e}")
            time.sleep(2)

print(f"\n🎉 오늘의 업데이트(가중 RS 포함) 완료! (실패: {len(failed_list)}건)")