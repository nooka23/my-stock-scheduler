import os
import requests
import json
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta

load_dotenv('.env.local')

# 환경변수
supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not supabase_url or not supabase_key:
    print("❌ Supabase 환경변수 오류")
    exit()

if not APP_KEY or not APP_SECRET:
    print("❌ 한국투자증권 API 환경변수 오류")
    print("   .env.local에 KIS_APP_KEY와 KIS_APP_SECRET을 추가해주세요.")
    exit()

supabase: Client = create_client(supabase_url, supabase_key)

print("🚀 거래대금 데이터 채우기 시작 (한국투자증권 API)")
print("   📅 대상 기간: 2024년 1월 1일 ~ 2024년 12월 31일")
print("   ⚠️ 기존 가격 데이터는 유지하고 거래대금만 업데이트합니다.\n")

# 1. 접근 토큰 발급
print("=" * 60)
print("1단계: 접근 토큰 발급")
print("=" * 60)

token_url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
token_headers = {"content-type": "application/json"}
token_body = {
    "grant_type": "client_credentials",
    "appkey": APP_KEY,
    "appsecret": APP_SECRET
}

try:
    token_response = requests.post(token_url, headers=token_headers, data=json.dumps(token_body))
    token_response.raise_for_status()
    token_data = token_response.json()

    if "access_token" in token_data:
        access_token = token_data["access_token"]
        print(f"✅ 토큰 발급 성공\n")
    else:
        print(f"❌ 토큰 발급 실패: {token_data}")
        exit()
except Exception as e:
    print(f"❌ 토큰 발급 에러: {e}")
    exit()

# 2. 대상 종목 조회
print("=" * 60)
print("2단계: 대상 종목 조회")
print("=" * 60)

res = supabase.table('companies').select('code, name').limit(3000).execute()

if not res.data:
    print("⚠️ Companies 테이블이 비어있습니다.")
    exit()

target_stocks = res.data
print(f"✅ 업데이트 대상 종목: {len(target_stocks)}개\n")

# 3. 거래대금 데이터 업데이트
print("=" * 60)
print("3단계: 거래대금 업데이트")
print("=" * 60)

# 조회 기간 설정 (2025년 데이터만)
FULL_START_DATE = '20240101'
FIXED_END_DATE = '20241231'
TODAY = FIXED_END_DATE # Use the fixed end date
# TODA = datetime.now().strftime('%Y%m%d') # Original line commented out

# API 호출 통계
total_calls = 0
total_updated = 0
total_errors = 0

for idx, stock in enumerate(target_stocks):
    code = stock['code']
    name = stock['name']

    # 진행 상황 표시
    if idx % 10 == 0:
        print(f"\n[{idx+1}/{len(target_stocks)}] 진행 중... (API 호출: {total_calls}회, 업데이트: {total_updated}건, 에러: {total_errors}건)")

    try:
        # 한국투자증권 API는 한 번에 최대 100일치 정도 조회 가능
        # 전체 기간을 나눠서 조회
        start_date = datetime.strptime(FULL_START_DATE, '%Y%m%d')
        end_date = datetime.strptime(FIXED_END_DATE, '%Y%m%d')

        current_start = start_date
        all_trading_data = []

        while current_start < end_date:
            # 100일씩 나눠서 조회
            current_end = min(current_start + timedelta(days=99), end_date)

            start_str = current_start.strftime('%Y%m%d')
            end_str = current_end.strftime('%Y%m%d')

            # API 호출
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
                "FID_INPUT_DATE_1": start_str,
                "FID_INPUT_DATE_2": end_str,
                "FID_PERIOD_DIV_CODE": "D",
                "FID_ORG_ADJ_PRC": "0"
            }

            # API 호출 (딜레이 추가)
            time.sleep(0.05)  # 초당 20회 제한 대비
            total_calls += 1

            response = requests.get(quote_url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()

            # 데이터 추출
            if data.get("rt_cd") == "0" and "output2" in data:
                for item in data["output2"]:
                    date_str = item.get("stck_bsop_date", "")
                    trading_value = int(item.get("acml_tr_pbmn", "0"))

                    if date_str and trading_value > 0:
                        formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                        all_trading_data.append({
                            "code": code,
                            "date": formatted_date,
                            "trading_value": trading_value
                        })

            # 다음 구간으로
            current_start = current_end + timedelta(days=1)

            # API 호출 제한 대비 추가 딜레이
            if total_calls % 100 == 0:
                time.sleep(1)

        # 거래대금 업데이트 (기존 레코드의 trading_value만 업데이트)
        if all_trading_data:
            # 1000개씩 나눠서 업데이트
            for i in range(0, len(all_trading_data), 1000):
                chunk = all_trading_data[i:i+1000]

                # upsert로 trading_value만 업데이트
                # on_conflict로 code, date가 일치하는 레코드의 trading_value만 업데이트
                supabase.table("daily_prices_v2").upsert(
                    chunk,
                    on_conflict="code,date",
                    ignore_duplicates=False
                ).execute()

                total_updated += len(chunk)

            if idx % 10 == 0:
                print(f"   ✅ {name}({code}): {len(all_trading_data)}건 업데이트")

    except Exception as e:
        total_errors += 1
        print(f"\n   ❌ 에러 {name}({code}): {e}")

        # 토큰 만료 시 재발급
        if "token" in str(e).lower() or "unauthorized" in str(e).lower():
            print("   🔄 토큰 재발급 시도...")
            try:
                token_response = requests.post(token_url, headers=token_headers, data=json.dumps(token_body))
                token_data = token_response.json()
                if "access_token" in token_data:
                    access_token = token_data["access_token"]
                    print("   ✅ 토큰 재발급 성공")
            except:
                print("   ❌ 토큰 재발급 실패")

        time.sleep(1)

print("\n" + "=" * 60)
print("🎉 거래대금 업데이트 완료!")
print("=" * 60)
print(f"총 API 호출: {total_calls}회")
print(f"총 업데이트: {total_updated}건")
print(f"총 에러: {total_errors}건")
