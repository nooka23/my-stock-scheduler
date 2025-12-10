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

def import_etf_from_excel():
    """엑셀에서 편집한 ETF 업종 정보를 Supabase에 업로드"""
    print("📥 엑셀에서 ETF 업종 정보 가져오기...")

    try:
        # 엑셀 파일 읽기
        excel_path = 'scripts/etf_list.xlsx'
        df = pd.read_excel(excel_path, engine='openpyxl')

        print(f"   총 {len(df)}개 ETF 발견")

        # NaN을 None으로 변환
        df = df.where(pd.notnull(df), None)

        # 업데이트할 데이터 준비
        update_list = []
        for _, row in df.iterrows():
            update_list.append({
                "code": str(row['code']),
                "name": str(row['name']),
                "sector": str(row['sector']) if row['sector'] and row['sector'] != 'ETF' else 'ETF',
                "market": str(row['market'])
            })

        print(f"   {len(update_list)}개 ETF 업데이트 중...")

        # 청크 단위로 업로드
        chunk_size = 100
        total_chunks = (len(update_list) // chunk_size) + 1

        for i in range(0, len(update_list), chunk_size):
            chunk = update_list[i:i+chunk_size]
            supabase.table("companies").upsert(chunk, on_conflict="code").execute()

            current_chunk = (i // chunk_size) + 1
            print(f"   [{current_chunk}/{total_chunks}] {len(chunk)}개 완료", end='\r')

        print(f"\n✅ ETF 업종 정보 업데이트 완료!")

        # 업종별 통계 출력
        print(f"\n📊 업종별 통계:")
        sector_counts = df['sector'].value_counts()
        for sector, count in sector_counts.items():
            print(f"   - {sector}: {count}개")

    except FileNotFoundError:
        print(f"❌ '{excel_path}' 파일을 찾을 수 없습니다.")
        print(f"   먼저 'python scripts/export_etf_to_excel.py'를 실행하세요.")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    import_etf_from_excel()
