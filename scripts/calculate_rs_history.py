import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import time

# 1. 설정 로드
load_dotenv('.env.local')
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정 확인 필요")
    exit()

supabase: Client = create_client(url, key)

print("⏳ 1. 전체 주가 데이터 다운로드 중 (가중 RS 계산용)...")

# 전체 데이터를 가져오기 위한 함수
def fetch_all_data():
    all_data = []
    start = 0
    batch_size = 2000
    
    # 12개월 전 데이터를 계산해야 하므로 2024년 1월부터 가져옴
    while True:
        print(f"   - {start} ~ {start + batch_size} 행 가져오는 중...")
        
        response = supabase.table("stock_prices") \
            .select("*") \
            .gte("date_str", "2024-01-01") \
            .lte("date_str", "2025-11-28") \
            .range(start, start + batch_size - 1) \
            .execute()
        
        data = response.data
        if not data:
            break
            
        all_data.extend(data)
        start += batch_size
        
        if len(data) < batch_size:
            break
            
    return pd.DataFrame(all_data)

# 데이터프레임 생성
df = fetch_all_data()
print(f"✅ 다운로드 완료: 총 {len(df)}개 행")

if df.empty:
    print("데이터가 없습니다.")
    exit()

# ---------------------------------------------------------
# 2. 가중 RS 지수(Weighted RS) 정밀 계산
# ---------------------------------------------------------
print("🧮 2. 4분기 가중 RS 지수 계산 중...")

df['date'] = pd.to_datetime(df['date_str'])
df = df.sort_values(['code', 'date'])

# 피벗 테이블 (행: 날짜, 열: 종목, 값: 종가)
pivot_df = df.pivot(index='date', columns='code', values='close')

# 거래일 기준 (대략 1달 = 21일, 3달 = 63일)
# Q1: 최근 3개월 (0~3개월)
# Q2: 4~6개월 전 (3~6개월)
# Q3: 7~9개월 전 (6~9개월)
# Q4: 10~12개월 전 (9~12개월)

# 각 시점의 가격 구하기 (shift 사용)
price_now = pivot_df
price_3m = pivot_df.shift(63)  # 3개월 전
price_6m = pivot_df.shift(126) # 6개월 전
price_9m = pivot_df.shift(189) # 9개월 전
price_12m = pivot_df.shift(252) # 12개월 전

# 각 분기별 수익률(Return) 계산
# Q1 Return: (현재 - 3개월전) / 3개월전
ret_q1 = (price_now - price_3m) / price_3m

# Q2 Return: (3개월전 - 6개월전) / 6개월전
ret_q2 = (price_3m - price_6m) / price_6m

# Q3 Return: (6개월전 - 9개월전) / 9개월전
ret_q3 = (price_6m - price_9m) / price_9m

# Q4 Return: (9개월전 - 12개월전) / 12개월전
ret_q4 = (price_9m - price_12m) / price_12m

# 가중 합산 점수 계산 (Weighted Score)
# 공식: (0.4 * Q1) + (0.2 * Q2) + (0.2 * Q3) + (0.2 * Q4)
weighted_score = (0.4 * ret_q1) + (0.2 * ret_q2) + (0.2 * ret_q3) + (0.2 * ret_q4)

# 2025년 데이터만 타겟팅
target_score = weighted_score.loc['2025-01-01':'2025-11-28']

# 랭킹 산정 (1~99점)
# 점수가 높을수록 1등 -> 백분위 -> 99점
rs_df = target_score.rank(axis=1, pct=True) * 99
rs_df = rs_df.round().fillna(0).astype(int)
rs_df = rs_df.clip(1, 99)

print("✅ 가중 RS 계산 완료!")

# ---------------------------------------------------------
# 3. DB에 결과 업로드 (동일)
# ---------------------------------------------------------
print("💾 3. DB 업데이트 시작...")

# RS 데이터 변형 (Long Format)
upload_data = rs_df.stack().reset_index()
upload_data.columns = ['date', 'code', 'rs_rating']
upload_data['date_str'] = upload_data['date'].dt.strftime('%Y-%m-%d')

# 원본 데이터 준비
original_2025 = df[df['date'] >= '2025-01-01'].copy()
original_2025['date_str'] = original_2025['date'].dt.strftime('%Y-%m-%d')

# 기존 rs_rating 제거 (충돌 방지)
if 'rs_rating' in original_2025.columns:
    original_2025 = original_2025.drop(columns=['rs_rating'])

# 병합
merged_df = pd.merge(original_2025, upload_data[['code', 'date_str', 'rs_rating']], on=['code', 'date_str'], how='left')
merged_df['rs_rating'] = merged_df['rs_rating'].fillna(0).astype(int)

# 리스트 변환
final_records = []
for _, row in merged_df.iterrows():
    final_records.append({
        "code": row['code'],
        "date_str": row['date_str'],
        "open": row['open'],
        "high": row['high'],
        "low": row['low'],
        "close": row['close'],
        "volume": row['volume'],
        "rs_rating": row['rs_rating']
    })

# 업로드 실행
total_records = len(final_records)
print(f"   - 총 업데이트 할 데이터: {total_records}건")

chunk_size = 2000
for i in range(0, total_records, chunk_size):
    chunk = final_records[i:i + chunk_size]
    try:
        supabase.table("stock_prices").upsert(chunk, on_conflict="code, date_str").execute()
        print(f"     ✅ {i} ~ {i+len(chunk)} 완료")
    except Exception as e:
        print(f"     ❌ 에러: {e}")

print("🎉 가중 RS(Weighted RS) 히스토리 업데이트 완료!")