"""
최근 데이터만 계산 (데이터가 실제로 있는 기간만)

테마/업종 데이터가 최근에 추가된 경우를 위한 스크립트
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta
from typing import List, Dict, Optional

# 환경설정
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("[ERROR] Supabase credentials not found")
    exit(1)

supabase: Client = create_client(url, key)

print("=" * 60)
print("데이터 기간 자동 감지 및 계산")
print("=" * 60)

# 1. 실제 데이터가 있는 기간 확인
print("\n[STEP 1] 데이터 기간 확인 중...")

try:
    # 가격 데이터의 최근 날짜
    price_result = supabase.table('daily_prices_v2')\
        .select('date')\
        .order('date', desc=True)\
        .limit(1)\
        .execute()

    if not price_result.data:
        print("❌ 가격 데이터가 없습니다!")
        exit(1)

    latest_price_date = price_result.data[0]['date']
    print(f"✓ 가격 데이터 최근 날짜: {latest_price_date}")

    # 테마 데이터의 최근 등록일
    theme_result = supabase.table('company_themes')\
        .select('created_at')\
        .order('created_at', desc=True)\
        .limit(1)\
        .execute()

    if theme_result.data:
        latest_theme_date = theme_result.data[0]['created_at'][:10]
        print(f"✓ 테마 데이터 최근 등록: {latest_theme_date}")

    # 업종 데이터의 최근 등록일
    industry_result = supabase.table('company_industries')\
        .select('created_at')\
        .order('created_at', desc=True)\
        .limit(1)\
        .execute()

    if industry_result.data:
        latest_industry_date = industry_result.data[0]['created_at'][:10]
        print(f"✓ 업종 데이터 최근 등록: {latest_industry_date}")

except Exception as e:
    print(f"❌ 데이터 확인 실패: {e}")
    exit(1)

# 2. 계산 기간 결정 (최근 가격 데이터부터 14일 전까지만)
end_date = latest_price_date
start_date_dt = datetime.strptime(end_date, '%Y-%m-%d') - timedelta(days=14)
start_date = start_date_dt.strftime('%Y-%m-%d')

print(f"\n[STEP 2] 계산 기간: {start_date} ~ {end_date}")
print("(최근 14일만 계산합니다)")

# 3. 기존 스크립트 함수 import 및 실행
try:
    import sys
    sys.path.append(current_dir)

    from calculate_equal_weight_indices import (
        calculate_theme_indices,
        calculate_industry_indices
    )

    print("\n[STEP 3] 등가중 지수 계산 중...")
    calculate_theme_indices(start_date, end_date)
    calculate_industry_indices(start_date, end_date)

    print("\n✅ 등가중 지수 계산 완료!")

except Exception as e:
    print(f"\n❌ 계산 실패: {e}")
    print("\n수동 실행이 필요합니다:")
    print(f"python scripts/calculate_equal_weight_indices.py")
    exit(1)

# 4. 거래대금 지표 계산
try:
    from calculate_trading_metrics import (
        calculate_theme_trading_metrics,
        calculate_industry_trading_metrics
    )

    print("\n[STEP 4] 거래대금 지표 계산 중...")
    calculate_theme_trading_metrics(start_date, end_date)
    calculate_industry_trading_metrics(start_date, end_date)

    print("\n✅ 거래대금 지표 계산 완료!")

except Exception as e:
    print(f"\n❌ 계산 실패: {e}")
    print("\n수동 실행이 필요합니다:")
    print(f"python scripts/calculate_trading_metrics.py")
    exit(1)

print("\n" + "=" * 60)
print("🎉 계산 완료!")
print("=" * 60)
print(f"\n계산된 기간: {start_date} ~ {end_date}")
print("페이지를 새로고침하여 확인하세요.")
print("\n더 긴 기간이 필요하면 개별 스크립트에서 날짜를 수정하세요.")
