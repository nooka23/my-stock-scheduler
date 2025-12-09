import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

print("🔍 최근 영업일별 데이터 개수 확인\n")

# 12월 1일부터 9일까지 각 날짜별 개수 확인
dates = [
    '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05',
    '2025-12-06', '2025-12-08', '2025-12-09'
]

print("📊 DB에서 직접 조회한 날짜별 데이터 개수:\n")
for date in dates:
    res = supabase.table('daily_prices_v2') \
        .select('code', count='exact') \
        .eq('date', date) \
        .execute()

    count = res.count if res.count else 0
    status = "✅" if count > 1500 else "⚠️" if count > 0 else "❌"
    print(f"   {status} {date}: {count:>4}개")

print("\n" + "="*50)
print("\n🔍 calculate_rs_1208.py가 로드한 데이터 확인\n")

# calculate_rs_1208.py와 동일한 방식으로 데이터 로드
TARGET_DATE = '2025-12-08'
FETCH_START_DATE = (datetime.strptime(TARGET_DATE, '%Y-%m-%d') - timedelta(days=400)).strftime('%Y-%m-%d')

print(f"로딩 범위: {FETCH_START_DATE} ~ {TARGET_DATE}")

try:
    all_rows = []
    chunk_offset = 0
    chunk_limit = 10000

    while True:
        res = supabase.table('daily_prices_v2') \
            .select('code, date, close') \
            .gte('date', FETCH_START_DATE) \
            .lte('date', TARGET_DATE) \
            .range(chunk_offset, chunk_offset + chunk_limit - 1) \
            .execute()

        if not res.data:
            break

        all_rows.extend(res.data)

        if len(res.data) < chunk_limit:
            break

        chunk_offset += chunk_limit

    print(f"총 로드: {len(all_rows)}건\n")

    df = pd.DataFrame(all_rows)
    df['date'] = pd.to_datetime(df['date'])

    # 날짜별 개수 확인
    date_counts = df['date'].value_counts().sort_index()

    print("📊 로드된 데이터에서 날짜별 개수:\n")
    for date in dates:
        date_dt = pd.to_datetime(date)
        count = date_counts.get(date_dt, 0)
        status = "✅" if count > 1500 else "⚠️" if count > 0 else "❌"
        print(f"   {status} {date}: {count:>4}개")

    # 차이 분석
    print("\n" + "="*50)
    print("\n🔎 차이 분석:\n")

    for date in dates:
        res = supabase.table('daily_prices_v2') \
            .select('code', count='exact') \
            .eq('date', date) \
            .execute()
        db_count = res.count if res.count else 0

        date_dt = pd.to_datetime(date)
        loaded_count = date_counts.get(date_dt, 0)

        diff = db_count - loaded_count
        if diff != 0:
            print(f"   ⚠️  {date}: DB({db_count}) - 로드됨({loaded_count}) = 차이({diff})")

except Exception as e:
    print(f"❌ 에러: {e}")
