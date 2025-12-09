import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
import gc # 가비지 컬렉터 (메모리 청소부)

# 1. 설정 및 연결
load_dotenv('.env.local')
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

# 목표 기간 설정 (YYYY-MM-DD)
CALC_START_DATE_STR = '2024-01-01'
CALC_END_DATE_STR = '2025-12-08'

print(f"🚀 RS 랭킹 계산 시작 (기간: {CALC_START_DATE_STR} ~ {CALC_END_DATE_STR})")

# 1. 데이터 로딩 (계산 시작일 1년 전부터)
# 예: 2024년 1월 1일 랭킹을 계산하려면 2023년 1월 1일 데이터부터 필요 (1년 수익률 계산용)
load_start_date_dt = datetime.strptime(CALC_START_DATE_STR, '%Y-%m-%d') - timedelta(days=365)
load_start_date = load_start_date_dt.strftime('%Y-%m-%d')
load_end_date = datetime.strptime(CALC_END_DATE_STR, '%Y-%m-%d') + timedelta(days=1) # 종료일 포함

print(f"   📥 데이터 로딩 ({load_start_date} ~ {CALC_END_DATE_STR})...")

all_rows = []
chunk_limit = 10000
current_date_loop = datetime.strptime(load_start_date, "%Y-%m-%d")

# 월별로 끊어서 가져오기 (Supabase 타임아웃 방지)
while current_date_loop < load_end_date:
    next_month = current_date_loop + timedelta(days=32)
    next_month = next_month.replace(day=1) # 다음 달 1일
    if next_month > load_end_date: # 다음 달이 최종 로드 종료일을 넘으면
        next_month = load_end_date

    m_start = current_date_loop.strftime("%Y-%m-%d")
    m_end = (next_month - timedelta(days=1)).strftime("%Y-%m-%d") # 다음 달 1일 전까지

    print(f"      - {m_start} ~ {m_end} 데이터 조회 중...", end='\r')

    # 실제 쿼리
    chunk_offset = 0
    while True:
        res = supabase.table('daily_prices_v2') \
            .select('code, date, close') \
            .gte('date', m_start) \
            .lte('date', m_end) \
            .order('date') \
            .order('code') \
            .range(chunk_offset, chunk_offset + chunk_limit - 1) \
            .execute()
        
        if not res.data:
            break
            
        all_rows.extend(res.data)
        
        if len(res.data) < chunk_limit:
            break
        chunk_offset += chunk_limit
    
    current_date_loop = next_month
    
print(f"\n   ✅ {len(all_rows)}건 로드 완료. DataFrame 변환 중...")

if not all_rows:
    print("❌ 데이터가 없습니다. daily_prices_v2 테이블을 확인하세요.")
    exit()

df = pd.DataFrame(all_rows)
df['date'] = pd.to_datetime(df['date'])
df['close'] = df['close'].astype(float)

# 2. 지표 계산
print("2. 종목별 수익률 및 가중 점수 계산 중...")
df = df.sort_values(['code', 'date'])

P3 = 63 # 약 3개월 영업일
P6 = 126 # 약 6개월 영업일
P9 = 189 # 약 9개월 영업일
P12 = 252 # 약 12개월 영업일

# 수익률 계산
grouped = df.groupby('code')['close']
df['ret_3m'] = grouped.pct_change(P3)
df['ret_6m'] = grouped.pct_change(P6)
df['ret_12m'] = grouped.pct_change(P12)

# 가중 RS 점수 계산
s_now = df['close']
s_3m = grouped.shift(P3).replace(0, np.nan)
s_6m = grouped.shift(P6).replace(0, np.nan)
s_9m = grouped.shift(P9).replace(0, np.nan)
s_12m = grouped.shift(P12).replace(0, np.nan)

r1 = (s_now - s_3m) / s_3m
r2 = (s_3m - s_6m) / s_6m
r3 = (s_6m - s_9m) / s_9m
r4 = (s_9m - s_12m) / s_12m

df['score_weighted'] = (0.4 * r1) + (0.2 * r2) + (0.2 * r3) + (0.2 * r4)

# 3. 계산 대상 기간만 남기기
df_target = df[
    (df['date'] >= CALC_START_DATE_STR) & 
    (df['date'] <= CALC_END_DATE_STR)
].copy()

# 더 이상 필요 없는 큰 데이터 삭제 및 메모리 해제
del df, all_rows
gc.collect() 

if df_target.empty:
    print(f"   ⚠️ {CALC_START_DATE_STR} ~ {CALC_END_DATE_STR} 기간의 계산 결과가 없습니다.")
    exit()

# 4. 랭킹 산정
print("   🏆 랭킹(1~99) 매기는 중...")
def calc_rank(series):
    return (series.rank(pct=True) * 99).fillna(0).round().astype(int).clip(1, 99)

# 날짜별로 그룹화하여 랭크 계산
df_target['rank_weighted'] = df_target.groupby('date')['score_weighted'].transform(calc_rank)
df_target['rank_3m'] = df_target.groupby('date')['ret_3m'].transform(calc_rank)
df_target['rank_6m'] = df_target.groupby('date')['ret_6m'].transform(calc_rank)
df_target['rank_12m'] = df_target.groupby('date')['ret_12m'].transform(calc_rank)

# 5. DB 업로드
print(f"   💾 {CALC_START_DATE_STR} ~ {CALC_END_DATE_STR} 데이터 업로드 중 ({len(df_target)}건)...")

df_target = df_target.fillna(0)
upload_list = []

for _, row in df_target.iterrows():
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
    
# 청크 업로드
chunk_size = 5000 
total_chunks = len(upload_list) // chunk_size + 1

for i in range(0, len(upload_list), chunk_size):
    chunk = upload_list[i:i+chunk_size]
    try:
        supabase.table('rs_rankings_v2').upsert(chunk, on_conflict="date, code").execute()
        print(f"      [{i // chunk_size + 1}/{total_chunks}] 진행 중...", end='\r')
    except Exception as e:
        print(f"      ❌ 업로드 실패: {e}")
        time.sleep(1)
        
print(f"\n✨ {CALC_START_DATE_STR} ~ {CALC_END_DATE_STR} 기간 작업 완료!")

print("\n🎉 모든 히스토리 작업 완료!")