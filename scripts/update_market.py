import os
import FinanceDataReader as fdr
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

print("🏢 시장 정보(KOSPI/KOSDAQ) 업데이트 시작...")

# 1. 시장별 리스트 가져오기
print("   - 데이터 수집 중...")
kospi = fdr.StockListing('KOSPI')[['Code', 'Name', 'Market']]
kosdaq = fdr.StockListing('KOSDAQ')[['Code', 'Name', 'Market']]
konex = fdr.StockListing('KONEX')[['Code', 'Name', 'Market']]

# 2. 업데이트 함수
def update_market_info(df):
    updates = []
    for index, row in df.iterrows():
        updates.append({
            "code": row['Code'],
            "name": row['Name'],
            "market": row['Market'] # KOSPI, KOSDAQ ...
        })
    
    # 1000개씩 나눠서 업로드
    chunk_size = 1000
    for i in range(0, len(updates), chunk_size):
        chunk = updates[i:i + chunk_size]
        try:
            # upsert로 기존 데이터에 market 정보만 덮어씌움
            supabase.table("companies").upsert(chunk).execute()
            print(f"     ✅ {i} ~ {i+len(chunk)} 완료")
        except Exception as e:
            print(f"     ❌ 에러: {e}")

# 3. 실행
print("🚀 KOSPI 업데이트...")
update_market_info(kospi)

print("🚀 KOSDAQ 업데이트...")
update_market_info(kosdaq)

print("🚀 KONEX 업데이트...")
update_market_info(konex)

print("🎉 시장 정보 업데이트 완료!")