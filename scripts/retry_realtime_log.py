import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
import json
from datetime import datetime

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

# 로그 파일 이름 (날짜포함)
LOG_FILE = f"failed_log_{datetime.now().strftime('%Y%m%d_%H%M')}.txt"

def log_failure(code, name, error_msg):
    """실패 시 즉시 파일에 기록하는 함수"""
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {name}({code}) 실패: {error_msg}\n")

print(f"🚀 재시도 스크립트 시작! (실패 기록: {LOG_FILE})")

# 1. 전체 종목 리스트
try:
    df_krx = fdr.StockListing('KRX')
    all_stocks = df_krx[['Code', 'Name']].to_dict('records')
    print(f"✅ 전체 대상: {len(all_stocks)}개")
except Exception as e:
    print(f"❌ 목록 가져오기 실패: {e}")
    exit()

# 2. 업로드 시작
START_DATE = '2010-01-01'

for idx, stock in enumerate(all_stocks):
    code = stock['Code']
    name = stock['Name']
    
    if idx % 50 == 0:
        print(f"[{idx}/{len(all_stocks)}] 진행 중...")

    try:
        # 데이터 수집
        df = fdr.DataReader(code, START_DATE)
        
        if df.empty:
            continue

        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        df = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
        
        json_data = df.to_json(orient='records')

        # 업로드 (재시도 로직 포함)
        for attempt in range(3): # 최대 3번 재시도
            try:
                supabase.storage.from_("stocks").upload(
                    file=json_data.encode('utf-8'),
                    path=f"{code}.json",
                    file_options={"content-type": "application/json", "upsert": "true"}
                )
                break # 성공하면 탈출
            except Exception as e:
                if attempt == 2: # 3번 다 실패하면 에러 던짐
                    raise e
                time.sleep(1) # 1초 쉬고 재시도

    except Exception as e:
        # ★ [핵심] 실패 즉시 화면 출력 및 파일 저장
        error_msg = str(e).replace('\n', ' ')
        print(f"   ❌ {name}({code}) 실패 -> 기록됨")
        log_failure(code, name, error_msg)
        
    # 속도 조절
    time.sleep(0.05)

print("\n🎉 작업 종료! 실패 목록은 파일(failed_log_...)을 확인하세요.")