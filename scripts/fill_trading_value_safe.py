import os
import requests
import json
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
import signal
import sys

# 환경변수 로드
load_dotenv('.env.local')

supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

# 설정
START_DATE = '20150101'
END_DATE = '20231231'
PROGRESS_FILE = 'scripts/fill_trading_value_progress.json'
ERROR_EXPORT_FILE = f'scripts/trading_value_errors_{datetime.now().strftime("%Y%m%d_%H%M")}.xlsx'

# 전역 변수
completed_codes = set()
error_logs = []
access_token = None

if not supabase_url or not supabase_key:
    print("❌ Supabase 환경변수 오류")
    exit()

if not APP_KEY or not APP_SECRET:
    print("❌ 한국투자증권 API 환경변수 오류")
    exit()

supabase: Client = create_client(supabase_url, supabase_key)

def get_kis_token():
    """한국투자증권 API 접근 토큰 발급"""
    url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
    headers = {"content-type": "application/json"}
    body = {
        "grant_type": "client_credentials",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET
    }
    try:
        res = requests.post(url, headers=headers, data=json.dumps(body))
        res.raise_for_status()
        return res.json()["access_token"]
    except Exception as e:
        print(f"❌ 토큰 발급 실패: {e}")
        return None

def load_progress():
    """진행 상황 로드"""
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except:
            return set()
    return set()

def save_progress():
    """진행 상황 저장"""
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(list(completed_codes), f)

def save_error_log():
    """오류 로그 엑셀 저장"""
    if error_logs:
        df = pd.DataFrame(error_logs)
        df.to_excel(ERROR_EXPORT_FILE, index=False)
        print(f"\n📁 오류 로그가 저장되었습니다: {ERROR_EXPORT_FILE}")
    else:
        print("\n✨ 발생한 오류가 없습니다.")

def signal_handler(sig, frame):
    """강제 종료(Ctrl+C) 시 처리"""
    print("\n\n🛑 프로그램이 중단되었습니다. 진행 상황을 저장합니다...")
    save_progress()
    save_error_log()
    sys.exit(0)

# 시그널 핸들러 등록
signal.signal(signal.SIGINT, signal_handler)

def main():
    global access_token, completed_codes
    
    print(f"🚀 거래대금 과거 데이터 채우기 (안전 모드)")
    print(f"   📅 대상 기간: {START_DATE} ~ {END_DATE}")
    print(f"   💾 진행 상황 파일: {PROGRESS_FILE}")
    
    # 1. 토큰 발급
    access_token = get_kis_token()
    if not access_token:
        return

    # 2. 종목 로드
    print("📊 종목 목록 조회 중...")
    res = supabase.table('companies').select('code, name').execute()
    all_stocks = res.data
    
    # 3. 진행 상황 로드
    completed_codes = load_progress()
    target_stocks = [s for s in all_stocks if s['code'] not in completed_codes]
    
    print(f"   총 종목: {len(all_stocks)}개")
    print(f"   완료됨: {len(completed_codes)}개")
    print(f"   남은 대상: {len(target_stocks)}개\n")
    
    total_calls = 0
    
    for idx, stock in enumerate(target_stocks):
        code = stock['code']
        name = stock['name']
        
        print(f"[{idx+1}/{len(target_stocks)}] {name}({code}) 처리 중...", end='\r')
        
        try:
            # 기간 루프 (100일 단위)
            current_start = datetime.strptime(START_DATE, '%Y%m%d')
            end_dt = datetime.strptime(END_DATE, '%Y%m%d')
            
            stock_data = []
            has_error = False
            
            while current_start <= end_dt:
                current_end = min(current_start + timedelta(days=99), end_dt)
                
                # API 호출 준비
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
                    "FID_INPUT_DATE_1": current_start.strftime('%Y%m%d'),
                    "FID_INPUT_DATE_2": current_end.strftime('%Y%m%d'),
                    "FID_PERIOD_DIV_CODE": "D",
                    "FID_ORG_ADJ_PRC": "0"
                }
                
                # 호출 및 속도 제한
                time.sleep(0.06) # 약 16req/sec (안전 마진)
                
                try:
                    res = requests.get(
                        "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
                        headers=headers,
                        params=params
                    )
                    total_calls += 1
                    
                    if res.status_code != 200:
                        raise Exception(f"HTTP {res.status_code}")
                        
                    data = res.json()
                    
                    # 토큰 만료 체크
                    if data.get('msg1') and '초과' in data['msg1']: # 접근토큰 등 에러 메시지 확인 필요하나 단순화
                        pass
                        
                    if data.get("rt_cd") == "0" and "output2" in data:
                        for item in data["output2"]:
                            d = item.get("stck_bsop_date")
                            v = int(item.get("acml_tr_pbmn", "0"))
                            if d and v > 0:
                                stock_data.append({
                                    "code": code,
                                    "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                                    "trading_value": v
                                })
                    else:
                        # 데이터 없음 등은 에러 아님, 패스
                        pass
                        
                except Exception as req_e:
                    # 토큰 만료 가능성
                    print(f"\n   ⚠️ API 호출 중 에러 ({name}): {req_e}")
                    # 토큰 재발급 시도
                    new_token = get_kis_token()
                    if new_token:
                        access_token = new_token
                        print("   🔄 토큰 재발급 완료, 재시도합니다.")
                        time.sleep(1)
                        continue # 현재 구간 다시 시도 (while 루프 제어 필요하나 여기선 다음 구간으로 넘어가지 않게 주의)
                        # 간단한 재시도 로직: 실패한 구간은 건너뛰거나 에러 로그 남김
                    
                    error_logs.append({
                        "code": code,
                        "name": name,
                        "date_range": f"{current_start.strftime('%Y%m%d')}-{current_end.strftime('%Y%m%d')}",
                        "error": str(req_e)
                    })
                    has_error = True
                    break

                current_start = current_end + timedelta(days=1)
                
                # 토큰 주기적 갱신 (약 500회 호출마다)
                if total_calls % 500 == 0:
                    t = get_kis_token()
                    if t: access_token = t

            # DB 저장
            if stock_data:
                # 1000개씩 분할 저장
                for i in range(0, len(stock_data), 1000):
                    chunk = stock_data[i:i+1000]
                    try:
                        supabase.table("daily_prices_v2").upsert(
                            chunk, 
                            on_conflict="code,date",
                            ignore_duplicates=False # 덮어쓰기
                        ).execute()
                    except Exception as db_e:
                        print(f"\n   ❌ DB 저장 실패 {name}: {db_e}")
                        error_logs.append({"code": code, "name": name, "error": f"DB Save: {db_e}"})
                        has_error = True
            
            if not has_error:
                completed_codes.add(code)
                
            # 주기적 저장 (10개 종목마다)
            if idx > 0 and idx % 10 == 0:
                save_progress()
                
        except Exception as e:
            print(f"\n   ❌ {name} 처리 중 치명적 에러: {e}")
            error_logs.append({"code": code, "name": name, "error": str(e)})
            
    # 마무리
    save_progress()
    save_error_log()
    print("\n🎉 모든 작업이 완료되었습니다.")

if __name__ == "__main__":
    main()
