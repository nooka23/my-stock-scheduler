import os
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd

# 환경 변수 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

def export_etf_to_excel():
    """ETF 리스트를 엑셀로 내보내기"""
    print("📊 ETF 리스트 내보내기 시작...")

    try:
        # Supabase에서 ETF 데이터 가져오기
        response = supabase.table("companies").select("code, name, sector, market").eq("market", "ETF").order("name").execute()

        if not response.data:
            print("❌ ETF 데이터를 찾을 수 없습니다.")
            return

        # DataFrame 생성
        df = pd.DataFrame(response.data)

        # 엑셀 파일로 저장
        excel_path = 'scripts/etf_list.xlsx'
        df.to_excel(excel_path, index=False, engine='openpyxl')

        print(f"✅ ETF 리스트를 '{excel_path}'에 저장했습니다.")
        print(f"   총 {len(df)}개 ETF")
        print(f"\n📝 다음 단계:")
        print(f"   1. '{excel_path}' 파일을 엑셀로 열기")
        print(f"   2. 'sector' 컬럼에 업종 입력 (예: 반도체, 2차전지, 금융 등)")
        print(f"   3. 저장 후 'python scripts/import_etf_from_excel.py' 실행")

    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    export_etf_to_excel()
