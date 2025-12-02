import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
import json

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

# ======================================================
# ★ 여기에 실패했던 종목 코드를 문자열 리스트로 넣어주세요!
# 예시: ['0015G0', '0126Z0', '005930']
# ======================================================
TARGET_CODES = [
    '0126Z0', 
    '0120G0', 
    '0008Z0',
    '0030R0',
    '0015N0',
    '0015G0',
    '0010V0',
    '0096B0',
    '0096D0',
    '0072Z0',
    '0044K0',
    '0071M0',
    '0093G0',
    '0037T0',
    '0091W0',
    '0041L0',
    '0004Y0',
    '0041B0',
    '0068Y0',
    '0041J0'
    # ... 여기에 계속 추가하세요 ...
]

START_DATE = '2010-01-01'

print(f"🚀 수동 재시도 시작! (총 {len(TARGET_CODES)}개 종목)")

for idx, code in enumerate(TARGET_CODES):
    print(f"[{idx+1}/{len(TARGET_CODES)}] 종목코드 {code} 처리 중...", end=" ")

    try:
        # 1. 데이터 수집 (기간: 2010 ~ 현재)
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty:
            print("Pass (데이터 없음)")
            continue

        # 2. 데이터 가공
        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        df = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
        
        json_data = df.to_json(orient='records')

        # 3. 업로드 (재시도 로직 포함)
        for attempt in range(3):
            try:
                res = supabase.storage.from_("stocks").upload(
                    file=json_data.encode('utf-8'),
                    path=f"{code}.json",
                    file_options={"content-type": "application/json", "upsert": "true"}
                )
                print("✅ 성공")
                break
            except Exception as upload_err:
                if "429" in str(upload_err): # 속도 제한 걸리면
                    print(f"⏳", end="")
                    time.sleep(5) # 5초 대기
                elif attempt == 2:
                    raise upload_err # 3번 다 실패하면 에러

    except Exception as e:
        print(f"❌ 실패: {e}")
        
    time.sleep(0.5) # 안전하게 천천히 진행

print("\n🎉 수동 업데이트 완료!")