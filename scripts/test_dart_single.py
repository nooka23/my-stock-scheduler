"""
DART API 단일 종목 테스트 스크립트
삼성전자 2024년 Q3 데이터를 조회하여 API 응답 확인
"""

import requests
import json
import zipfile
import io
import xml.etree.ElementTree as ET
import os
from dotenv import load_dotenv

# 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"📂 환경변수 로드 경로: {env_path}")
load_dotenv(dotenv_path=env_path)

dart_api_key = os.environ.get("DART_API_KEY")

if not dart_api_key:
    print("❌ 오류: DART API Key를 찾을 수 없습니다.")
    print("💡 https://opendart.fss.or.kr/ 에서 API 키를 발급받고 .env.local에 DART_API_KEY로 추가하세요.")
    exit(1)

print(f"✅ DART API Key: {dart_api_key[:10]}...")

DART_API_BASE = "https://opendart.fss.or.kr/api"

# 1. 기업 고유번호 다운로드
print("\n" + "="*60)
print("1단계: 기업 고유번호 매핑 다운로드")
print("="*60)

url = f"{DART_API_BASE}/corpCode.xml?crtfc_key={dart_api_key}"
print(f"URL: {url[:80]}...")

response = requests.get(url)
print(f"응답 상태 코드: {response.status_code}")

if response.status_code != 200:
    print(f"❌ 다운로드 실패")
    exit(1)

# ZIP 파일 압축 해제
with zipfile.ZipFile(io.BytesIO(response.content)) as z:
    xml_content = z.read('CORPCODE.xml')

# XML 파싱
root = ET.fromstring(xml_content)

# 삼성전자 찾기
samsung_info = None
for corp in root.findall('list'):
    stock_code = corp.find('stock_code').text
    if stock_code == '005930':  # 삼성전자
        samsung_info = {
            'corp_code': corp.find('corp_code').text,
            'corp_name': corp.find('corp_name').text,
            'stock_code': stock_code
        }
        break

if not samsung_info:
    print("❌ 삼성전자 정보를 찾을 수 없습니다.")
    exit(1)

print(f"✅ 삼성전자 정보 찾음:")
print(f"   - 종목코드: {samsung_info['stock_code']}")
print(f"   - 기업명: {samsung_info['corp_name']}")
print(f"   - DART 기업코드: {samsung_info['corp_code']}")

# 2. 재무제표 조회 (2024년 3분기)
print("\n" + "="*60)
print("2단계: 2024년 3분기 재무제표 조회")
print("="*60)

reprt_code = '11014'  # 3분기보고서
year = 2024

url = f"{DART_API_BASE}/fnlttSinglAcntAll.json"
params = {
    'crtfc_key': dart_api_key,
    'corp_code': samsung_info['corp_code'],
    'bsns_year': year,
    'reprt_code': reprt_code,
    'fs_div': 'CFS'  # 연결재무제표
}

print(f"\n요청 파라미터:")
print(f"  - corp_code: {params['corp_code']}")
print(f"  - bsns_year: {params['bsns_year']}")
print(f"  - reprt_code: {params['reprt_code']} (3분기보고서)")
print(f"  - fs_div: {params['fs_div']} (연결재무제표)")

response = requests.get(url, params=params)
print(f"\n응답 상태 코드: {response.status_code}")

data = response.json()
print(f"응답 status: {data.get('status')}")
print(f"응답 message: {data.get('message')}")

if data.get('status') != '000':
    print(f"\n⚠️ 연결재무제표가 없습니다. 개별재무제표를 조회합니다...")
    params['fs_div'] = 'OFS'
    response = requests.get(url, params=params)
    data = response.json()
    print(f"개별재무제표 응답 status: {data.get('status')}")
    print(f"개별재무제표 응답 message: {data.get('message')}")

if data.get('status') != '000':
    print(f"\n❌ 데이터 조회 실패")
    print(f"전체 응답:")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    exit(1)

# 3. 데이터 파싱
print("\n" + "="*60)
print("3단계: 데이터 파싱")
print("="*60)

financial_list = data.get('list', [])
print(f"\n총 {len(financial_list)}개 계정과목 조회됨")

# 필요한 계정과목만 출력
target_accounts = ['매출액', '영업이익', '당기순이익', '자산총계', '자본총계']

print("\n주요 계정과목:")
for item in financial_list[:50]:  # 처음 50개만 확인
    account_nm = item.get('account_nm', '')
    if any(target in account_nm for target in target_accounts):
        thstrm_amount = item.get('thstrm_amount', '')
        print(f"  - {account_nm}: {thstrm_amount}")

# 4. 최종 결과
print("\n" + "="*60)
print("4단계: 최종 파싱 결과")
print("="*60)

account_map = {
    'revenue': ['매출액', '수익(매출액)'],
    'op_income': ['영업이익', '영업이익(손실)'],
    'net_income': ['당기순이익', '당기순이익(손실)'],
    'assets': ['자산총계'],
    'equity': ['자본총계']
}

result = {}

for item in financial_list:
    account_nm = item.get('account_nm', '')
    thstrm_amount = item.get('thstrm_amount', '')

    if thstrm_amount and thstrm_amount != '-':
        try:
            amount = int(thstrm_amount.replace(',', ''))
            amount_in_billion = amount // 100  # 백만원 -> 억원

            for key, account_names in account_map.items():
                if any(name in account_nm for name in account_names):
                    if key not in result:
                        result[key] = {
                            'account_nm': account_nm,
                            'amount_million': amount,
                            'amount_billion': amount_in_billion
                        }
                    break
        except ValueError:
            continue

print("\n최종 추출 데이터:")
for key, value in result.items():
    print(f"\n{key}:")
    print(f"  - 계정명: {value['account_nm']}")
    print(f"  - 금액(백만원): {value['amount_million']:,}")
    print(f"  - 금액(억원): {value['amount_billion']:,}")
    print(f"  - DB 저장값: {value['amount_billion']} (억원)")

print("\n" + "="*60)
print("✅ 테스트 완료!")
print("="*60)

if len(result) >= 3:
    print("\n🎉 성공: 재무 데이터 정상 조회됨")
else:
    print("\n⚠️ 경고: 일부 재무 데이터가 누락되었습니다")
