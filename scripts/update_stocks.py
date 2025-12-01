# scripts/update_stocks.py
import os
import FinanceDataReader as fdr
from supabase import create_client, Client

# 1. 환경변수에서 Supabase 키 가져오기 (GitHub 설정에서 넣어줄 예정)
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_KEY") # 쓰기 권한이 있는 Service Key 필요

if not url or not key:
    print("Error: Supabase 환경변수가 없습니다.")
    exit(1)

supabase: Client = create_client(url, key)

print("1. 주식 데이터 수집 시작...")
# KOSPI, KOSDAQ 전 종목 가져오기
kospi = fdr.StockListing('KOSPI')
kosdaq = fdr.StockListing('KOSDAQ')

# 필요한 컬럼만 뽑아서 합치기 (Code, Name)
kospi = kospi[['Code', 'Name']]
kosdaq = kosdaq[['Code', 'Name']]

# 2. 데이터 가공 (리스트 형태의 딕셔너리로 변환)
# Supabase는 한 번에 많은 데이터를 넣을 때 리스트 형태가 좋습니다.
stocks = []

for index, row in kospi.iterrows():
    stocks.append({"code": row['Code'], "name": row['Name']})

for index, row in kosdaq.iterrows():
    stocks.append({"code": row['Code'], "name": row['Name']})

print(f"2. 수집 완료: 총 {len(stocks)}개 종목")

# 3. Supabase에 업서트 (Upsert: 없으면 넣고, 있으면 업데이트)
print("3. 데이터베이스 업로드 시작 (약간 시간이 걸립니다)...")

# 데이터가 많으므로 100개씩 나눠서 넣기 (Chunking)
chunk_size = 100
for i in range(0, len(stocks), chunk_size):
    chunk = stocks[i:i + chunk_size]
    try:
        # upsert: code가 같으면 name을 갱신함
        supabase.table("companies").upsert(chunk).execute()
        print(f"  - {i} ~ {i+chunk_size} 완료")
    except Exception as e:
        print(f"  - Error 발생: {e}")

print("🎉 모든 데이터 업데이트 완료!")