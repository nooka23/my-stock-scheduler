import os
import requests
import json
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv('.env.local')

APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not APP_KEY or not APP_SECRET:
    print("❌ 한국투자증권 API 환경변수 오류")
    print("   .env.local에 KIS_APP_KEY와 KIS_APP_SECRET을 추가해주세요.")
    exit()

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
# 한국투자증권 API 지수 차트 조회
# ========================================
def get_kis_index_ohlcv(code, start_date, end_date, access_token):
    """
    한국투자증권 API로 지수 일별 시세 조회
    
    Args:
        code: 업종코드 (KOSPI: 0001, KOSDAQ: 1001)
        start_date: 시작일 (YYYYMMDD)
        end_date: 종료일 (YYYYMMDD)
        access_token: API 토큰
        
    Returns:
        list: 일별 데이터 리스트
    """
    url = "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {access_token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKUP03500100"
    }
    
    all_data = []
    tr_cont = ""
    
    # 첫 호출 params
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D"
    }

    while True:
        try:
            current_headers = headers.copy()
            if tr_cont:
                current_headers["tr_cont"] = tr_cont
            
            time.sleep(0.1)
            response = requests.get(url, headers=current_headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            # output2에 일별 데이터가 있음
            if "output2" in data and data["output2"]:
                all_data.extend(data["output2"])
            
            # 다음 페이지 확인
            tr_cont = response.headers.get("tr_cont", "")
            if tr_cont not in ["M", "F"]:
                break
                
        except Exception as e:
            print(f"   ❌ KIS 지수 데이터 조회 실패: {e}")
            break
            
    return all_data

# ========================================
# 지수 데이터 업데이트 (Test Mode)
# ========================================
def update_indices_test(access_token):
    print("\n📊 시장 지수(KOSPI, KOSDAQ) 조회 테스트 (DB 미반영)")
    
    # 최근 10일치 데이터만 조회
    start_date = (datetime.now() - timedelta(days=10)).strftime('%Y%m%d')
    end_date = datetime.now().strftime('%Y%m%d')
    
    # KIS API 업종코드: KOSPI='0001', KOSDAQ='1001'
    indices = [
        {'kis_code': '0001', 'code': 'KOSPI', 'name': 'KOSPI'},
        {'kis_code': '1001', 'code': 'KOSDAQ', 'name': 'KOSDAQ'}
    ]
    
    for idx in indices:
        try:
            print(f"   - {idx['name']} 데이터 수집 중... ({start_date} ~ {end_date})")
            
            raw_data = get_kis_index_ohlcv(idx['kis_code'], start_date, end_date, access_token)
            
            if not raw_data:
                print(f"     ⚠️ 데이터 없음")
                continue
                
            print(f"     ✅ {len(raw_data)}건 조회 성공")
            if raw_data:
                print(f"     👀 최근 데이터 (3건):")
                for i in range(min(3, len(raw_data))):
                    item = raw_data[i]
                    date_str = item.get("stck_bsop_date", "")
                    close_price = item.get('bstp_nmix_prpr', 0)
                    print(f"        📅 {date_str}: {close_price}")
                
        except Exception as e:
            print(f"     ❌ 에러: {e}")

# Main Execution
print("📌 토큰 발급 중...")
access_token = get_kis_token()
if access_token:
    print("✅ 토큰 발급 성공")
    update_indices_test(access_token)
else:
    print("❌ 토큰 발급 실패")
