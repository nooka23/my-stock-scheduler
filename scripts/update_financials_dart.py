"""
DART API를 활용하여 실제 발표된 재무 데이터를 수집하는 스크립트

사용 전 준비사항:
1. DART API 키 발급: https://opendart.fss.or.kr/
2. .env.local 파일에 DART_API_KEY 추가
"""

import requests
import time
import os
import zipfile
import io
import xml.etree.ElementTree as ET
from supabase import create_client, Client
from dotenv import load_dotenv

# 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"📂 환경변수 로드 경로: {env_path}")
load_dotenv(dotenv_path=env_path)

# Supabase 설정
url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
dart_api_key: str = os.environ.get("DART_API_KEY")

if not url or not key:
    print("❌ 오류: Supabase URL 또는 Key를 찾을 수 없습니다.")
    exit(1)

if not dart_api_key:
    print("❌ 오류: DART API Key를 찾을 수 없습니다.")
    print("💡 https://opendart.fss.or.kr/ 에서 API 키를 발급받고 .env.local에 DART_API_KEY로 추가하세요.")
    exit(1)

supabase: Client = create_client(url, key)

# DART API 베이스 URL
DART_API_BASE = "https://opendart.fss.or.kr/api"

# 종목코드 -> DART 기업 고유번호 매핑
corp_code_map = {}


def download_corp_code_mapping():
    """DART 기업 고유번호 매핑 파일 다운로드 및 파싱"""
    print("📥 DART 기업 고유번호 매핑 파일 다운로드 중...")

    url = f"{DART_API_BASE}/corpCode.xml?crtfc_key={dart_api_key}"
    response = requests.get(url)

    if response.status_code != 200:
        print(f"❌ 다운로드 실패: {response.status_code}")
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

        print(f"✅ {len(corp_code_map)}개 상장 종목 매핑 완료")
        return True

    except Exception as e:
        print(f"❌ 파싱 실패: {e}")
        return False


def get_financial_statement(stock_code, year, quarter):
    """
    특정 기업의 재무제표 조회 (분기별)

    Args:
        stock_code: 종목코드 (6자리)
        year: 사업연도 (YYYY)
        quarter: 분기 (1, 2, 3, 4)
    """

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
        'revenue': ['매출액', '수익(매출액)'],
        'op_income': ['영업이익', '영업이익(손실)'],
        'net_income': ['당기순이익', '당기순이익(손실)'],
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

    # 필수 항목(매출액) 체크
    if result['revenue'] is None:
        return None

    return result


def update_dart_financials(start_year=2011, end_year=2025, end_quarter=3):
    """DART API로 재무 데이터 업데이트 (분기별)

    Args:
        start_year: 시작 연도
        end_year: 종료 연도
        end_quarter: 종료 연도의 마지막 분기 (1~4)
    """

    print(f"\n🚀 DART 재무 데이터 업데이트 시작 ({start_year}~{end_year}년 Q{end_quarter})")

    # 기업 고유번호 매핑 다운로드
    if not download_corp_code_mapping():
        return

    # Supabase에서 종목 목록 가져오기
    print("\n📡 DB에서 종목 목록 가져오기...")
    try:
        response = supabase.table('companies').select('code, name').execute()
        companies = response.data
    except Exception as e:
        print(f"❌ 종목 목록 로드 실패: {e}")
        return

    print(f"✅ 총 {len(companies)}개 종목")

    success_count = 0
    fail_count = 0
    skip_count = 0

    for idx, company in enumerate(companies):
        code = company['code']
        name = company['name']

        print(f"\n[{idx+1}/{len(companies)}] {name}({code})")

        # 이미 수집된 데이터 확인
        existing_periods = set()  # (year, quarter) 튜플 저장
        try:
            existing_data = supabase.table('company_financials_v2').select('year, quarter').eq('company_code', code).eq('data_source', 'dart').execute()
            existing_count = len(existing_data.data)

            # 이미 있는 연도/분기 목록 생성
            for record in existing_data.data:
                existing_periods.add((record['year'], record['quarter']))

            # 이미 50개 이상 데이터가 있으면 건너뛰기 (59개 중 충분한 양)
            if existing_count >= 50:
                print(f"  ✅ 이미 {existing_count}개 데이터 존재 - 건너뛰기")
                skip_count += 1
                success_count += 1  # 이미 완료된 것으로 간주
                continue
            elif existing_count > 0:
                print(f"  📝 기존 {existing_count}개 데이터 존재 - 누락된 분기만 수집")
        except Exception as e:
            print(f"  ⚠️  기존 데이터 확인 실패: {e}")

        if code not in corp_code_map:
            print("  ⚠️  DART 매핑 없음 (비상장 또는 ETF)")
            fail_count += 1
            continue

        # 연도별 + 분기별 데이터 수집
        any_success = False

        for year in range(start_year, end_year + 1):
            # 마지막 연도의 경우 end_quarter까지만
            max_quarter = end_quarter if year == end_year else 4

            for quarter in range(1, max_quarter + 1):
                # 이미 있는 분기는 건너뛰기
                if (year, quarter) in existing_periods:
                    continue

                print(f"  📅 {year}년 Q{quarter} 조회 중...", end=" ")

                financial_list = get_financial_statement(code, year, quarter)

                if not financial_list:
                    print("❌ 데이터 없음")
                    continue

                financial_data = parse_financial_data(financial_list, year, quarter)

                if not financial_data:
                    print("❌ 파싱 실패")
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

                    print("✅ 저장")
                    any_success = True

                except Exception as e:
                    print(f"❌ DB 저장 실패: {e}")

                time.sleep(0.3)  # API 호출 간격

        if any_success:
            success_count += 1
        else:
            fail_count += 1

    print("\n" + "="*50)
    print(f"🎉 작업 완료!")
    print(f"   성공: {success_count}개 (건너뛰기: {skip_count}개)")
    print(f"   실패: {fail_count}개")


if __name__ == "__main__":
    # 2011년부터 2025년 3분기까지 수집
    update_dart_financials(start_year=2011, end_year=2025, end_quarter=3)
