import os
from supabase import create_client, Client
from dotenv import load_dotenv

# 1. 환경변수 로드 (경로 찾기 로직 포함)
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"📂 환경변수 파일 경로: {env_path}")
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("❌ 환경변수(URL, KEY)를 불러오지 못했습니다.")
    exit(1)

# 2. Supabase 클라이언트 생성
try:
    supabase: Client = create_client(url, key)
    print("✅ Supabase 클라이언트 생성 완료")
except Exception as e:
    print(f"❌ 클라이언트 생성 실패: {e}")
    exit(1)

# 3. 테스트 데이터 준비
# 주의: 'company_code'는 이미 companies 테이블에 존재하는 코드여야 합니다.
# (삼성전자 '005930'이 DB에 있다고 가정합니다.)
test_data = {
    "company_code": "005930", 
    "year": 2099,  # 실제 데이터와 겹치지 않게 미래 연도로 설정
    "revenue": 10000,
    "op_income": 500,
    "net_income": 300,
    "assets": 50000,
    "equity": 30000,
    "eps": 123.45,
    "shares_outstanding": 1000000
}

print(f"\n🚀 데이터 저장을 시도합니다: {test_data}")

# 4. 저장 시도 및 상세 에러 출력
try:
    # 수정 전: .upsert(...).select().execute()
    # 수정 후: .select() 제거 -> .upsert(...).execute()
    response = supabase.table('company_financials').upsert(test_data, on_conflict='company_code, year').execute()
    
    print("\n✅ DB 저장 성공!")
    # response.data에 저장된 데이터가 들어옵니다.
    print("결과 데이터:", response.data)

except Exception as e:
    print("\n❌ [치명적 오류] DB 저장 실패")
    print("-" * 50)
    print(f"에러 메시지: {e}")
    
    # 보통 Supabase 에러는 e.message, e.code 등으로 올 수 있음
    if hasattr(e, 'code'):
        print(f"에러 코드: {e.code}")
    if hasattr(e, 'details'):
        print(f"상세 내용: {e.details}")
    if hasattr(e, 'hint'):
        print(f"힌트: {e.hint}")
    print("-" * 50)