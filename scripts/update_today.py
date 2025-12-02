import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 시작!")

# ---------------------------------------------------------
# 1. 최신 종목 리스트 가져오기 & 이름표(DB) 갱신하기
# ---------------------------------------------------------
print("1. 최신 종목 리스트 로딩 및 DB 동기화...")
try:
    df_krx = fdr.StockListing('KRX')
    
    # Sector(업종)가 있는 '진짜 기업'만 필터링
    # (여기서 최신 이름이 반영됨)
    real_companies = df_krx[df_krx['Sector'].notnull()]
    
    # 1-1. companies 테이블 업데이트 (이름 변경 대응)
    # 필요한 정보만 뽑기
    companies_data = []
    for _, row in real_companies.iterrows():
        companies_data.append({
            "code": row['Code'],
            "name": row['Name'],
            "market": row['Market']
        })
    
    # 한 번에 1000개씩 나눠서 DB에 최신 이름표 붙이기 (Upsert)
    # 이미 있는 코드는 이름이 바뀌었으면 새 이름으로 갱신됨
    print(f"   - 총 {len(companies_data)}개 종목 정보 갱신 중...")
    chunk_size = 1000
    for i in range(0, len(companies_data), chunk_size):
        chunk = companies_data[i:i + chunk_size]
        supabase.table("companies").upsert(chunk).execute()
        
    print("   ✅ 종목명 최신화 완료!")
    
    # 다음 단계(가격 수집)를 위해 타겟 리스트 생성
    target_stocks = real_companies[['Code', 'Name']].to_dict('records')

except Exception as e:
    print(f"❌ 리스트 로딩/갱신 실패: {e}")
    exit()

# ---------------------------------------------------------
# 2. 최근 데이터 수집 (가격 정보)
# ---------------------------------------------------------
# 넉넉하게 최근 5일치 (휴일 포함 안전하게)
START_DATE = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
print(f"2. {START_DATE} ~ 오늘 주가 데이터 수집...")

failed_list = []
batch_data = []

total_count = len(target_stocks)

for idx, stock in enumerate(target_stocks):
    code = stock['Code']
    name = stock['Name']
    
    if idx % 100 == 0:
        print(f"[{idx}/{total_count}] 가격 수집 중...")

    try:
        # KRX 접두어 붙여서 조회
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty: continue

        df = df.reset_index()
        for _, row in df.iterrows():
            date_str = row['Date'].strftime('%Y-%m-%d')
            
            batch_data.append({
                "code": code,
                "date_str": date_str,
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume'])
            })

    except Exception as e:
        # 가격 수집 실패는 그냥 넘어가고 기록만 함
        failed_list.append(code)

    # 1000개씩 모아서 DB에 저장
    if len(batch_data) >= 1000:
        try:
            supabase.table("daily_prices").upsert(batch_data, on_conflict="code, date_str").execute()
            batch_data = []
        except Exception as e:
            print(f"   ❌ DB 업로드 실패: {e}")
            time.sleep(5)

# 남은 데이터 저장
if batch_data:
    supabase.table("daily_prices").upsert(batch_data, on_conflict="code, date_str").execute()

print(f"\n🎉 오늘의 업데이트 완료! (가격 수집 실패: {len(failed_list)}건)")