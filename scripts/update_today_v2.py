import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
from pykrx import stock as krx_stock  # pykrx 추가

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 V2 (pykrx 수정주가 반영) 시작!")

# 1. 종목 리스트 (KRX 전체) - 리스트는 FDR이 빠르고 편해서 유지
df_krx = fdr.StockListing('KRX')
# 우선주, 스팩 등 제외
filter_mask = (
    ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False) & 
    ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
)
# [수정] Marcap(시가총액)도 포함하여 데이터 추출
target_stocks_df = df_krx[filter_mask][['Code', 'Name', 'Market', 'Marcap']]
target_stocks = target_stocks_df.to_dict('records')

print(f"✅ 대상 종목: {len(target_stocks)}개")

# [신규] Companies 테이블 업데이트 (시가총액 포함)
print("   Companies 테이블 동기화 중...")
company_upload_list = []
for stock in target_stocks:
    company_upload_list.append({
        "code": str(stock['Code']),
        "name": stock['Name'],
        "market": stock['Market'],
        "marcap": float(stock['Marcap']) if not pd.isna(stock['Marcap']) else 0
    })

# 1000개씩 나누어 업로드
for i in range(0, len(company_upload_list), 1000):
    chunk = company_upload_list[i:i+1000]
    supabase.table("companies").upsert(chunk).execute()

# 기준일 설정 (오늘)
TODAY = datetime.now().strftime('%Y%m%d') # pykrx는 YYYYMMDD 포맷 사용
# 비교를 위해 넉넉히 10일 전부터 가져옴
CHECK_START_DATE = (datetime.now() - timedelta(days=10)).strftime('%Y%m%d')
FULL_START_DATE = '20150101' # 재적재 시 시작일

success_count = 0
updated_count = 0 # 수정주가 반영 건수

for idx, stock in enumerate(target_stocks):
    code = str(stock['Code'])
    name = stock['Name']
    
    if idx % 50 == 0:
        print(f"[{idx+1}/{len(target_stocks)}] {name}({code}) 진행 중...")

    try:
        # 1. 내 DB의 최신 데이터 조회 (1건)
        res = supabase.table('daily_prices_v2') \
            .select('date, close') \
            .eq('code', code) \
            .order('date', desc=True) \
            .limit(1) \
            .execute()
            
        db_last_data = res.data[0] if res.data else None
        
        # 2. pykrx 데이터 조회 (최근 데이터, 수정주가 적용)
        # get_market_ohlcv(시작일, 종료일, 종목코드, adjusted=True)
        try:
            df_recent = krx_stock.get_market_ohlcv(CHECK_START_DATE, TODAY, code, adjusted=True)
        except Exception as e:
            # 상장폐지나 거래정지 등으로 데이터 못 가져올 때
            continue
        
        if df_recent.empty:
            continue

        # pykrx 컬럼명: 시가, 고가, 저가, 종가, 거래량, 등락률, (수정종가 - 없음, 종가에 반영됨)
        # 인덱스: 날짜 (datetime)

        need_full_reload = False
        
        if db_last_data:
            db_date_str = db_last_data['date'] # YYYY-MM-DD
            db_date = datetime.strptime(db_date_str, '%Y-%m-%d')
            db_close = float(db_last_data['close'])
            
            # pykrx 데이터 프레임 인덱스에서 DB 날짜 찾기
            if db_date in df_recent.index:
                krx_close = float(df_recent.loc[db_date]['종가'])
                
                # [핵심] 가격 불일치 확인 (1% 이상 차이나면 수정주가로 간주)
                if abs(krx_close - db_close) / db_close > 0.01:
                    print(f"   🔄 [수정주가 감지] {name}: DB({db_close}) != KRX({krx_close}). 전체 재적재...")
                    need_full_reload = True
            else:
                pass
        else:
            # DB에 데이터 없으면 전체 적재
            print(f"   ✨ [신규] {name}: 데이터 없음. 전체 적재...")
            need_full_reload = True

        # 3. 데이터 적재 실행
        if need_full_reload:
            updated_count += 1
            # 전체 데이터 다시 가져오기 (pykrx)
            time.sleep(0.5) # 너무 잦은 요청 방지
            df_full = krx_stock.get_market_ohlcv(FULL_START_DATE, TODAY, code, adjusted=True)
            if df_full.empty: continue
            
            upload_list = []
            for d, r in df_full.iterrows():
                upload_list.append({
                    "code": code,
                    "date": d.strftime('%Y-%m-%d'),
                    "open": int(r['시가']),
                    "high": int(r['고가']),
                    "low": int(r['저가']),
                    "close": int(r['종가']),
                    "volume": int(r['거래량']),
                    # pykrx는 '등락률'을 주지만, 여기선 계산하거나 0으로 둠 (DB 스키마에 change가 있다면)
                    # 여기서는 안전하게 등락률(Change)을 사용 (pykrx는 퍼센트로 줌. 예: 1.5)
                    # 하지만 기존 로직과 맞추기 위해 등락률 컬럼이 있는지 확인 필요
                    # get_market_ohlcv 기본 컬럼: 시가, 고가, 저가, 종가, 거래량 (등락률은 옵션에 따라 다름)
                    # 보통 등락률 계산해서 넣거나 생략. 여기선 0.0으로 처리하거나 계산
                    "change": 0.0 
                })
            
            # 청크 업로드
            for i in range(0, len(upload_list), 1000):
                chunk = upload_list[i:i+1000]
                supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
                
        else:
            # [일반 모드] DB에 없는 최신 데이터만 추가 (Append)
            if db_last_data:
                last_db_date = datetime.strptime(db_last_data['date'], '%Y-%m-%d')
                df_new = df_recent[df_recent.index > last_db_date]
            else:
                df_new = df_recent

            if df_new.empty:
                continue
                
            upload_list = []
            for d, r in df_new.iterrows():
                upload_list.append({
                    "code": code,
                    "date": d.strftime('%Y-%m-%d'),
                    "open": int(r['시가']),
                    "high": int(r['고가']),
                    "low": int(r['저가']),
                    "close": int(r['종가']),
                    "volume": int(r['거래량']),
                    "change": 0.0
                })
            
            if upload_list:
                supabase.table("daily_prices_v2").upsert(upload_list, on_conflict="code, date").execute()
                
        success_count += 1

    except Exception as e:
        print(f"   ❌ 에러 {name}: {e}")
        time.sleep(1)

print(f"\n🎉 업데이트 완료! (성공: {success_count}, 수정주가 보정: {updated_count})")
