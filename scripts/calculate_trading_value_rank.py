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

# ==============================================================================
# 📅 설정: 계산할 기간 지정
# 워크플로에서 매일 실행 시 '오늘 날짜'의 랭킹을 계산합니다.
# 과거 특정 기간을 일괄 계산하려면 아래 주석 처리된 부분을 사용하세요.
# ==============================================================================
TARGET_DATE = datetime.now().strftime('%Y-%m-%d')
CALC_START_DATE = TARGET_DATE # '2025-01-01'
CALC_END_DATE = TARGET_DATE   # '2025-12-09'

print(f"🚀 거래대금 랭킹(50일/60일) 일괄 계산 시작")
print(f"📅 대상 기간: {CALC_START_DATE} ~ {CALC_END_DATE}")

# 1. 데이터 로딩 (이동평균 계산을 위해 시작일보다 넉넉히 100일 전부터 로드)
# 60일 이동평균을 구하려면 최소 60일 전 데이터가 필요
FETCH_START_DATE = (datetime.strptime(CALC_START_DATE, '%Y-%m-%d') - timedelta(days=100)).strftime('%Y-%m-%d')

print(f"1. 주가 데이터 로딩 중 ({FETCH_START_DATE} ~ {CALC_END_DATE})...")
print("   (기간이 길어 시간이 걸릴 수 있습니다)")

try:
    all_rows = []
    
    # 날짜별 루프로 변경 (대량 데이터 offset 타임아웃 방지)
    # 하루치 데이터(약 2500건)씩 끊어서 가져옴
    curr = datetime.strptime(FETCH_START_DATE, '%Y-%m-%d')
    end = datetime.strptime(CALC_END_DATE, '%Y-%m-%d')
    
    print(f"   (안전한 로딩을 위해 날짜별로 나누어 가져옵니다)")
    
    while curr <= end:
        target_day = curr.strftime('%Y-%m-%d')
        
        day_offset = 0
        while True:
            res = supabase.table('daily_prices_v2') \
                .select('code, date, close, volume') \
                .eq('date', target_day) \
                .range(day_offset, day_offset + 999) \
                .execute()
            
            if not res.data:
                break
                
            all_rows.extend(res.data)
            
            if len(res.data) < 1000:
                break
            
            day_offset += 1000
            
        print(f"   {target_day}: 누적 {len(all_rows)}건 로드 중...", end='\r')
        curr += timedelta(days=1)

    print(f"\n✅ 로드 완료: {len(all_rows)}건")
    
    if not all_rows:
        print("❌ 데이터가 없습니다.")
        exit()

    df = pd.DataFrame(all_rows)
    df['date'] = pd.to_datetime(df['date'])
    df['close'] = df['close'].astype(float)
    df['volume'] = df['volume'].fillna(0).astype(float)
    df['amount'] = df['close'] * df['volume']
    
except Exception as e:
    print(f"\n❌ 데이터 로드 실패: {e}")
    exit()

# 2. 지표 계산
print("2. 이동평균 거래대금(50일, 60일) 계산 중...")

# 종목별, 날짜별 정렬
df = df.sort_values(['code', 'date'])

# GroupBy 객체 미리 생성
grp = df.groupby('code')['amount']

# 50일 평균
df['avg_amount_50'] = grp.transform(lambda x: x.rolling(window=50, min_periods=20).mean())
# 60일 평균 (신규)
df['avg_amount_60'] = grp.transform(lambda x: x.rolling(window=60, min_periods=20).mean())

# 3. 랭킹 산정 대상 필터링
print("3. 기간 내 데이터 필터링 및 랭킹 산정...")

# 계산 기간(CALC_START ~ CALC_END)에 해당하는 데이터만 남김
mask = (df['date'] >= CALC_START_DATE) & (df['date'] <= CALC_END_DATE)
df_target = df[mask].copy()

if df_target.empty:
    print("❌ 해당 기간에 계산할 데이터가 없습니다.")
    exit()

# NaN 제거 (평균 거래대금 없는 경우)
df_target = df_target.dropna(subset=['avg_amount_50', 'avg_amount_60'], how='all')

# 날짜별 랭킹 계산 함수
def calc_rank_daily(df_daily, col_name):
    # 백분위 랭킹 -> 0~99 점수화
    return (df_daily[col_name].rank(pct=True) * 99).fillna(0).round().astype(int).clip(1, 99)

# 날짜별로 그룹화하여 랭킹 계산
print("   날짜별 랭킹 계산 중...")
df_target['rank_amount'] = df_target.groupby('date')['avg_amount_50'].transform(lambda x: (x.rank(pct=True) * 99).fillna(0).round().astype(int))
df_target['rank_amount_60'] = df_target.groupby('date')['avg_amount_60'].transform(lambda x: (x.rank(pct=True) * 99).fillna(0).round().astype(int))

# 4. 업로드
print(f"4. DB 업로드 시작 (총 {len(df_target)}건)...")

upload_list = []
for _, row in df_target.iterrows():
    upload_list.append({
        'date': row['date'].strftime('%Y-%m-%d'),
        'code': row['code'],
        'avg_amount_50': float(row['avg_amount_50']) if not pd.isna(row['avg_amount_50']) else None,
        'rank_amount': int(row['rank_amount']) if not pd.isna(row['rank_amount']) else 0,
        'avg_amount_60': float(row['avg_amount_60']) if not pd.isna(row['avg_amount_60']) else None,
        'rank_amount_60': int(row['rank_amount_60']) if not pd.isna(row['rank_amount_60']) else 0
    })

chunk_size = 2000 # 타임아웃 방지를 위해 청크 사이즈 축소
total_chunks = len(upload_list) // chunk_size + 1

for i in range(0, len(upload_list), chunk_size):
    chunk = upload_list[i:i+chunk_size]
    try:
        supabase.table('trading_value_rankings').upsert(chunk, on_conflict="date, code").execute()
        print(f"   [{i // chunk_size + 1}/{total_chunks}] 업로드 완료 ({len(chunk)}건)", end='\r')
    except Exception as e:
        print(f"\n   ❌ 업로드 실패 (청크 {i}): {e}")
        time.sleep(1)

print("\n\n🎉 기간 내 모든 거래대금 랭킹(50일/60일) 업데이트 완료!")