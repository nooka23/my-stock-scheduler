import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime

# 로컬 설정 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") # Service Role Key 필수 (쓰기 권한)

if not url or not key:
    print("❌ 환경변수 오류: SUPABASE_SERVICE_ROLE_KEY 확인 필요")
    exit()

supabase: Client = create_client(url, key)

# 초기 적재 시작일
START_DATE = '2015-01-01'

print(f"🚀 V2 DB 마이그레이션 시작 (Start: {START_DATE})")

# 1. 종목 리스트 가져오기 (기존 companies 테이블 활용)
print("1. 종목 리스트 조회 중...")
try:
    # 전체 종목 가져오기 (페이지네이션 없이 다 가져오기 위해 range 사용)
    response = supabase.table('companies').select('code, name').range(0, 9999).execute()
    target_stocks = response.data
    print(f"✅ 대상 종목: {len(target_stocks)}개")
except Exception as e:
    print(f"❌ 종목 리스트 조회 실패: {e}")
    exit()

# 2. 데이터 수집 및 적재
total_count = len(target_stocks)
failed_list = []

for idx, stock in enumerate(target_stocks):
    code = stock['code']
    name = stock['name']
    
    if idx % 10 == 0:
        print(f"[{idx+1}/{total_count}] {name}({code}) 처리 중...")

    try:
        # KRX 데이터 로드
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty:
            continue

        # 데이터프레임 정리
        df = df.reset_index()
        # 컬럼명: Date, Open, High, Low, Close, Volume, Change
        
        # DB 컬럼명과 매핑
        # Change(등락률)도 저장 (검증용)
        upload_data = []
        for _, row in df.iterrows():
            upload_data.append({
                "code": code,
                "date": row['Date'].strftime('%Y-%m-%d'),
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume']),
                "change": float(row['Change']) if not pd.isna(row['Change']) else 0.0
            })
        
        # 청크 업로드 (Supabase 제한 고려, 1000개씩)
        chunk_size = 1000
        for i in range(0, len(upload_data), chunk_size):
            chunk = upload_data[i:i + chunk_size]
            try:
                supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
            except Exception as e:
                print(f"   ❌ {name} 업로드 실패 (chunk {i}): {e}")
                # 실패해도 다음 청크 시도 (일시적 오류일 수 있음)
                time.sleep(1)

    except Exception as e:
        print(f"   ❌ {name}({code}) 데이터 수집 실패: {e}")
        failed_list.append(code)
        
    # API 호출 제한 방지용 미세 딜레이
    time.sleep(0.1)

print(f"\n🎉 마이그레이션 완료! (실패: {len(failed_list)}건)")
if failed_list:
    print(f"실패 종목: {failed_list}")
