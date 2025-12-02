import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(url, key)

print("🧮 RS(상대강도) 지수 계산 시작...")

# 1. 전체 종목 가져오기
print("1. 종목 리스트 로딩 중...")
response = supabase.table("companies").select("code").range(0, 9999).execute()
codes = [item['code'] for item in response.data]

print(f"   - 총 {len(codes)}개 종목 계산 대상")

# 결과 담을 리스트
performances = []

# 기준 날짜 설정 (오늘, 1년 전)
today = datetime.now()
one_year_ago = today - timedelta(days=365)
date_fmt = '%Y-%m-%d'

print("2. 종목별 1년 수익률 계산 중 (시간이 좀 걸립니다)...")

# 성능 최적화를 위해 청크 단위가 아니라, 
# '각 종목의 DB에 있는 데이터'를 쿼리해서 계산
# (주의: 너무 많은 요청을 보내면 느리므로, 실제 서비스에선 SQL 함수로 처리하지만 여기선 파이썬 로직으로 진행)

total = len(codes)
for idx, code in enumerate(codes):
    if idx % 100 == 0: print(f"   - 진행률: {idx}/{total}")

    try:
        # 해당 종목의 가격 데이터 가져오기 (날짜 내림차순 정렬)
        # limit(300) -> 넉넉하게 최근 1년치 근처 가져오기
        res = supabase.table("stock_prices") \
            .select("date_str, close") \
            .eq("code", code) \
            .order("date_str", desc=True) \
            .limit(300) \
            .execute()
        
        data = res.data
        if not data or len(data) < 200: # 데이터가 너무 적으면(신규상장) 패스
            continue

        # 최신 가격 (오늘 혹은 가장 최근 거래일)
        latest_price = data[0]['close']
        latest_date = data[0]['date_str']

        # 1년 전 가격 찾기 (약 250 거래일 전)
        # 데이터가 250개보다 적으면 가장 옛날 데이터 사용
        past_idx = min(len(data) - 1, 250) 
        past_price = data[past_idx]['close']

        # 수익률 계산
        pct_change = (latest_price - past_price) / past_price
        
        performances.append({
            "code": code,
            "latest_date": latest_date,
            "pct_change": pct_change
        })

    except Exception as e:
        print(f"Error {code}: {e}")
        continue

print(f"✅ 수익률 계산 완료 ({len(performances)}개 종목)")

# 3. 순위 매기기 (Ranking)
print("3. RS 점수(1~99) 산정 중...")
df = pd.DataFrame(performances)

# 수익률 기준 랭킹 (Percentile)
# pct=True 하면 0~1 사이 값이 나옴 -> * 99 하고 반올림
df['rs_rating'] = df['pct_change'].rank(pct=True) * 99
df['rs_rating'] = df['rs_rating'].round().astype(int)

# 1점 미만은 1점으로, 99점 초과는 99점으로 보정
df['rs_rating'] = df['rs_rating'].clip(1, 99)

print("   - 랭킹 산정 완료. DB 업데이트 시작...")

# 4. DB에 업데이트 (최신 날짜 행에 rs_rating 넣기)
updates = []
for index, row in df.iterrows():
    updates.append({
        "code": row['code'],
        "date_str": row['latest_date'],
        "rs_rating": int(row['rs_rating'])
    })

# 대량 업데이트 (Upsert 사용 - conflict가 code, date_str이므로 해당 날짜 행의 rs_rating만 갱신됨)
chunk_size = 1000
for i in range(0, len(updates), chunk_size):
    chunk = updates[i:i + chunk_size]
    try:
        # 기존 데이터(open, high, low 등)는 건드리지 않고 rs_rating만 업데이트하려면
        # 사실 ignoreDuplicates=False가 기본이라 덮어쓰기 됩니다.
        # 주의: Supabase Upsert는 "전체 행 덮어쓰기"가 기본일 수 있어서, 
        # 안전하게 하려면 원래 데이터를 다 가져와서 합쳐야 하지만,
        # 여기서는 '코드, 날짜'가 PK 역할이므로, 해당 행의 다른 데이터가 날아갈 위험이 있는지 확인해야 합니다.
        # Supabase(Postgres)는 부분 업데이트가 까다롭습니다.
        # 안전하게: 'update' 명령어를 루프 돌면서 쓰는 게 데이터 보존엔 가장 확실하지만 느립니다.
        # 여기서는 속도를 위해 upsert를 쓰되, 기존 데이터를 유지하는지 테스트가 필요합니다.
        # -> 가장 안전한 방법: SQL query로 처리하거나, Python에서 건건이 update.
        # -> 일단은 안전하게 건건이 update로 진행하겠습니다. (시간은 좀 걸림)
        pass 
    except:
        pass

# 건건이 업데이트 (데이터 안전 최우선)
print("   - DB 쓰는 중 (시간 소요)...")
for idx, item in enumerate(updates):
    if idx % 100 == 0: print(f"     {idx}/{len(updates)}")
    supabase.table("stock_prices").update({"rs_rating": item['rs_rating']}) \
        .eq("code", item['code']) \
        .eq("date_str", item['date_str']) \
        .execute()

print("🎉 모든 RS 지수 업데이트 완료!")