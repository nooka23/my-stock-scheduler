import os
import requests
import json
import time
from supabase import create_client, Client
from dotenv import load_dotenv

# 환경 변수 로드
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
    exit()

supabase: Client = create_client(url, key)

# ========================================
# 한국투자증권 API 토큰 발급
# ========================================
def get_kis_token():
    token_url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
    headers = {"content-type": "application/json"}
    body = {
        "grant_type": "client_credentials",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET
    }
    try:
        res = requests.post(token_url, headers=headers, data=json.dumps(body))
        res.raise_for_status()
        return res.json()["access_token"]
    except Exception as e:
        print(f"❌ 토큰 발급 실패: {e}")
        return None

def get_sector_from_kis(code, token):
    url = "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price"
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKST01010100"
    }
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": code
    }
    
    try:
        res = requests.get(url, headers=headers, params=params)
        res.raise_for_status()
        data = res.json()
        if data['rt_cd'] == '0':
            # bstp_kor_isnm: 업종명 (예: 전기전자)
            return data['output']['bstp_kor_isnm']
        return None
    except:
        return None

def update_sectors_kis():
    print("🚀 KIS API 기반 업종 정보 업데이트 시작...")
    
    token = get_kis_token()
    if not token: return

    # 1. 대상 종목 조회 (업종 정보가 없는 종목만 조회하면 좋겠지만, 전체 업데이트)
    # Supabase에서 코드 목록 가져오기
    print("   대상 종목 목록 조회 중...")
    res = supabase.table('companies').select('code, name').execute()
    if not res.data:
        print("   ❌ 종목 데이터가 없습니다.")
        return
    
    targets = res.data
    total = len(targets)
    print(f"   총 {total}개 종목 업데이트 예정")
    
    upload_list = []
    
    for i, stock in enumerate(targets):
        code = stock['code']
        # 지수(KOSPI, KOSDAQ)는 건너뜀
        if code in ['KOSPI', 'KOSDAQ']: continue
        
        sector = get_sector_from_kis(code, token)
        
        if sector:
            upload_list.append({
                'code': code,
                'name': stock['name'],
                'sector': sector
            })
            # print(f"   [{i+1}/{total}] {stock['name']}: {sector}")
        
        # API 제한 고려 (초당 20건) -> 0.05초 대기
        time.sleep(0.05)
        
        # 100개마다 진행상황 출력 및 중간 저장
        if (i+1) % 100 == 0 or (i+1) == total:
            print(f"   [{i+1}/{total}] 진행 중... (현재: {stock['name']})")
            
            if upload_list:
                supabase.table('companies').upsert(upload_list, on_conflict='code').execute()
                upload_list = [] # 초기화

    # 남은 데이터 저장
    if upload_list:
        supabase.table('companies').upsert(upload_list, on_conflict='code').execute()

    print("\n✅ 업데이트 완료!")

if __name__ == "__main__":
    update_sectors_kis()
