"""
DART API를 활용하여 재무 데이터를 효율적으로 수집하는 스크립트 (개선 버전)

개선 사항:
1. 각 종목의 기존 데이터 범위를 확인하여 불필요한 API 호출 방지
2. 이미 수집된 분기는 건너뛰기
3. 상장 전 데이터 조회 방지
"""

import requests
import time
import os
import zipfile
import io
import xml.etree.ElementTree as ET
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd
from datetime import datetime

# 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"환경변수 로드 경로: {env_path}")
load_dotenv(dotenv_path=env_path)

# Supabase 설정
url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
dart_api_key: str = os.environ.get("DART_API_KEY")

if not url or not key:
    print("오류: Supabase URL 또는 Key를 찾을 수 없습니다.")
    exit(1)

if not dart_api_key:
    print("오류: DART API Key를 찾을 수 없습니다.")
    print("https://opendart.fss.or.kr/ 에서 API 키를 발급받고 .env.local에 DART_API_KEY로 추가하세요.")
    exit(1)

supabase: Client = create_client(url, key)

# DART API 베이스 URL
DART_API_BASE = "https://opendart.fss.or.kr/api"

# 종목코드 -> DART 기업 고유번호 매핑
corp_code_map = {}


def download_corp_code_mapping():
    """DART 기업 고유번호 매핑 파일 다운로드 및 파싱"""
    print("DART 기업 고유번호 매핑 파일 다운로드 중...")

    url = f"{DART_API_BASE}/corpCode.xml?crtfc_key={dart_api_key}"
    response = requests.get(url)

    if response.status_code != 200:
        print(f"다운로드 실패: {response.status_code}")
        return False

    # ZIP 파일 압축 해제
    try:
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            xml_content = z.read('CORPCODE.xml')

        # XML 파싱
        root = ET.fromstring(xml_content)

        for corp in root.findall('list'):
            corp_code = corp.find('corp_code').text
            stock_code = corp.find('stock_code').text
            corp_name = corp.find('corp_name').text

            # 상장 종목만 (stock_code가 있는 것)
            if stock_code and stock_code.strip():
                corp_code_map[stock_code] = {
                    'corp_code': corp_code,
                    'corp_name': corp_name
                }

        print(f"{len(corp_code_map)}개 상장 종목 매핑 완료")
        return True

    except Exception as e:
        print(f"파싱 실패: {e}")
        return False


def get_financial_statement(stock_code, year, quarter):
    """특정 기업의 재무제표 조회 (분기별)"""

    if stock_code not in corp_code_map:
        return None

    corp_code = corp_code_map[stock_code]['corp_code']

    # 분기별 보고서 코드 매핑
    reprt_code_map = {
        1: '11013',  # 1분기보고서
        2: '11012',  # 반기보고서
        3: '11014',  # 3분기보고서
        4: '11011'   # 사업보고서 (연간)
    }

    reprt_code = reprt_code_map.get(quarter)
    if not reprt_code:
        return None

    # 단일회사 전체 재무제표 API
    url = f"{DART_API_BASE}/fnlttSinglAcntAll.json"
    params = {
        'crtfc_key': dart_api_key,
        'corp_code': corp_code,
        'bsns_year': year,
        'reprt_code': reprt_code,
        'fs_div': 'CFS'  # CFS: 연결재무제표, OFS: 개별재무제표
    }

    response = requests.get(url, params=params)

    if response.status_code != 200:
        return None

    data = response.json()

    if data.get('status') != '000':
        # 연결재무제표가 없으면 개별재무제표 조회
        params['fs_div'] = 'OFS'
        response = requests.get(url, params=params)
        data = response.json()

        if data.get('status') != '000':
            return None

    return data.get('list', [])


def parse_financial_data(financial_list, year, quarter):
    """재무제표 데이터에서 필요한 항목 추출"""

    # 필요한 계정과목 매핑
    account_map = {
        'revenue': ['매출액', '수익(매출액)', '영업수익', '매출'],
        'op_income': ['영업이익', '영업이익(손실)'],
        'net_income': ['당기순이익', '당기순이익(손실)', '분기순이익'],
        'assets': ['자산총계'],
        'equity': ['자본총계']
    }

    result = {
        'year': year,
        'quarter': quarter,
        'revenue': None,
        'op_income': None,
        'net_income': None,
        'assets': None,
        'equity': None,
        'is_consolidated': False
    }

    if not financial_list:
        return None

    # fs_div 확인 (CFS: 연결, OFS: 개별)
    if financial_list[0].get('fs_div') == 'CFS':
        result['is_consolidated'] = True

    for item in financial_list:
        account_nm = item.get('account_nm', '')
        thstrm_amount = item.get('thstrm_amount', '')  # 당기금액

        # 쉼표 제거 및 숫자 변환
        if thstrm_amount and thstrm_amount != '-':
            try:
                amount = int(thstrm_amount.replace(',', ''))

                # 단위가 백만원이므로 억원 단위로 변환 (백만원 / 100 = 억원)
                amount_in_billion = amount // 100

                # 계정과목 매칭
                for key, account_names in account_map.items():
                    if any(name in account_nm for name in account_names):
                        if result[key] is None:  # 첫 번째 매칭만 사용
                            result[key] = amount_in_billion
                        break

            except ValueError:
                continue

    # 최소한 하나의 항목이라도 있는지 체크
    has_any_data = any([
        result['revenue'] is not None,
        result['op_income'] is not None,
        result['net_income'] is not None,
        result['assets'] is not None,
        result['equity'] is not None
    ])

    if not has_any_data:
        return None

    return result


def get_data_range_for_company(code):
    """
    특정 종목의 기존 데이터 범위 확인
    Returns: (min_year, max_year, existing_periods_set)
    """
    try:
        data = supabase.table('company_financials_v2').select('year, quarter').eq('company_code', code).eq('data_source', 'dart').execute()

        if not data.data:
            return None, None, set()

        years = [record['year'] for record in data.data]
        existing_periods = set((record['year'], record['quarter']) for record in data.data)

        return min(years), max(years), existing_periods

    except Exception as e:
        print(f"  기존 데이터 확인 실패: {e}")
        return None, None, set()


def update_dart_financials_smart(target_year=2025, target_quarter=4, mode='latest', api_limit=9500):
    """
    DART API로 재무 데이터를 효율적으로 업데이트

    Args:
        target_year: 목표 연도
        target_quarter: 목표 분기
        mode: 'latest' (최신 분기만) 또는 'fill' (누락 분기 채우기) 또는 'new' (신규 종목만)
        api_limit: API 호출 제한 (기본값: 9500, 일일 한도 10000의 95%)
    """

    print(f"\nDART 재무 데이터 업데이트 시작 (모드: {mode})")
    print(f"목표: {target_year}년 Q{target_quarter}까지")
    print(f"API 호출 제한: {api_limit}회")

    # 기업 고유번호 매핑 다운로드
    if not download_corp_code_mapping():
        return

    # Supabase에서 종목 목록 가져오기
    print("\nDB에서 종목 목록 가져오기...")
    try:
        response = supabase.table('companies').select('code, name').execute()
        companies = response.data
    except Exception as e:
        print(f"종목 목록 로드 실패: {e}")
        return

    print(f"총 {len(companies)}개 종목")

    success_count = 0
    fail_count = 0
    skip_count = 0
    api_call_count = 0

    # 결과 추적 리스트
    skipped_companies = []  # 생략된 종목
    processed_companies = []  # 투입된 종목
    missing_accounts = []  # 빠진 계정 정보
    api_limit_reached = False

    for idx, company in enumerate(companies):
        code = company['code']
        name = company['name']

        print(f"\n[{idx+1}/{len(companies)}] {name}({code})")

        if code not in corp_code_map:
            print("  DART 매핑 없음 (비상장 또는 ETF)")
            fail_count += 1
            skipped_companies.append({
                'code': code,
                'name': name,
                'reason': 'DART 매핑 없음'
            })
            continue

        # 기존 데이터 범위 확인
        min_year, max_year, existing_periods = get_data_range_for_company(code)

        if mode == 'latest':
            # 최신 분기만 업데이트
            if (target_year, target_quarter) in existing_periods:
                print(f"  이미 {target_year}년 Q{target_quarter} 데이터 존재 - 건너뛰기")
                skip_count += 1
                skipped_companies.append({
                    'code': code,
                    'name': name,
                    'reason': f'{target_year}년 Q{target_quarter} 데이터 존재'
                })
                continue

            periods_to_check = [(target_year, target_quarter)]

        elif mode == 'new':
            # 신규 종목만 (기존 데이터가 없는 종목)
            if min_year is not None:
                print(f"  기존 데이터 {len(existing_periods)}개 존재 - 건너뛰기")
                skip_count += 1
                success_count += 1  # 나중에 처리할 것이므로 성공으로 간주
                skipped_companies.append({
                    'code': code,
                    'name': name,
                    'reason': f'기존 데이터 {len(existing_periods)}개 존재'
                })
                continue

            # 2011년부터 전체 기간 수집
            periods_to_check = []
            for year in range(2011, target_year + 1):
                max_q = target_quarter if year == target_year else 4
                for quarter in range(1, max_q + 1):
                    periods_to_check.append((year, quarter))

            print(f"  신규 종목 - {len(periods_to_check)}개 분기 수집 시작")

        else:  # mode == 'fill'
            # 누락된 분기 채우기 (기존 데이터 범위 내에서)
            if min_year is None:
                # 신규 종목: 최근 5년치만
                start_year = target_year - 4
            else:
                # 기존 종목: 가장 오래된 데이터의 연도부터
                start_year = min_year
                print(f"  기존 데이터: {min_year}~{max_year}년 ({len(existing_periods)}개)")

            periods_to_check = []
            for year in range(start_year, target_year + 1):
                max_q = target_quarter if year == target_year else 4
                for quarter in range(1, max_q + 1):
                    if (year, quarter) not in existing_periods:
                        periods_to_check.append((year, quarter))

            if not periods_to_check:
                print(f"  모든 분기 데이터 존재 - 건너뛰기")
                skip_count += 1
                success_count += 1
                skipped_companies.append({
                    'code': code,
                    'name': name,
                    'reason': '모든 분기 데이터 존재'
                })
                continue
            else:
                print(f"  {len(periods_to_check)}개 분기 누락 - 수집 시작")

        # 데이터 수집
        any_success = False
        company_quarters_collected = []  # 이 종목에서 수집된 분기 목록

        for year, quarter in periods_to_check:
            # API 호출 제한 체크
            if api_call_count >= api_limit:
                print(f"\n\nAPI 호출 제한 도달 ({api_call_count}/{api_limit}회)")
                print(f"종목 처리 중단: {name}({code})")
                api_limit_reached = True
                break

            print(f"  {year}년 Q{quarter} 조회 중...", end=" ")
            api_call_count += 1

            financial_list = get_financial_statement(code, year, quarter)

            if not financial_list:
                print("데이터 없음")
                continue

            try:
                financial_data = parse_financial_data(financial_list, year, quarter)

                if not financial_data:
                    print("파싱 실패 (재무 항목 없음)")
                    continue
            except Exception as e:
                print(f"파싱 오류: {e}")
                continue

            # DB 저장
            try:
                record = {
                    'company_code': code,
                    'year': year,
                    'quarter': quarter,
                    'revenue': financial_data['revenue'],
                    'op_income': financial_data['op_income'],
                    'net_income': financial_data['net_income'],
                    'assets': financial_data['assets'],
                    'equity': financial_data['equity'],
                    'data_source': 'dart',
                    'is_consolidated': financial_data['is_consolidated']
                }

                supabase.table('company_financials_v2').upsert(
                    record,
                    on_conflict='company_code,year,quarter,data_source'
                ).execute()

                print("저장")
                any_success = True
                company_quarters_collected.append(f"{year}Q{quarter}")

                # 빠진 계정 체크
                missing_fields = []
                if financial_data['revenue'] is None:
                    missing_fields.append('revenue')
                if financial_data['op_income'] is None:
                    missing_fields.append('op_income')
                if financial_data['net_income'] is None:
                    missing_fields.append('net_income')
                if financial_data['assets'] is None:
                    missing_fields.append('assets')
                if financial_data['equity'] is None:
                    missing_fields.append('equity')

                if missing_fields:
                    missing_accounts.append({
                        'code': code,
                        'name': name,
                        'year': year,
                        'quarter': quarter,
                        'missing_fields': ', '.join(missing_fields)
                    })

            except Exception as e:
                print(f"DB 저장 실패: {e}")

            time.sleep(0.3)  # API 호출 간격

        if any_success:
            success_count += 1
            processed_companies.append({
                'code': code,
                'name': name,
                'quarters_collected': ', '.join(company_quarters_collected),
                'count': len(company_quarters_collected)
            })
        else:
            fail_count += 1

        # API 제한 도달 시 종료
        if api_limit_reached:
            break

    print("\n" + "="*50)
    print(f"작업 완료!")
    print(f"  성공: {success_count}개 (건너뛰기: {skip_count}개)")
    print(f"  실패: {fail_count}개")
    print(f"  총 API 호출: {api_call_count}회")

    if api_limit_reached:
        print(f"\n  ⚠️ API 호출 제한 도달로 중단됨")

    # 엑셀 파일로 결과 저장
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    excel_filename = f'dart_collection_result_{timestamp}.xlsx'
    excel_path = os.path.join(project_root, 'scripts', excel_filename)

    try:
        with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
            # 1. 생략된 종목 리스트
            if skipped_companies:
                df_skipped = pd.DataFrame(skipped_companies)
                df_skipped.to_excel(writer, sheet_name='생략된 종목', index=False)
            else:
                pd.DataFrame({'메시지': ['생략된 종목 없음']}).to_excel(writer, sheet_name='생략된 종목', index=False)

            # 2. 투입된 종목 리스트
            if processed_companies:
                df_processed = pd.DataFrame(processed_companies)
                df_processed.to_excel(writer, sheet_name='투입된 종목', index=False)
            else:
                pd.DataFrame({'메시지': ['투입된 종목 없음']}).to_excel(writer, sheet_name='투입된 종목', index=False)

            # 3. 빠진 계정 리스트
            if missing_accounts:
                df_missing = pd.DataFrame(missing_accounts)
                df_missing.to_excel(writer, sheet_name='빠진 계정', index=False)
            else:
                pd.DataFrame({'메시지': ['빠진 계정 없음']}).to_excel(writer, sheet_name='빠진 계정', index=False)

            # 4. 요약 정보
            summary_data = {
                '항목': ['총 종목 수', '성공', '건너뛰기', '실패', 'API 호출 횟수', 'API 제한 도달 여부'],
                '값': [len(companies), success_count, skip_count, fail_count, api_call_count, '예' if api_limit_reached else '아니오']
            }
            df_summary = pd.DataFrame(summary_data)
            df_summary.to_excel(writer, sheet_name='요약', index=False)

        print(f"\n엑셀 파일 저장 완료: {excel_filename}")
        print(f"  - 생략된 종목: {len(skipped_companies)}개")
        print(f"  - 투입된 종목: {len(processed_companies)}개")
        print(f"  - 빠진 계정: {len(missing_accounts)}건")

    except Exception as e:
        print(f"\n엑셀 파일 저장 실패: {e}")
        print("  결과 데이터는 메모리에 유지되어 있습니다.")


if __name__ == "__main__":
    # 사용 방법:
    # 1. 신규 종목만 수집 (기존 데이터 없는 종목의 2011~2025년 전체)
    update_dart_financials_smart(target_year=2025, target_quarter=3, mode='new')

    # 2. 최신 분기만 업데이트 (분기별 정기 업데이트용)
    # update_dart_financials_smart(target_year=2025, target_quarter=3, mode='latest')

    # 3. 누락된 분기 채우기 (기존 데이터 범위 내에서만)
    # update_dart_financials_smart(target_year=2025, target_quarter=3, mode='fill')
