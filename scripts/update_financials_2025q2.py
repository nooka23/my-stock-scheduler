"""
    2025년 2분기 데이터만 전체 종목 수집
- 기존 데이터 유무와 관계없이 모든 종목 조회
- 오류/누락 사항은 엑셀로 출력
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
import argparse

# ==========================================
# 수동 실행할 종목 코드 리스트 (여기에 코드를 입력하세요)
# 예시: MANUAL_CODES = ['005930', '000660']
MANUAL_CODES = [

]
# ==========================================

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

    try:
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            xml_content = z.read('CORPCODE.xml')

        root = ET.fromstring(xml_content)

        for corp in root.findall('list'):
            corp_code = corp.find('corp_code').text
            stock_code = corp.find('stock_code').text
            corp_name = corp.find('corp_name').text

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

    reprt_code_map = {
        1: '11013',  # 1분기보고서
        2: '11012',  # 반기보고서
        3: '11014',  # 3분기보고서
        4: '11011'   # 사업보고서 (연간)
    }

    reprt_code = reprt_code_map.get(quarter)
    if not reprt_code:
        return None

    url = f"{DART_API_BASE}/fnlttSinglAcntAll.json"
    params = {
        'crtfc_key': dart_api_key,
        'corp_code': corp_code,
        'bsns_year': year,
        'reprt_code': reprt_code,
        'fs_div': 'CFS'
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

    account_map = {
        'revenue': ['매출액', '수익(매출액)', '영업수익', '매출'],
        'op_income': ['영업이익', '영업이익(손실)', '영업손실','영업손익','영업활동으로부터의 이익(손실)', '영업순손익'],
        'net_income': ['당기순이익', '당기순이익(손실)', '분기순이익','분기순손실','분기연결순이익', '분기손이익','당기순손익','분기순손익','당기순손실','반기순이익(손실)','분기순이익(손실)'],
        'assets': ['자산총계', '자산 총계', '자산 계', '자 산 총 계','총자산','자  산  총  계'],
        'equity': ['자본총계','자본 총계', '자본 계', '자 본 총 계','기말자본','자  본  총  계'],
        'liabilities': ['부채총계', '부채 총계','부채 계','부 채 총 계','총부채','부  채  총  계']
    }

    result = {
        'year': year,
        'quarter': quarter,
        'revenue': None,
        'op_income': None,
        'net_income': None,
        'assets': None,
        'equity': None,
        'liabilities': None,
        'is_consolidated': False
    }

    if not financial_list:
        return None

    if financial_list[0].get('fs_div') == 'CFS':
        result['is_consolidated'] = True

    for item in financial_list:
        account_nm = item.get('account_nm', '')
        thstrm_amount = item.get('thstrm_amount', '')

        if thstrm_amount and thstrm_amount != '-':
            try:
                amount = int(thstrm_amount.replace(',', ''))
                amount_in_billion = amount // 100

                for key, account_names in account_map.items():
                    if any(name in account_nm for name in account_names):
                        if result[key] is None:
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
        result['equity'] is not None,
        result['liabilities'] is not None
    ])

    if not has_any_data:
        return None

    return result


def collect_2025q2_all_companies(api_limit=9500, target_codes=None):
    """2025년 2분기 데이터를 모든 종목에 대해 수집"""

    TARGET_YEAR = 2025
    TARGET_QUARTER = 2

    print(f"\n2025년 Q2 데이터 전체 수집 시작")
    if target_codes:
        print(f"대상 종목: {len(target_codes)}개 지정됨 ({', '.join(target_codes[:5])}...)")
    else:
        print("대상 종목: 전체")
    print(f"API 호출 제한: {api_limit}회\n")

    # 기업 고유번호 매핑 다운로드
    if not download_corp_code_mapping():
        return

    # Supabase에서 종목 목록 가져오기
    print("DB에서 종목 목록 가져오기...")
    try:
        query = supabase.table('companies').select('code, name')
        
        # 특정 종목만 지정된 경우 필터링
        if target_codes:
            query = query.in_('code', target_codes)
            
        response = query.execute()
        companies = response.data
    except Exception as e:
        print(f"종목 목록 로드 실패: {e}")
        return

    print(f"총 {len(companies)}개 종목\n")

    # 결과 추적
    success_list = []  # 성공
    no_dart_mapping = []  # DART 매핑 없음
    no_data = []  # 데이터 없음
    parse_error = []  # 파싱 실패
    save_error = []  # DB 저장 실패
    missing_accounts = []  # 빠진 계정
    api_call_count = 0
    api_limit_reached = False

    for idx, company in enumerate(companies):
        code = company['code']
        name = company['name']

        print(f"[{idx+1}/{len(companies)}] {name}({code})...", end=" ")

        # DART 매핑 체크
        if code not in corp_code_map:
            print("DART 매핑 없음")
            no_dart_mapping.append({'code': code, 'name': name})
            continue

        # API 제한 체크
        if api_call_count >= api_limit:
            print(f"\nAPI 호출 제한 도달 ({api_call_count}/{api_limit}회)")
            api_limit_reached = True
            # 남은 종목들 기록
            for remaining in companies[idx:]:
                no_data.append({
                    'code': remaining['code'],
                    'name': remaining['name'],
                    'reason': 'API 제한으로 미수집'
                })
            break

        # 데이터 조회
        api_call_count += 1
        financial_list = get_financial_statement(code, TARGET_YEAR, TARGET_QUARTER)

        if not financial_list:
            print("데이터 없음")
            no_data.append({
                'code': code,
                'name': name,
                'reason': 'DART에 데이터 없음'
            })
            continue

        # 파싱
        try:
            financial_data = parse_financial_data(financial_list, TARGET_YEAR, TARGET_QUARTER)

            if not financial_data:
                print("파싱 실패")
                parse_error.append({
                    'code': code,
                    'name': name,
                    'reason': '재무 항목 없음'
                })
                continue
        except Exception as e:
            print(f"파싱 오류: {e}")
            parse_error.append({
                'code': code,
                'name': name,
                'reason': str(e)
            })
            continue

        # DB 저장
        try:
            record = {
                'company_code': code,
                'year': TARGET_YEAR,
                'quarter': TARGET_QUARTER,
                'revenue': financial_data['revenue'],
                'op_income': financial_data['op_income'],
                'net_income': financial_data['net_income'],
                'assets': financial_data['assets'],
                'equity': financial_data['equity'],
                'liabilities': financial_data['liabilities'],
                'data_source': 'dart',
                'is_consolidated': financial_data['is_consolidated']
            }

            supabase.table('company_financials_v2').upsert(
                record,
                on_conflict='company_code,year,quarter,data_source'
            ).execute()

            print("저장 완료")
            success_list.append({'code': code, 'name': name})

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
            if financial_data['liabilities'] is None:
                missing_fields.append('liabilities')

            if missing_fields:
                missing_accounts.append({
                    'code': code,
                    'name': name,
                    'missing_fields': ', '.join(missing_fields)
                })

        except Exception as e:
            print(f"DB 저장 실패: {e}")
            save_error.append({
                'code': code,
                'name': name,
                'error': str(e)
            })

        time.sleep(0.3)  # API 호출 간격

    # 결과 출력
    print("\n" + "="*60)
    print("작업 완료!")
    print(f"  성공: {len(success_list)}개")
    print(f"  DART 매핑 없음: {len(no_dart_mapping)}개")
    print(f"  데이터 없음: {len(no_data)}개")
    print(f"  파싱 실패: {len(parse_error)}개")
    print(f"  DB 저장 실패: {len(save_error)}개")
    print(f"  빠진 계정 있음: {len(missing_accounts)}개")
    print(f"  총 API 호출: {api_call_count}회")

    if api_limit_reached:
        print(f"\n  ⚠️ API 호출 제한 도달로 중단됨")

    # 엑셀 파일로 결과 저장
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    excel_filename = f'2025Q2_collection_result_{timestamp}.xlsx'
    excel_path = os.path.join(project_root, 'scripts', excel_filename)

    try:
        with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
            # 1. 요약
            summary_data = {
                '항목': [
                    '총 종목 수',
                    '성공',
                    'DART 매핑 없음',
                    '데이터 없음',
                    '파싱 실패',
                    'DB 저장 실패',
                    '빠진 계정 있음',
                    'API 호출 횟수',
                    'API 제한 도달'
                ],
                '값': [
                    len(companies),
                    len(success_list),
                    len(no_dart_mapping),
                    len(no_data),
                    len(parse_error),
                    len(save_error),
                    len(missing_accounts),
                    api_call_count,
                    '예' if api_limit_reached else '아니오'
                ]
            }
            pd.DataFrame(summary_data).to_excel(writer, sheet_name='요약', index=False)

            # 2. 성공 목록
            if success_list:
                pd.DataFrame(success_list).to_excel(writer, sheet_name='성공', index=False)
            else:
                pd.DataFrame({'메시지': ['성공한 종목 없음']}).to_excel(writer, sheet_name='성공', index=False)

            # 3. DART 매핑 없음
            if no_dart_mapping:
                pd.DataFrame(no_dart_mapping).to_excel(writer, sheet_name='DART매핑없음', index=False)
            else:
                pd.DataFrame({'메시지': ['모든 종목 DART 매핑 완료']}).to_excel(writer, sheet_name='DART매핑없음', index=False)

            # 4. 데이터 없음
            if no_data:
                pd.DataFrame(no_data).to_excel(writer, sheet_name='데이터없음', index=False)
            else:
                pd.DataFrame({'메시지': ['모든 종목 데이터 존재']}).to_excel(writer, sheet_name='데이터없음', index=False)

            # 5. 파싱 실패
            if parse_error:
                pd.DataFrame(parse_error).to_excel(writer, sheet_name='파싱실패', index=False)
            else:
                pd.DataFrame({'메시지': ['파싱 실패 없음']}).to_excel(writer, sheet_name='파싱실패', index=False)

            # 6. DB 저장 실패
            if save_error:
                pd.DataFrame(save_error).to_excel(writer, sheet_name='저장실패', index=False)
            else:
                pd.DataFrame({'메시지': ['저장 실패 없음']}).to_excel(writer, sheet_name='저장실패', index=False)

            # 7. 빠진 계정
            if missing_accounts:
                pd.DataFrame(missing_accounts).to_excel(writer, sheet_name='빠진계정', index=False)
            else:
                pd.DataFrame({'메시지': ['모든 계정 완벽']}).to_excel(writer, sheet_name='빠진계정', index=False)

        print(f"\n엑셀 파일 저장 완료: {excel_filename}")

    except Exception as e:
        print(f"\n엑셀 파일 저장 실패: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Update 2025 Q2 financials.')
    parser.add_argument('codes', metavar='CODE', type=str, nargs='*', help='Specific stock codes to update')
    
    args = parser.parse_args()
    
    # 1순위: 코드 상단에 직접 입력한 MANUAL_CODES
    # 2순위: 커맨드 라인 아규먼트
    target_codes = None
    
    if MANUAL_CODES:
        print(f"알림: 코드 내 지정된 MANUAL_CODES {len(MANUAL_CODES)}개를 사용하여 작업을 시작합니다.")
        target_codes = MANUAL_CODES
    elif args.codes:
        target_codes = args.codes

    collect_2025q2_all_companies(api_limit=9500, target_codes=target_codes)
