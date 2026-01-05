"""
개선된 지수 계산: 구성 종목 매핑 날짜 고려

- 각 테마/업종의 company_themes/company_industries 테이블의 created_at을 확인
- 가장 최근 매핑 날짜 이후부터만 계산 (안전한 기간만)
- 지수 100 = 매핑 데이터의 가장 최근 변경일
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

def get_theme_mapping_date(theme_id: int) -> str:
    """테마 매핑의 가장 최근 변경일 확인"""
    try:
        response = supabase.table('company_themes')\
            .select('created_at')\
            .eq('theme_id', theme_id)\
            .order('created_at', desc=True)\
            .limit(1)\
            .execute()

        if response.data:
            # created_at은 timestamp이므로 날짜만 추출
            return response.data[0]['created_at'][:10]
        return None
    except Exception as e:
        print(f"[ERROR] Failed to get mapping date: {e}")
        return None

def get_industry_mapping_date(industry_id: int) -> str:
    """업종 매핑의 가장 최근 변경일 확인"""
    try:
        response = supabase.table('company_industries')\
            .select('created_at')\
            .eq('industry_id', industry_id)\
            .order('created_at', desc=True)\
            .limit(1)\
            .execute()

        if response.data:
            return response.data[0]['created_at'][:10]
        return None
    except Exception as e:
        print(f"[ERROR] Failed to get mapping date: {e}")
        return None

print("=" * 60)
print("개선된 지수 계산: 매핑 날짜 기준")
print("=" * 60)

# 기존 스크립트 import
import sys
sys.path.append(current_dir)

try:
    from calculate_equal_weight_indices import (
        get_trading_dates,
        get_theme_companies,
        get_industry_companies,
        calculate_equal_weight_return,
        supabase as imported_supabase
    )
except:
    print("❌ calculate_equal_weight_indices.py를 찾을 수 없습니다.")
    exit(1)

# 테마 지수 계산 (개선 버전)
def calculate_theme_indices_safe():
    print("\n[테마 지수 계산 - 안전 모드]")

    # 모든 테마 가져오기
    response = supabase.table('themes').select('id, name').execute()
    themes = response.data

    for idx, theme in enumerate(themes):
        theme_id = theme['id']
        theme_name = theme['name']

        print(f"\n[{idx+1}/{len(themes)}] {theme_name}")

        # 이 테마의 매핑 최근 변경일 확인
        mapping_date = get_theme_mapping_date(theme_id)

        if not mapping_date:
            print("  ⚠️  매핑 데이터 없음, 스킵")
            continue

        print(f"  📅 매핑 날짜: {mapping_date}")

        # 매핑 날짜 이후만 계산
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = mapping_date

        # 너무 짧으면 스킵
        if (datetime.now() - datetime.strptime(start_date, '%Y-%m-%d')).days < 2:
            print(f"  ⚠️  데이터 기간 부족 (최소 2일 필요), 스킵")
            continue

        print(f"  📊 계산 기간: {start_date} ~ {end_date}")

        # 구성 종목
        company_codes = get_theme_companies(theme_id)
        if not company_codes:
            print("  ⚠️  구성 종목 없음, 스킵")
            continue

        # 거래일 목록
        trading_dates = get_trading_dates(start_date, end_date)
        if len(trading_dates) < 2:
            print(f"  ⚠️  거래일 부족 ({len(trading_dates)}일), 스킵")
            continue

        # 지수 계산
        index_records = []
        current_index = 100.0

        for date_idx, current_date in enumerate(trading_dates):
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

            previous_date = trading_dates[date_idx - 1]
            result = calculate_equal_weight_return(company_codes, current_date, previous_date)

            if result is None:
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

            daily_return = result['daily_return']
            current_index = current_index * (1 + daily_return / 100)

            index_records.append({
                'theme_id': theme_id,
                'date': current_date,
                'index_value': round(current_index, 4),
                'daily_return': round(daily_return, 4),
                'stock_count': result['stock_count'],
                'avg_close': round(result['avg_close'], 2),
                'total_market_cap': 0
            })

        # DB 저장
        if index_records:
            supabase.table('theme_indices')\
                .delete()\
                .eq('theme_id', theme_id)\
                .gte('date', start_date)\
                .execute()

            batch_size = 1000
            for i in range(0, len(index_records), batch_size):
                batch = index_records[i:i+batch_size]
                supabase.table('theme_indices').insert(batch).execute()

            print(f"  ✅ {len(index_records)}개 레코드 저장")

# 업종 지수도 동일하게
def calculate_industry_indices_safe():
    print("\n[업종 지수 계산 - 안전 모드]")

    response = supabase.table('industries').select('id, name').execute()
    industries = response.data

    for idx, industry in enumerate(industries):
        industry_id = industry['id']
        industry_name = industry['name']

        print(f"\n[{idx+1}/{len(industries)}] {industry_name}")

        mapping_date = get_industry_mapping_date(industry_id)

        if not mapping_date:
            print("  ⚠️  매핑 데이터 없음, 스킵")
            continue

        print(f"  📅 매핑 날짜: {mapping_date}")

        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = mapping_date

        if (datetime.now() - datetime.strptime(start_date, '%Y-%m-%d')).days < 2:
            print(f"  ⚠️  데이터 기간 부족, 스킵")
            continue

        print(f"  📊 계산 기간: {start_date} ~ {end_date}")

        company_codes = get_industry_companies(industry_id)
        if not company_codes:
            print("  ⚠️  구성 종목 없음, 스킵")
            continue

        trading_dates = get_trading_dates(start_date, end_date)
        if len(trading_dates) < 2:
            print(f"  ⚠️  거래일 부족, 스킵")
            continue

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

        if index_records:
            supabase.table('industry_indices')\
                .delete()\
                .eq('industry_id', industry_id)\
                .gte('date', start_date)\
                .execute()

            batch_size = 1000
            for i in range(0, len(index_records), batch_size):
                batch = index_records[i:i+batch_size]
                supabase.table('industry_indices').insert(batch).execute()

            print(f"  ✅ {len(index_records)}개 레코드 저장")

if __name__ == "__main__":
    calculate_theme_indices_safe()
    calculate_industry_indices_safe()

    print("\n" + "=" * 60)
    print("🎉 계산 완료!")
    print("=" * 60)
    print("\n각 테마/업종의 지수 100 기준일 = 매핑 데이터의 최근 변경일")
    print("이후 구성이 바뀌면 해당 날짜부터 다시 100으로 시작합니다.")
