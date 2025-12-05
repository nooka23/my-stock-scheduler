import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta  # <--- 여기 확실히 있음

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

# 계산 시작일 (2023 ~ 현재)
CALC_START_DATE = '2023-01-01' 
CALC_END_DATE = datetime.now().strftime('%Y-%m-%d')

print(f"🚀 V2 다중 RS 랭킹 계산 시작 ({CALC_START_DATE} ~ {CALC_END_DATE})")

# 1. 데이터 로딩
print("1. 전체 주가 데이터 로딩 중 (날짜별 분할 로드)...")
try:
    all_rows = []
    
    # 2022년부터 로드 (2023년 1월 랭킹 계산을 위해 1년 전 데이터 필요)
    start_year = 2022 
    # 현재 연도까지 로드
    end_year = datetime.now().year
    
    for year in range(start_year, end_year + 1):
        print(f"   Fetching {year} data...", end='\r')
        
        for month in range(1, 13):
            # 월별 시작/끝 날짜 계산
            next_month = month + 1 if month < 12 else 1
            next_year_val = year if month < 12 else year + 1
            
            m_start = f"{year}-{month:02d}-01"
            m_end_exclusive = f"{next_year_val}-{next_month:02d}-01"
            
            if m_start > datetime.now().strftime('%Y-%m-%d'):
                break

            chunk_offset = 0
            chunk_limit = 10000
            
            while True:
                res = supabase.table('daily_prices_v2') \
                    .select('code, date, close') \
                    .gte('date', m_start) \
                    .lt('date', m_end_exclusive) \
                    .range(chunk_offset, chunk_offset + chunk_limit - 1) \
                    .execute()
                
                if not res.data:
                    break
                    
                all_rows.extend(res.data)
                
                if len(res.data) < chunk_limit:
                    break 
                
                chunk_offset += chunk_limit
                
    print(f"\n✅ 로드 완료: {len(all_rows)}건")
    
    if not all_rows:
        print("❌ 데이터가 없습니다. daily_prices_v2 테이블을 확인하세요.")
        exit()

    df = pd.DataFrame(all_rows)
    df['date'] = pd.to_datetime(df['date'])
    df['close'] = df['close'].astype(float)
    
except Exception as e:
    print(f"\n❌ 데이터 로드 실패: {e}")
    exit()

# 2. 지표 계산
print("2. 종목별 수익률 및 가중 점수 계산 중...")

# 정렬
df = df.sort_values(['code', 'date'])

# 영업일 기준 (대략적)
P3 = 63
P6 = 126
P9 = 189
P12 = 252

# GroupBy 연산
df['ret_3m'] = df.groupby('code')['close'].pct_change(P3)
df['ret_6m'] = df.groupby('code')['close'].pct_change(P6)
df['ret_12m'] = df.groupby('code')['close'].pct_change(P12)

# 가중 RS용 구간 수익률
grp = df.groupby('code')['close']
s_now = df['close']
s_3m = grp.shift(P3)
s_6m = grp.shift(P6)
s_9m = grp.shift(P9)
s_12m = grp.shift(P12)

# 분모 0 방지
s_3m = s_3m.replace(0, np.nan)
s_6m = s_6m.replace(0, np.nan)
s_9m = s_9m.replace(0, np.nan)
s_12m = s_12m.replace(0, np.nan)

r1 = (s_now - s_3m) / s_3m
r2 = (s_3m - s_6m) / s_6m
r3 = (s_6m - s_9m) / s_9m
r4 = (s_9m - s_12m) / s_12m

df['score_weighted'] = (0.4 * r1) + (0.2 * r2) + (0.2 * r3) + (0.2 * r4)

# 계산 대상 기간 필터링 (2020~2022)
df_calc = df[(df['date'] >= CALC_START_DATE) & (df['date'] <= CALC_END_DATE)].copy()

print(f"✅ 지표 계산 완료. 랭킹 산정 대상: {len(df_calc)}건 ({CALC_START_DATE} ~ {CALC_END_DATE})")

# 3. 날짜별 랭킹 산정
print("3. 날짜별 랭킹(1~99) 산정 중...")

def calc_rank(series):
    return (series.rank(pct=True) * 99).fillna(0).round().astype(int).clip(1, 99)

df_calc['rank_weighted'] = df_calc.groupby('date')['score_weighted'].transform(calc_rank)
df_calc['rank_3m'] = df_calc.groupby('date')['ret_3m'].transform(calc_rank)
df_calc['rank_6m'] = df_calc.groupby('date')['ret_6m'].transform(calc_rank)
df_calc['rank_12m'] = df_calc.groupby('date')['ret_12m'].transform(calc_rank)

# 4. 업로드
print("4. DB 업로드 시작...")

# NaN 처리
df_calc = df_calc.fillna(0)

upload_list = []
for _, row in df_calc.iterrows():
    upload_list.append({
        'date': row['date'].strftime('%Y-%m-%d'),
        'code': row['code'],
        'score_weighted': row['score_weighted'],
        'rank_weighted': int(row['rank_weighted']),
        'score_3m': row['ret_3m'],
        'rank_3m': int(row['rank_3m']),
        'score_6m': row['ret_6m'],
        'rank_6m': int(row['rank_6m']),
        'score_12m': row['ret_12m'],
        'rank_12m': int(row['rank_12m'])
    })

chunk_size = 2000
total_chunks = len(upload_list) // chunk_size + 1

for i in range(0, len(upload_list), chunk_size):
    chunk = upload_list[i:i+chunk_size]
    try:
        supabase.table('rs_rankings_v2').upsert(chunk, on_conflict="date, code").execute()
        print(f"   [{i // chunk_size + 1}/{total_chunks}] 업로드 중...", end='\r')
    except Exception as e:
        print(f"   ❌ 업로드 실패: {e}")
        time.sleep(1)

print("\n🎉 모든 작업 완료!")
