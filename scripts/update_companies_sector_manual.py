import os
import requests
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import io

# 환경 변수 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

def get_krx_desc_direct():
    """
    FinanceDataReader 라이브러리의 버그를 우회하기 위해 KRX 데이터를 직접 수집합니다.
    """
    url = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101',
    }
    
    # KRX 전체 종목 기본 정보 (업종 포함)
    params = {
        'bld': 'dbms/MDC/STAT/standard/MDCSTAT01901',
        'mktId': 'ALL',
        'share': '1',
        'csvxls_isNo': 'false',
    }

    try:
        print("   KRX 데이터 다운로드 중 (Direct)...")
        r = requests.post(url, data=params, headers=headers)
        r.raise_for_status()
        data = r.json()
        
        df = pd.DataFrame(data['OutBlock_1'])
        return df
    except Exception as e:
        print(f"   ❌ 데이터 수집 실패: {e}")
        return None

def update_sectors_manual():
    print("🚀 기업 업종(Sector) 정보 업데이트 시작 (수동 모드)...")
    
    df_krx = get_krx_desc_direct()
    
    if df_krx is None or df_krx.empty:
        print("   ❌ 데이터를 가져오지 못했습니다.")
        return

    # 컬럼 매핑 확인 (KRX API 응답 기준)
    # ISU_SRT_CD: 종목코드 (예: 005930)
    # ISU_ABBRV: 종목명 (예: 삼성전자)
    # MKT_NM: 시장구분 (예: KOSPI)
    # SECT_TP_NM: 소속부 (예: 우량기업부 - 이건 업종이 아님)
    # IDX_IND_NM: 업종명 (예: 전기전자) - 이것이 Sector!
    
    print(f"   컬럼 목록: {df_krx.columns.tolist()}")
    
    # 필요한 컬럼만 선택 및 이름 변경
    # 종목코드, 종목명, 업종명(IDX_IND_NM), 시장구분
    if 'IDX_IND_NM' not in df_krx.columns:
        print("   ❌ 업종 컬럼(IDX_IND_NM)을 찾을 수 없습니다.")
        # 데이터 샘플 출력해서 확인
        print(df_krx.head(1))
        return

    df_upload = df_krx[['ISU_SRT_CD', 'ISU_ABBRV', 'IDX_IND_NM', 'MKT_NM', 'MKT_CAP']].copy()
    df_upload.columns = ['Code', 'Name', 'Sector', 'Market', 'Marcap']
    
    # NaN 또는 '-' 처리
    df_upload['Sector'] = df_upload['Sector'].replace('-', None)
    df_upload = df_upload.where(pd.notnull(df_upload), None)
    
    # Marcap 쉼표 제거 및 숫자 변환
    df_upload['Marcap'] = df_upload['Marcap'].astype(str).str.replace(',', '')
    df_upload['Marcap'] = pd.to_numeric(df_upload['Marcap'], errors='coerce').fillna(0)

    upload_list_full = []
    for _, row in df_upload.iterrows():
        item = {
            "code": str(row['Code']),
            "name": str(row['Name']),
            "sector": str(row['Sector']) if row['Sector'] else None,
            "market": str(row['Market']),
            "marcap": float(row['Marcap'])
        }
        upload_list_full.append(item)
        
    print(f"   업로드 대상: {len(upload_list_full)}건")

    # 청크 업로드
    chunk_size = 1000
    total_chunks = (len(upload_list_full) // chunk_size) + 1
    
    for i in range(0, len(upload_list_full), chunk_size):
        chunk = upload_list_full[i:i+chunk_size]
        try:
            response = supabase.table("companies").upsert(chunk, on_conflict="code").execute()
            
            current_chunk = (i // chunk_size) + 1
            print(f"   [{current_chunk}/{total_chunks}] {len(chunk)}개 완료", end='\r')
        except Exception as e:
            print(f"\n   ❌ 업로드 중 에러: {e}")
            
    print("\n✅ 모든 업종 정보 업데이트 완료!")

if __name__ == "__main__":
    update_sectors_manual()
