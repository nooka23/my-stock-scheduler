import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

print("🔍 2025-12-08 데이터 확인 중...\n")

# 방법 1: count로 개수 확인
res_count = supabase.table('daily_prices_v2') \
    .select('code', count='exact') \
    .eq('date', '2025-12-08') \
    .execute()

print(f"📊 DB에서 직접 조회 (count): {res_count.count}개")

# 방법 2: 실제 데이터 가져와서 확인
res_data = supabase.table('daily_prices_v2') \
    .select('code, date, close') \
    .eq('date', '2025-12-08') \
    .execute()

print(f"📊 실제 데이터 조회: {len(res_data.data)}개")

if res_data.data:
    df = pd.DataFrame(res_data.data)
    df['date'] = pd.to_datetime(df['date'])

    print(f"\n📅 날짜 타입 확인:")
    print(f"   - df['date'].dtype: {df['date'].dtype}")
    print(f"   - 샘플 날짜 값: {df['date'].iloc[0]}")

    # 12-08로 필터링
    df_filtered = df[df['date'] == '2025-12-08']
    print(f"\n🔎 '2025-12-08' 문자열로 필터링: {len(df_filtered)}개")

    df_filtered2 = df[df['date'] == pd.to_datetime('2025-12-08')]
    print(f"🔎 pd.to_datetime('2025-12-08')로 필터링: {len(df_filtered2)}개")

    # 중복 확인
    duplicates = df['code'].duplicated().sum()
    print(f"\n⚠️  중복 종목코드: {duplicates}개")

    if duplicates > 0:
        dup_codes = df[df['code'].duplicated(keep=False)]['code'].unique()
        print(f"   중복된 종목코드: {dup_codes[:10]}")  # 최대 10개만 표시

    # 샘플 데이터 출력
    print(f"\n📋 샘플 데이터 (처음 5개):")
    print(df.head())
else:
    print("\n❌ 2025-12-08 데이터가 없습니다!")
