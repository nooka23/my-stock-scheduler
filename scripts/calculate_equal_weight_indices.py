"""
테마/업종별 등가중 지수 계산 스크립트

- 각 테마/업종에 속한 종목들의 일일 수익률을 등가중 평균하여 지수 계산
- 지수는 100부터 시작하여 일별 수익률을 누적 적용
- theme_indices, industry_indices 테이블에 저장
"""

import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta
from typing import List, Dict, Optional

# ---------------------------------------------------------
# 1. 환경설정
# ---------------------------------------------------------
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"[ENV] Loading from: {env_path}")
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("[ERROR] Supabase credentials not found")
    exit(1)

supabase: Client = create_client(url, key)

# ---------------------------------------------------------
# 2. 유틸리티 함수
# ---------------------------------------------------------
def get_trading_dates(start_date: str, end_date: str) -> List[str]:
    """거래일 목록 가져오기 (daily_prices_v2에 데이터가 있는 날짜)"""
    try:
        response = supabase.table('daily_prices_v2')\
            .select('date')\
            .gte('date', start_date)\
            .lte('date', end_date)\
            .order('date')\
            .execute()

        dates = sorted(list(set([row['date'] for row in response.data])))
        return dates
    except Exception as e:
        print(f"[ERROR] Failed to get trading dates: {e}")
        return []

def get_theme_companies(theme_id: int) -> List[str]:
    """특정 테마에 속한 종목 코드 리스트"""
    try:
        response = supabase.table('company_themes')\
            .select('company_code')\
            .eq('theme_id', theme_id)\
            .execute()

        return [row['company_code'] for row in response.data]
    except Exception as e:
        print(f"[ERROR] Failed to get theme companies: {e}")
        return []

def get_industry_companies(industry_id: int) -> List[str]:
    """특정 업종에 속한 종목 코드 리스트"""
    try:
        response = supabase.table('company_industries')\
            .select('company_code')\
            .eq('industry_id', industry_id)\
            .execute()

        return [row['company_code'] for row in response.data]
    except Exception as e:
        print(f"[ERROR] Failed to get industry companies: {e}")
        return []

def get_stock_prices(codes: List[str], date: str) -> Dict[str, float]:
    """특정 날짜의 종목별 종가 가져오기"""
    if not codes:
        return {}

    try:
        # Supabase의 in_ 필터 사용 (최대 1000개까지 지원)
        # 종목이 많을 경우 배치 처리 필요
        batch_size = 1000
        all_prices = {}

        for i in range(0, len(codes), batch_size):
            batch_codes = codes[i:i+batch_size]

            response = supabase.table('daily_prices_v2')\
                .select('code, close')\
                .eq('date', date)\
                .in_('code', batch_codes)\
                .execute()

            for row in response.data:
                if row['close']:
                    all_prices[row['code']] = float(row['close'])

        return all_prices
    except Exception as e:
        print(f"[ERROR] Failed to get stock prices: {e}")
        return {}

def calculate_equal_weight_return(codes: List[str], current_date: str, previous_date: str) -> Optional[Dict]:
    """등가중 수익률 계산"""

    # 현재일과 전일 종가 가져오기
    current_prices = get_stock_prices(codes, current_date)
    previous_prices = get_stock_prices(codes, previous_date)

    # 양쪽 날짜에 모두 데이터가 있는 종목만 계산
    valid_codes = set(current_prices.keys()) & set(previous_prices.keys())

    if not valid_codes:
        return None

    # 각 종목의 수익률 계산
    returns = []
    for code in valid_codes:
        prev_price = previous_prices[code]
        curr_price = current_prices[code]

        if prev_price > 0:
            daily_return = ((curr_price - prev_price) / prev_price) * 100
            returns.append(daily_return)

    if not returns:
        return None

    # 등가중 평균
    avg_return = sum(returns) / len(returns)
    avg_close = sum(current_prices.values()) / len(current_prices)

    return {
        'daily_return': avg_return,
        'stock_count': len(valid_codes),
        'avg_close': avg_close
    }

# ---------------------------------------------------------
# 3. 테마 지수 계산
# ---------------------------------------------------------
def calculate_theme_indices(start_date: str, end_date: str):
    """테마별 등가중 지수 계산"""

    print("\n[STEP 1] Calculating Theme Indices...")

    # 모든 테마 가져오기
    try:
        response = supabase.table('themes').select('id, code, name').execute()
        themes = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load themes: {e}")
        return

    # 거래일 목록
    trading_dates = get_trading_dates(start_date, end_date)
    if not trading_dates:
        print("[ERROR] No trading dates found")
        return

    print(f"[INFO] Processing {len(themes)} themes for {len(trading_dates)} trading days")

    # 각 테마별로 지수 계산
    for idx, theme in enumerate(themes):
        theme_id = theme['id']
        theme_name = theme['name']

        print(f"[{idx+1}/{len(themes)}] {theme_name}...", end=" ")

        # 해당 테마의 종목 코드들
        company_codes = get_theme_companies(theme_id)

        if not company_codes:
            print("No companies")
            continue

        # 날짜별 지수 계산
        index_records = []
        current_index = 100.0  # 초기 지수값

        for date_idx, current_date in enumerate(trading_dates):
            # 첫날은 100으로 시작
            if date_idx == 0:
                index_records.append({
                    'theme_id': theme_id,
                    'date': current_date,
                    'index_value': current_index,
                    'daily_return': 0.0,
                    'stock_count': len(company_codes),
                    'avg_close': 0,
                    'total_market_cap': 0
                })
                continue

            # 전일 대비 수익률 계산
            previous_date = trading_dates[date_idx - 1]
            result = calculate_equal_weight_return(company_codes, current_date, previous_date)

            if result is None:
                # 데이터 없으면 지수 유지
                index_records.append({
                    'theme_id': theme_id,
                    'date': current_date,
                    'index_value': current_index,
                    'daily_return': 0.0,
                    'stock_count': 0,
                    'avg_close': 0,
                    'total_market_cap': 0
                })
                continue

            # 새 지수값 계산
            daily_return = result['daily_return']
            current_index = current_index * (1 + daily_return / 100)

            index_records.append({
                'theme_id': theme_id,
                'date': current_date,
                'index_value': round(current_index, 4),
                'daily_return': round(daily_return, 4),
                'stock_count': result['stock_count'],
                'avg_close': round(result['avg_close'], 2),
                'total_market_cap': 0  # 추후 계산 가능
            })

        # DB에 저장 (upsert)
        try:
            if index_records:
                # 기존 데이터 삭제
                supabase.table('theme_indices')\
                    .delete()\
                    .eq('theme_id', theme_id)\
                    .gte('date', start_date)\
                    .lte('date', end_date)\
                    .execute()

                # 새 데이터 삽입 (배치로 나눠서)
                batch_size = 1000
                for i in range(0, len(index_records), batch_size):
                    batch = index_records[i:i+batch_size]
                    supabase.table('theme_indices').insert(batch).execute()

                print(f"OK ({len(index_records)} records)")
        except Exception as e:
            print(f"DB Error: {e}")

# ---------------------------------------------------------
# 4. 업종 지수 계산
# ---------------------------------------------------------
def calculate_industry_indices(start_date: str, end_date: str):
    """업종별 등가중 지수 계산"""

    print("\n[STEP 2] Calculating Industry Indices...")

    # 모든 업종 가져오기
    try:
        response = supabase.table('industries').select('id, code, name').execute()
        industries = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load industries: {e}")
        return

    # 거래일 목록
    trading_dates = get_trading_dates(start_date, end_date)
    if not trading_dates:
        print("[ERROR] No trading dates found")
        return

    print(f"[INFO] Processing {len(industries)} industries for {len(trading_dates)} trading days")

    # 각 업종별로 지수 계산
    for idx, industry in enumerate(industries):
        industry_id = industry['id']
        industry_name = industry['name']

        print(f"[{idx+1}/{len(industries)}] {industry_name}...", end=" ")

        # 해당 업종의 종목 코드들
        company_codes = get_industry_companies(industry_id)

        if not company_codes:
            print("No companies")
            continue

        # 날짜별 지수 계산
        index_records = []
        current_index = 100.0

        for date_idx, current_date in enumerate(trading_dates):
            if date_idx == 0:
                index_records.append({
                    'industry_id': industry_id,
                    'date': current_date,
                    'index_value': current_index,
                    'daily_return': 0.0,
                    'stock_count': len(company_codes),
                    'avg_close': 0,
                    'total_market_cap': 0
                })
                continue

            previous_date = trading_dates[date_idx - 1]
            result = calculate_equal_weight_return(company_codes, current_date, previous_date)

            if result is None:
                index_records.append({
                    'industry_id': industry_id,
                    'date': current_date,
                    'index_value': current_index,
                    'daily_return': 0.0,
                    'stock_count': 0,
                    'avg_close': 0,
                    'total_market_cap': 0
                })
                continue

            daily_return = result['daily_return']
            current_index = current_index * (1 + daily_return / 100)

            index_records.append({
                'industry_id': industry_id,
                'date': current_date,
                'index_value': round(current_index, 4),
                'daily_return': round(daily_return, 4),
                'stock_count': result['stock_count'],
                'avg_close': round(result['avg_close'], 2),
                'total_market_cap': 0
            })

        # DB에 저장
        try:
            if index_records:
                supabase.table('industry_indices')\
                    .delete()\
                    .eq('industry_id', industry_id)\
                    .gte('date', start_date)\
                    .lte('date', end_date)\
                    .execute()

                batch_size = 1000
                for i in range(0, len(index_records), batch_size):
                    batch = index_records[i:i+batch_size]
                    supabase.table('industry_indices').insert(batch).execute()

                print(f"OK ({len(index_records)} records)")
        except Exception as e:
            print(f"DB Error: {e}")

# ---------------------------------------------------------
# 5. 메인 실행
# ---------------------------------------------------------
def main():
    print("=" * 60)
    print("Equal Weight Index Calculation")
    print("=" * 60)

    # 계산 기간 설정 (최근 1년)
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')

    print(f"\n[INFO] Calculation Period: {start_date} ~ {end_date}")

    # 테마 지수 계산
    calculate_theme_indices(start_date, end_date)

    # 업종 지수 계산
    calculate_industry_indices(start_date, end_date)

    print("\n" + "=" * 60)
    print("[DONE] Index calculation completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()
