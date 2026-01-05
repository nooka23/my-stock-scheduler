"""
빠른 테스트용: 최근 30일만 지수 계산
전체 계산 전에 동작 확인용
"""

import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

# 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

load_dotenv(dotenv_path=env_path)

# 기존 스크립트의 함수들 import
sys.path.append(current_dir)

print("=" * 60)
print("빠른 테스트: 최근 30일 데이터만 계산")
print("=" * 60)

# 계산 기간: 최근 30일
end_date = datetime.now().strftime('%Y-%m-%d')
start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')

print(f"\n계산 기간: {start_date} ~ {end_date}")
print("\n1단계: 등가중 지수 계산 중...")

try:
    from calculate_equal_weight_indices import (
        calculate_theme_indices,
        calculate_industry_indices
    )

    # 테마 지수 계산 (최근 30일)
    calculate_theme_indices(start_date, end_date)

    # 업종 지수 계산 (최근 30일)
    calculate_industry_indices(start_date, end_date)

    print("\n✅ 1단계 완료!")

except Exception as e:
    print(f"\n❌ 1단계 오류: {e}")
    print("\n아래 명령어로 직접 실행하세요:")
    print("python scripts/calculate_equal_weight_indices.py")
    exit(1)

print("\n2단계: 거래대금 지표 계산 중...")

try:
    from calculate_trading_metrics import (
        calculate_theme_trading_metrics,
        calculate_industry_trading_metrics
    )

    # 테마 거래대금 지표 계산
    calculate_theme_trading_metrics(start_date, end_date)

    # 업종 거래대금 지표 계산
    calculate_industry_trading_metrics(start_date, end_date)

    print("\n✅ 2단계 완료!")

except Exception as e:
    print(f"\n❌ 2단계 오류: {e}")
    print("\n아래 명령어로 직접 실행하세요:")
    print("python scripts/calculate_trading_metrics.py")
    exit(1)

print("\n" + "=" * 60)
print("🎉 빠른 테스트 완료!")
print("=" * 60)
print("\n페이지를 새로고침하면 최근 30일 데이터를 볼 수 있습니다.")
print("전체 데이터가 필요하면 개별 스크립트를 실행하세요:")
print("  1. python scripts/calculate_equal_weight_indices.py")
print("  2. python scripts/calculate_trading_metrics.py")
