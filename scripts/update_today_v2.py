import os
import requests
import json
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
from pykrx import stock as krx_stock

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not url or not key:
    print("❌ Supabase 환경변수 오류")
    exit()

if not APP_KEY or not APP_SECRET:
    print("❌ 한국투자증권 API 환경변수 오류")
    print("   .env.local에 KIS_APP_KEY와 KIS_APP_SECRET을 추가해주세요.")
    exit()

supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 V2 (한국투자증권 API 거래대금 적용) 시작!")

# ========================================
# 한국투자증권 API 토큰 발급
# ========================================
def get_kis_token():
    """한국투자증권 API 접근 토큰 발급"""
    token_url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
    token_headers = {"content-type": "application/json"}
    token_body = {
        "grant_type": "client_credentials",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET
    }

    try:
        response = requests.post(token_url, headers=token_headers, data=json.dumps(token_body))
        response.raise_for_status()
        token_data = response.json()

        if "access_token" in token_data:
            return token_data["access_token"]
        else:
            print(f"❌ 토큰 발급 실패: {token_data}")
            return None
    except Exception as e:
        print(f"❌ 토큰 발급 에러: {e}")
        return None

# ========================================
# 한국투자증권 API 거래대금 조회
# ========================================
def get_trading_value_from_kis(code, start_date, end_date, access_token):
    """
    한국투자증권 API로 특정 기간의 거래대금 조회

    Args:
        code: 종목코드 (6자리)
        start_date: 시작일 (YYYYMMDD)
        end_date: 종료일 (YYYYMMDD)
        access_token: API 토큰

    Returns:
        dict: {날짜(YYYY-MM-DD): 거래대금}
    """
    quote_url = "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {access_token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKST03010100"
    }

    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
        "FID_ORG_ADJ_PRC": "0"
    }

    try:
        time.sleep(0.05)  # API 제한 대비
        response = requests.get(quote_url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        trading_value_dict = {}

        if data.get("rt_cd") == "0" and "output2" in data:
            for item in data["output2"]:
                date_str = item.get("stck_bsop_date", "")
                trading_value = int(item.get("acml_tr_pbmn", "0"))

                if date_str and trading_value > 0:
                    formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                    trading_value_dict[formatted_date] = trading_value

        return trading_value_dict

    except Exception as e:
        # 에러 발생시 빈 딕셔너리 반환
        return {}

# ========================================
# 지수 데이터 업데이트 (KOSPI, KOSDAQ)
# ========================================
def update_indices():
    print("\n📊 시장 지수(KOSPI, KOSDAQ) 업데이트 중...")
    
    # 최근 2년치 데이터 로드 (RS 계산 등을 위해 충분히)
    start_date = (datetime.now() - timedelta(days=730)).strftime('%Y%m%d')
    end_date = datetime.now().strftime('%Y%m%d')
    
    indices = [
        {'ticker': '1001', 'code': 'KOSPI', 'name': 'KOSPI'},
        {'ticker': '2001', 'code': 'KOSDAQ', 'name': 'KOSDAQ'}
    ]
    
    for idx in indices:
        try:
            print(f"   - {idx['name']} 데이터 수집 중...")
            df = krx_stock.get_index_ohlcv_by_date(start_date, end_date, idx['ticker'])
            
            if df.empty:
                print(f"     ⚠️ 데이터 없음")
                continue
                
            # daily_prices_v2 포맷에 맞게 변환
            upload_list = []
            for d, row in df.iterrows():
                date_str = d.strftime('%Y-%m-%d')
                
                # pykrx index 데이터 컬럼: 시가, 고가, 저가, 종가, 거래량, 거래대금, 상장시가총액
                # trading_value가 있으므로 활용
                
                upload_list.append({
                    "code": idx['code'],
                    "date": date_str,
                    "open": float(row['시가']),
                    "high": float(row['고가']),
                    "low": float(row['저가']),
                    "close": float(row['종가']),
                    "volume": float(row['거래량']),
                    "trading_value": float(row['거래대금']), 
                    "change": 0 # 등락률은 직접 계산하거나 생략
                })
            
            # 업로드
            if upload_list:
                for i in range(0, len(upload_list), 1000):
                    chunk = upload_list[i:i+1000]
                    supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
                print(f"     ✅ {len(upload_list)}건 업로드 완료")
                
                # companies 테이블에도 등록 (이름 표시용)
                supabase.table("companies").upsert({
                    "code": idx['code'],
                    "name": idx['name'],
                    "market": "INDEX",
                    "marcap": 0
                }).execute()
                
        except Exception as e:
            print(f"     ❌ 에러: {e}")

# ========================================
# 메인 로직 시작
# ========================================

# 0. 지수 업데이트 먼저 실행
update_indices()

# ... (이하 기존 종목 업데이트 로직)

# 토큰 발급
print("\n📌 한국투자증권 API 토큰 발급 중...")
access_token = get_kis_token()

if not access_token:
    print("❌ 토큰 발급 실패. 프로그램을 종료합니다.")
    exit()

print("✅ 토큰 발급 성공\n")

# ========================================
# 종목 리스트
# ========================================
df_krx = fdr.StockListing('KRX')
filter_mask = (
    ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False) &
    ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
)
target_stocks_df = df_krx[filter_mask][['Code', 'Name', 'Market', 'Marcap']]
target_stocks = target_stocks_df.to_dict('records')

print(f"✅ 대상 종목: {len(target_stocks)}개")

# Companies 테이블 동기화
print("   Companies 테이블 동기화 중...")
company_upload_list = []
for stock in target_stocks:
    company_upload_list.append({
        "code": str(stock['Code']),
        "name": stock['Name'],
        "market": stock['Market'],
        "marcap": float(stock['Marcap']) if not pd.isna(stock['Marcap']) else 0
    })

for i in range(0, len(company_upload_list), 1000):
    chunk = company_upload_list[i:i+1000]
    supabase.table("companies").upsert(chunk).execute()

# ========================================
# 기준일 설정
# ========================================
TODAY = datetime.now().strftime('%Y%m%d')
CHECK_START_DATE = (datetime.now() - timedelta(days=3)).strftime('%Y%m%d')  # 10일 → 3일 (주말 고려)
FULL_START_DATE = '20150101'

success_count = 0
updated_count = 0
api_call_count = 0

# ========================================
# DB 최신 데이터 배치 조회 (성능 최적화)
# ========================================
print("📊 DB 최신 데이터 배치 조회 중...")
db_latest_data = {}

try:
    # 모든 종목의 최신 데이터를 한 번의 쿼리로 가져오기
    res = supabase.rpc('get_latest_prices_by_code').execute()

    if res.data:
        for row in res.data:
            db_latest_data[row['code']] = {
                'date': row['date'],
                'close': float(row['close'])
            }
        print(f"✅ {len(db_latest_data)}개 종목의 최신 데이터 조회 완료")
    else:
        # RPC 함수가 없는 경우 기존 방식으로 대체
        print("⚠️  RPC 함수 없음. 개별 조회 방식 사용...")
        db_latest_data = None
except Exception as e:
    print(f"⚠️  배치 조회 실패 ({e}). 개별 조회 방식 사용...")
    db_latest_data = None

# ========================================
# 종목별 업데이트
# ========================================
for idx, stock in enumerate(target_stocks):
    code = str(stock['Code'])
    name = stock['Name']

    if idx % 50 == 0:
        print(f"[{idx+1}/{len(target_stocks)}] {name}({code}) 진행 중... (API 호출: {api_call_count}회)")

    try:
        # 1. DB 최신 데이터 조회 (배치 조회 결과 사용)
        if db_latest_data is not None:
            # 배치 조회 결과에서 가져오기
            db_last_data = db_latest_data.get(code)
            if db_last_data:
                db_last_data = {
                    'date': db_last_data['date'],
                    'close': db_last_data['close']
                }
        else:
            # 배치 조회 실패 시 개별 조회
            res = supabase.table('daily_prices_v2') \
                .select('date, close') \
                .eq('code', code) \
                .order('date', desc=True) \
                .limit(1) \
                .execute()
            db_last_data = res.data[0] if res.data else None

        # 2. pykrx 데이터 조회 (가격 데이터만)
        try:
            df_recent = krx_stock.get_market_ohlcv(CHECK_START_DATE, TODAY, code, adjusted=True)
        except Exception as e:
            continue

        if df_recent.empty:
            continue

        need_full_reload = False

        # 3. 수정주가 확인
        if db_last_data:
            db_date_str = db_last_data['date']
            db_date = datetime.strptime(db_date_str, '%Y-%m-%d')
            db_close = float(db_last_data['close'])

            if db_date in df_recent.index:
                krx_close = float(df_recent.loc[db_date]['종가'])

                if abs(krx_close - db_close) / db_close > 0.01:
                    print(f"   🔄 [수정주가 감지] {name}: DB({db_close}) != KRX({krx_close}). 전체 재적재...")
                    need_full_reload = True
        else:
            print(f"   ✨ [신규] {name}: 데이터 없음. 전체 적재...")
            need_full_reload = True

        # 4. 데이터 적재
        if need_full_reload:
            updated_count += 1
            time.sleep(0.5)
            df_full = krx_stock.get_market_ohlcv(FULL_START_DATE, TODAY, code, adjusted=True)
            if df_full.empty:
                continue

            # 한국투자증권 API로 거래대금 조회
            start_date_str = df_full.index.min().strftime('%Y%m%d')
            end_date_str = df_full.index.max().strftime('%Y%m%d')

            # 기간이 길 경우 100일씩 나눠서 조회
            trading_value_dict = {}
            current_start = datetime.strptime(start_date_str, '%Y%m%d')
            current_end_date = datetime.strptime(end_date_str, '%Y%m%d')

            while current_start <= current_end_date:
                chunk_end = min(current_start + timedelta(days=99), current_end_date)

                chunk_trading = get_trading_value_from_kis(
                    code,
                    current_start.strftime('%Y%m%d'),
                    chunk_end.strftime('%Y%m%d'),
                    access_token
                )
                trading_value_dict.update(chunk_trading)
                api_call_count += 1

                current_start = chunk_end + timedelta(days=1)

                # 토큰 재발급 (100회마다)
                if api_call_count % 100 == 0:
                    time.sleep(1)
                    access_token = get_kis_token()

            upload_list = []
            for d, r in df_full.iterrows():
                date_str = d.strftime('%Y-%m-%d')
                trading_value = trading_value_dict.get(date_str, 0)

                upload_list.append({
                    "code": code,
                    "date": date_str,
                    "open": int(r['시가']),
                    "high": int(r['고가']),
                    "low": int(r['저가']),
                    "close": int(r['종가']),
                    "volume": int(r['거래량']),
                    "trading_value": trading_value,
                    "change": 0.0
                })

            # 청크 업로드
            for i in range(0, len(upload_list), 1000):
                chunk = upload_list[i:i+1000]
                supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()

        else:
            # 일반 모드: 최신 데이터만 추가
            if db_last_data:
                last_db_date = datetime.strptime(db_last_data['date'], '%Y-%m-%d')
                df_new = df_recent[df_recent.index > last_db_date]
            else:
                df_new = df_recent

            if df_new.empty:
                continue

            # 한국투자증권 API로 최근 거래대금 조회
            # 거래량이 0인 경우 API 호출 스킵 (성능 최적화)
            has_trading_volume = (df_new['거래량'] > 0).any()

            if has_trading_volume:
                start_date_str = df_new.index.min().strftime('%Y%m%d')
                end_date_str = df_new.index.max().strftime('%Y%m%d')

                trading_value_dict = get_trading_value_from_kis(
                    code,
                    start_date_str,
                    end_date_str,
                    access_token
                )
                api_call_count += 1
            else:
                trading_value_dict = {}

            upload_list = []
            for d, r in df_new.iterrows():
                date_str = d.strftime('%Y-%m-%d')
                trading_value = trading_value_dict.get(date_str, 0)

                upload_list.append({
                    "code": code,
                    "date": date_str,
                    "open": int(r['시가']),
                    "high": int(r['고가']),
                    "low": int(r['저가']),
                    "close": int(r['종가']),
                    "volume": int(r['거래량']),
                    "trading_value": trading_value,
                    "change": 0.0
                })

            if upload_list:
                supabase.table("daily_prices_v2").upsert(upload_list, on_conflict="code, date").execute()

        success_count += 1

    except Exception as e:
        print(f"   ❌ 에러 {name}: {e}")
        time.sleep(1)

print(f"\n🎉 업데이트 완료!")
print(f"   성공: {success_count}개 종목")
print(f"   수정주가 보정: {updated_count}개 종목")
print(f"   KIS API 호출: {api_call_count}회")