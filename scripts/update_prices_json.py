import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
import json
from datetime import datetime

# 1. 설정 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

print("🚀 주가 데이터 전체 업데이트 시작 (JSON 방식)")

# ---------------------------------------------------------
# 1. 대상 종목 선정 (진짜 기업만)
# ---------------------------------------------------------
print("1. 종목 리스트 분석 중...")
try:
    df_krx = fdr.StockListing('KRX')
    
    # Sector(업종)가 있는 것만 필터링 (ETN, 스팩 등 제외)
    real_companies = df_krx[df_krx['Sector'].notnull()]
    
    target_stocks = real_companies[['Code', 'Name']].to_dict('records')
    print(f"✅ 전체 {len(df_krx)}개 중 '실제 기업' {len(target_stocks)}개 선별 완료")
    
except Exception as e:
    print(f"❌ 목록 가져오기 실패: {e}")
    exit()

# ---------------------------------------------------------
# 2. 데이터 수집 및 업로드
# ---------------------------------------------------------
# 과거 데이터부터 쭉 쌓아두는 용도이므로 2010년부터 시작
START_DATE = '2010-01-01'
failed_list = []

print(f"2. {START_DATE} ~ 현재 데이터 수집 및 업로드...")

for idx, stock in enumerate(target_stocks):
    code = stock['Code']
    name = stock['Name']
    
    # 진행 상황 출력 (50개마다)
    if idx % 50 == 0:
        print(f"[{idx+1}/{len(target_stocks)}] {name}({code}) 진행 중...")

    try:
        # ★ [핵심 수정] KRX: 접두어 붙여서 데이터 소스 강제 지정
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty:
            print(f"   ⚠️ {name}({code}) 데이터 없음 (Pass)")
            continue

        # 데이터 가공 (Date 인덱스를 컬럼으로)
        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        
        # 차트 라이브러리용 컬럼명 변경
        df = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
        
        json_data = df.to_json(orient='records')

        # 업로드 (재시도 로직 포함)
        max_retries = 5
        for attempt in range(max_retries):
            try:
                supabase.storage.from_("stocks").upload(
                    file=json_data.encode('utf-8'),
                    path=f"{code}.json",
                    file_options={"content-type": "application/json", "upsert": "true"}
                )
                break # 성공하면 탈출
            except Exception as upload_err:
                error_msg = str(upload_err)
                # 429 에러(속도 제한) 대응
                if "429" in error_msg or "Too Many Requests" in error_msg:
                    wait_time = (attempt + 1) * 5 
                    if attempt == 0: # 첫 실패 때만 로그 출력 (너무 시끄러우니까)
                        print(f"   ⏳ 속도 제한! {wait_time}초 대기 후 재시도...")
                    time.sleep(wait_time)
                elif attempt == max_retries - 1:
                    raise upload_err # 마지막 시도도 실패하면 에러 던짐
                else:
                    # 다른 에러면 1초만 쉬고 재시도
                    time.sleep(1)

    except Exception as e:
        print(f"   ❌ {name}({code}) 최종 실패: {e}")
        failed_list.append({"code": code, "name": name, "error": str(e)})
        
    # 기본 안전 딜레이
    time.sleep(0.05)

# ---------------------------------------------------------
# 3. 결과 리포트
# ---------------------------------------------------------
print("\n" + "="*30)
if failed_list:
    print(f"🚨 작업 완료되었으나 {len(failed_list)}개 종목 실패.")
    with open('failed_companies.json', 'w', encoding='utf-8') as f:
        json.dump(failed_list, f, ensure_ascii=False, indent=2)
    print("👉 'failed_companies.json' 파일을 확인하세요.")
else:
    print("🎉 완벽합니다! 모든 종목 업로드 성공.")