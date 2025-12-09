import os
import FinanceDataReader as fdr
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd
import traceback

# 환경 변수 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

def update_sectors():
    print("🚀 기업 업종(Sector) 정보 업데이트 시작...")
    
    try:
        # KRX 종목 리스트 (상세 정보 - Sector 포함) 가져오기
        print("   데이터 다운로드 중 (KRX-DESC)...")
        df_krx = fdr.StockListing('KRX-DESC')
        
        # 컬럼 확인
        print(f"   컬럼 목록: {df_krx.columns.tolist()}")
        
        if 'Sector' not in df_krx.columns:
            # Sector가 없으면 업종으로 되어 있는지 확인
            if '업종' in df_krx.columns:
                df_krx.rename(columns={'업종': 'Sector'}, inplace=True)
            else:
                print("❌ 'Sector' 또는 '업종' 컬럼을 찾을 수 없습니다.")
                return

        # 업종 정보가 있는 종목만 필터링
        df_sectors = df_krx[['Code', 'Sector']].dropna()
        
        total_count = len(df_sectors)
        print(f"   총 {total_count}개 종목의 업종 정보를 업데이트합니다.")
        
        cols_to_use = ['Code', 'Name', 'Sector']
        if 'Market' in df_krx.columns: cols_to_use.append('Market')
        if 'Marcap' in df_krx.columns: cols_to_use.append('Marcap')
        
        df_upload = df_krx[cols_to_use].copy()
        
        # NaN 처리
        df_upload = df_upload.where(pd.notnull(df_upload), None)
        
        upload_list_full = []
        for _, row in df_upload.iterrows():
            item = {
                "code": str(row['Code']),
                "name": str(row['Name']),
                "sector": str(row['Sector']) if row['Sector'] else None
            }
            if 'Market' in row and row['Market']:
                item['market'] = str(row['Market'])
            if 'Marcap' in row and row['Marcap']:
                item['marcap'] = float(row['Marcap'])
                
            upload_list_full.append(item)
            
        print(f"   업로드 대상: {len(upload_list_full)}건")

        # 청크 업로드
        chunk_size = 1000
        total_chunks = (len(upload_list_full) // chunk_size) + 1
        
        for i in range(0, len(upload_list_full), chunk_size):
            chunk = upload_list_full[i:i+chunk_size]
            response = supabase.table("companies").upsert(chunk, on_conflict="code").execute()
            
            # 진행상황 출력 (포맷팅 단순화)
            current_chunk = (i // chunk_size) + 1
            print(f"   [{current_chunk}/{total_chunks}] {len(chunk)}개 완료", end='\r')
            
        print("\n✅ 모든 업종 정보 업데이트 완료!")
            
    except Exception as e:
        print(f"\n❌ 에러 발생: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    update_sectors()