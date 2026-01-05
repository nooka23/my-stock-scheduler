"""
테마/업종별 거래대금 지표 계산 스크립트

계산 지표:
1. 거래대금 비중: (테마/업종 거래대금 / 전체 시장 거래대금) × 100
2. 거래대금 가중 수익률: Σ(종목 수익률 × 테마 내 거래대금 비중)
3. 거래대금 급증 비율: 당일 거래대금 / 20일 평균 거래대금
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
    """거래일 목록 가져오기"""
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

def get_market_trading_value(date: str) -> float:
    """전체 시장의 거래대금 계산"""
    try:
        response = supabase.table('daily_prices_v2')\
            .select('close, volume')\
            .eq('date', date)\
            .execute()

        total = 0
        for row in response.data:
            if row['close'] and row['volume']:
                trading_value = float(row['close']) * float(row['volume'])
                total += trading_value

        return total
    except Exception as e:
        print(f"[ERROR] Failed to get market trading value: {e}")
        return 0

def get_stock_data(codes: List[str], date: str) -> Dict[str, Dict]:
    """특정 날짜의 종목별 가격/거래량 데이터"""
    if not codes:
        return {}

    try:
        batch_size = 1000
        all_data = {}

        for i in range(0, len(codes), batch_size):
            batch_codes = codes[i:i+batch_size]

            response = supabase.table('daily_prices_v2')\
                .select('code, close, volume')\
                .eq('date', date)\
                .in_('code', batch_codes)\
                .execute()

            for row in response.data:
                if row['close'] and row['volume']:
                    all_data[row['code']] = {
                        'close': float(row['close']),
                        'volume': float(row['volume']),
                        'trading_value': float(row['close']) * float(row['volume'])
                    }

        return all_data
    except Exception as e:
        print(f"[ERROR] Failed to get stock data: {e}")
        return {}

def get_20d_avg_trading_value(codes: List[str], end_date: str) -> Dict[str, float]:
    """종목별 20일 평균 거래대금 계산"""
    if not codes:
        return {}

    try:
        # 20일 전 날짜 계산
        end_dt = datetime.strptime(end_date, '%Y-%m-%d')
        start_dt = end_dt - timedelta(days=30)  # 여유있게 30일
        start_date = start_dt.strftime('%Y-%m-%d')

        batch_size = 1000
        all_avg = {}

        for i in range(0, len(codes), batch_size):
            batch_codes = codes[i:i+batch_size]

            response = supabase.table('daily_prices_v2')\
                .select('code, date, close, volume')\
                .in_('code', batch_codes)\
                .gte('date', start_date)\
                .lt('date', end_date)\
                .order('date', desc=True)\
                .execute()

            # 종목별로 그룹화
            code_data = {}
            for row in response.data:
                code = row['code']
                if code not in code_data:
                    code_data[code] = []

                if row['close'] and row['volume']:
                    trading_value = float(row['close']) * float(row['volume'])
                    code_data[code].append(trading_value)

            # 최근 20일 평균 계산
            for code, values in code_data.items():
                recent_20 = values[:20]
                if recent_20:
                    all_avg[code] = sum(recent_20) / len(recent_20)

        return all_avg
    except Exception as e:
        print(f"[ERROR] Failed to get 20d avg trading value: {e}")
        return {}

def calculate_trading_metrics(
    codes: List[str],
    current_date: str,
    previous_date: str,
    market_total: float
) -> Optional[Dict]:
    """거래대금 지표 계산"""

    # 현재일 데이터
    current_data = get_stock_data(codes, current_date)
    if not current_data:
        return None

    # 전일 데이터 (수익률 계산용)
    previous_data = get_stock_data(codes, previous_date)

    # 20일 평균 거래대금
    avg_20d = get_20d_avg_trading_value(codes, current_date)

    # 1. 총 거래대금 계산
    total_trading_value = sum([d['trading_value'] for d in current_data.values()])

    # 2. 거래대금 비중
    trading_value_ratio = 0
    if market_total > 0:
        trading_value_ratio = (total_trading_value / market_total) * 100

    # 3. 거래대금 가중 수익률 계산
    weighted_returns = []
    for code, curr in current_data.items():
        if code in previous_data:
            prev_price = previous_data[code]['close']
            curr_price = curr['close']

            if prev_price > 0:
                # 종목 수익률
                stock_return = ((curr_price - prev_price) / prev_price) * 100

                # 해당 종목의 거래대금 비중
                weight = curr['trading_value'] / total_trading_value if total_trading_value > 0 else 0

                # 가중 수익률
                weighted_returns.append(stock_return * weight)

    weighted_return = sum(weighted_returns) if weighted_returns else 0

    # 4. 거래대금 급증 비율 계산
    surge_ratios = []
    surge_count = 0

    for code, curr in current_data.items():
        if code in avg_20d and avg_20d[code] > 0:
            surge_ratio = curr['trading_value'] / avg_20d[code]
            surge_ratios.append(surge_ratio)

            if surge_ratio >= 2.0:
                surge_count += 1

    avg_surge_ratio = sum(surge_ratios) / len(surge_ratios) if surge_ratios else 0

    return {
        'total_trading_value': round(total_trading_value, 2),
        'market_trading_value': round(market_total, 2),
        'trading_value_ratio': round(trading_value_ratio, 4),
        'weighted_return': round(weighted_return, 4),
        'avg_surge_ratio': round(avg_surge_ratio, 4),
        'surge_count': surge_count,
        'total_stock_count': len(current_data)
    }

# ---------------------------------------------------------
# 3. 테마 거래대금 지표 계산
# ---------------------------------------------------------
def calculate_theme_trading_metrics(start_date: str, end_date: str):
    """테마별 거래대금 지표 계산"""

    print("\n[STEP 1] Calculating Theme Trading Metrics...")

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

    # 각 테마별로 지표 계산
    for idx, theme in enumerate(themes):
        theme_id = theme['id']
        theme_name = theme['name']

        print(f"[{idx+1}/{len(themes)}] {theme_name}...", end=" ")

        # 해당 테마의 종목 코드들
        company_codes = get_theme_companies(theme_id)

        if not company_codes:
            print("No companies")
            continue

        # 날짜별 지표 계산
        metrics_records = []

        for date_idx, current_date in enumerate(trading_dates):
            # 첫날은 이전 데이터가 없으므로 스킵
            if date_idx == 0:
                continue

            previous_date = trading_dates[date_idx - 1]

            # 시장 전체 거래대금
            market_total = get_market_trading_value(current_date)

            if market_total == 0:
                continue

            # 거래대금 지표 계산
            result = calculate_trading_metrics(
                company_codes,
                current_date,
                previous_date,
                market_total
            )

            if result is None:
                continue

            metrics_records.append({
                'theme_id': theme_id,
                'date': current_date,
                **result
            })

        # DB에 저장 (upsert)
        try:
            if metrics_records:
                # 기존 데이터 삭제
                supabase.table('theme_trading_metrics')\
                    .delete()\
                    .eq('theme_id', theme_id)\
                    .gte('date', start_date)\
                    .lte('date', end_date)\
                    .execute()

                # 새 데이터 삽입
                batch_size = 1000
                for i in range(0, len(metrics_records), batch_size):
                    batch = metrics_records[i:i+batch_size]
                    supabase.table('theme_trading_metrics').insert(batch).execute()

                print(f"OK ({len(metrics_records)} records)")
            else:
                print("No data")
        except Exception as e:
            print(f"DB Error: {e}")

# ---------------------------------------------------------
# 4. 업종 거래대금 지표 계산
# ---------------------------------------------------------
def calculate_industry_trading_metrics(start_date: str, end_date: str):
    """업종별 거래대금 지표 계산"""

    print("\n[STEP 2] Calculating Industry Trading Metrics...")

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

    # 각 업종별로 지표 계산
    for idx, industry in enumerate(industries):
        industry_id = industry['id']
        industry_name = industry['name']

        print(f"[{idx+1}/{len(industries)}] {industry_name}...", end=" ")

        # 해당 업종의 종목 코드들
        company_codes = get_industry_companies(industry_id)

        if not company_codes:
            print("No companies")
            continue

        # 날짜별 지표 계산
        metrics_records = []

        for date_idx, current_date in enumerate(trading_dates):
            if date_idx == 0:
                continue

            previous_date = trading_dates[date_idx - 1]
            market_total = get_market_trading_value(current_date)

            if market_total == 0:
                continue

            result = calculate_trading_metrics(
                company_codes,
                current_date,
                previous_date,
                market_total
            )

            if result is None:
                continue

            metrics_records.append({
                'industry_id': industry_id,
                'date': current_date,
                **result
            })

        # DB에 저장
        try:
            if metrics_records:
                supabase.table('industry_trading_metrics')\
                    .delete()\
                    .eq('industry_id', industry_id)\
                    .gte('date', start_date)\
                    .lte('date', end_date)\
                    .execute()

                batch_size = 1000
                for i in range(0, len(metrics_records), batch_size):
                    batch = metrics_records[i:i+batch_size]
                    supabase.table('industry_trading_metrics').insert(batch).execute()

                print(f"OK ({len(metrics_records)} records)")
            else:
                print("No data")
        except Exception as e:
            print(f"DB Error: {e}")

# ---------------------------------------------------------
# 5. 메인 실행
# ---------------------------------------------------------
def main():
    print("=" * 60)
    print("Trading Metrics Calculation")
    print("=" * 60)

    # 계산 기간 설정 (최근 3개월)
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')

    print(f"\n[INFO] Calculation Period: {start_date} ~ {end_date}")

    # 테마 거래대금 지표 계산
    calculate_theme_trading_metrics(start_date, end_date)

    # 업종 거래대금 지표 계산
    calculate_industry_trading_metrics(start_date, end_date)

    print("\n" + "=" * 60)
    print("[DONE] Trading metrics calculation completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()
