import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

# 기준일: 2025-12-08로 고정
TARGET_DATE = '2026-02-04'

print(f"🚀 V2 데일리 RS 랭킹 계산 시작 (Target Date: {TARGET_DATE})")

# 1. 필요 데이터 로딩 (최근 1년 + 여유분)
# 12개월 RS를 구하려면 252거래일 전 데이터가 필요하므로, 넉넉히 380일 전부터 로드
FETCH_START_DATE = (datetime.strptime(TARGET_DATE, '%Y-%m-%d') - timedelta(days=400)).strftime('%Y-%m-%d')

print(f"1. 주가 데이터 로딩 중 ({FETCH_START_DATE} ~ {TARGET_DATE})...")

try:
    all_rows = []
    chunk_limit = 10000
    last_date = None
    last_code = None

    while True:
        # 날짜 범위로 필터링하여 데이터 조회
        query = supabase.table('daily_prices_v2') \
            .select('code, date, close') \
            .gte('date', FETCH_START_DATE) \
            .lte('date', TARGET_DATE) \
            .order('date') \
            .order('code') \
            .limit(chunk_limit)

        # Keyset pagination: (date > last_date) OR (date = last_date AND code > last_code)
        if last_date is not None and last_code is not None:
            query = query.or_(f"and(date.eq.{last_date},code.gt.{last_code}),date.gt.{last_date}")

        res = query.execute()

        if not res.data:
            break

        all_rows.extend(res.data)

        if len(res.data) < chunk_limit:
            break

        last_date = res.data[-1]['date']
        last_code = res.data[-1]['code']
        print(f"   {len(all_rows)}건 로드 중...", end='\r')

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

# 각 종목별로 계산
# 전체 기간에 대해 pct_change를 계산하면 느리므로,
# tail을 이용해서 마지막 날짜(TARGET_DATE)가 포함된 그룹만 처리하면 좋지만,
# pandas pct_change 특성상 전체에 대해 하고 마지막 날만 뽑는 게 코드는 간단함.
# 데이터가 1년치라 빠름.

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

# [핵심] TARGET_DATE에 해당하는 데이터만 추출
# 디버깅: 날짜 형식 확인
print(f"\n[디버깅] df의 날짜 범위:")
print(f"   - 최소 날짜: {df['date'].min()}")
print(f"   - 최대 날짜: {df['date'].max()}")
print(f"   - TARGET_DATE: {TARGET_DATE}")
print(f"   - df['date'].dtype: {df['date'].dtype}")

# 날짜별 데이터 개수 확인
date_counts = df['date'].value_counts().sort_index()
print(f"\n[디버깅] 최근 5일 데이터 개수:")
for date, count in date_counts.tail(5).items():
    print(f"   - {date.strftime('%Y-%m-%d')}: {count}개")

# datetime 타입으로 변환해서 비교
target_datetime = pd.to_datetime(TARGET_DATE)
df_today = df[df['date'] == target_datetime].copy()

print(f"\n[디버깅] 필터링 후 df_today 크기: {len(df_today)}개")

if df_today.empty:
    print(f"❌ {TARGET_DATE} 일자에 해당하는 데이터가 없습니다. 주가 업데이트가 선행되었는지 확인하세요.")
    exit()

print(f"✅ 지표 계산 완료. 랭킹 산정 대상: {len(df_today)}건 ({TARGET_DATE})")

# 3. 랭킹 산정 (오늘 날짜 1일치에 대해서만 수행)
print("3. 랭킹(1~99) 산정 중...")

def calc_rank_single_day(series):
    # 단일 날짜 데이터이므로 groupby 없이 바로 rank
    return (series.rank(pct=True) * 99).fillna(0).round().astype(int).clip(1, 99)

df_today['rank_weighted'] = calc_rank_single_day(df_today['score_weighted'])
df_today['rank_3m'] = calc_rank_single_day(df_today['ret_3m'])
df_today['rank_6m'] = calc_rank_single_day(df_today['ret_6m'])
df_today['rank_12m'] = calc_rank_single_day(df_today['ret_12m'])

# 4. 업로드
print("4. DB 업로드 시작...")

# NaN 처리
df_today = df_today.fillna(0)

# 중복 확인 및 제거
print(f"\n[디버깅] 중복 확인:")
duplicates = df_today['code'].duplicated().sum()
print(f"   - 중복 종목코드: {duplicates}개")

if duplicates > 0:
    dup_codes = df_today[df_today['code'].duplicated(keep=False)]['code'].unique()
    print(f"   - 중복된 종목코드 샘플 (최대 10개): {dup_codes[:10]}")

    # 중복 제거: 각 종목코드별로 첫 번째 행만 유지
    df_today = df_today.drop_duplicates(subset=['code'], keep='first')
    print(f"   - 중복 제거 후: {len(df_today)}개")

upload_list = []
for _, row in df_today.iterrows():
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
        print(f"   [{i // chunk_size + 1}/{total_chunks}] 업로드 완료")
    except Exception as e:
        print(f"   ❌ 업로드 실패: {e}")
        time.sleep(1)

print("\n🎉 오늘의 RS 계산 및 업로드 완료!")
