import os
import FinanceDataReader as fdr
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd
from datetime import datetime
import traceback
import time

# 환경 변수 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

def upload_etf_list():
    """ETF 리스트를 companies 테이블에 업로드"""
    print("🚀 ETF 리스트 업로드 시작...")

    try:
        # ETF 리스트 가져오기
        print("   ETF 리스트 다운로드 중...")
        df_etf = fdr.StockListing('ETF/KR')

        print(f"   총 {len(df_etf)}개 ETF 발견")
        print(f"   컬럼: {df_etf.columns.tolist()}")

        # 필요한 컬럼만 선택 및 정리
        etf_list = []
        skipped_count = 0

        for _, row in df_etf.iterrows():
            code = str(row['Code']) if 'Code' in row else str(row['Symbol'])

            # 숫자로만 구성된 코드만 처리 (한국 시장 ETF)
            if not code.isdigit():
                skipped_count += 1
                continue

            etf_item = {
                "code": code,
                "name": str(row['Name']),
                "market": "ETF",  # ETF로 구분
                "sector": "ETF",  # sector도 ETF로 설정
            }

            # 시가총액이 있으면 추가
            if 'Marcap' in row and pd.notna(row['Marcap']):
                etf_item['marcap'] = float(row['Marcap'])

            etf_list.append(etf_item)

        if skipped_count > 0:
            print(f"   ⚠️  알파벳 포함 코드 {skipped_count}개 제외됨")

        # Supabase에 업로드 (upsert)
        print(f"   {len(etf_list)}개 ETF를 companies 테이블에 업로드 중...")

        chunk_size = 100
        for i in range(0, len(etf_list), chunk_size):
            chunk = etf_list[i:i+chunk_size]
            supabase.table("companies").upsert(chunk, on_conflict="code").execute()
            print(f"   [{i+len(chunk)}/{len(etf_list)}] 완료", end='\r')

        print(f"\n✅ ETF 리스트 업로드 완료! ({len(etf_list)}개)")
        return [item['code'] for item in etf_list]

    except Exception as e:
        print(f"\n❌ 에러 발생: {e}")
        traceback.print_exc()
        return []

def upload_etf_prices(etf_codes, start_date='2024-01-01'):
    """ETF 가격 데이터를 daily_prices_v2 테이블에 업로드"""
    print(f"\n🚀 ETF 가격 데이터 업로드 시작 (시작일: {start_date})...")

    total = len(etf_codes)
    success_count = 0
    fail_count = 0

    for idx, code in enumerate(etf_codes, 1):
        try:
            print(f"\n[{idx}/{total}] {code} 다운로드 중...", end=' ')

            # ETF 가격 데이터 가져오기
            df = fdr.DataReader(code, start_date)

            if df.empty:
                print("데이터 없음")
                fail_count += 1
                continue

            # 데이터 정리
            df = df.reset_index()
            df['code'] = code

            # 컬럼명 매핑
            column_mapping = {
                'Date': 'date',
                'Open': 'open',
                'High': 'high',
                'Low': 'low',
                'Close': 'close',
                'Volume': 'volume'
            }

            df = df.rename(columns=column_mapping)

            # 필요한 컬럼만 선택
            df = df[['code', 'date', 'open', 'high', 'low', 'close', 'volume']]

            # NaN 처리
            df = df.fillna(0)

            # date를 문자열로 변환
            df['date'] = df['date'].dt.strftime('%Y-%m-%d')

            # 딕셔너리 리스트로 변환
            records = df.to_dict('records')

            print(f"{len(records)}개 데이터 업로드 중...", end=' ')

            # Supabase에 업로드 (청크 단위)
            chunk_size = 500
            for i in range(0, len(records), chunk_size):
                chunk = records[i:i+chunk_size]
                supabase.table("daily_prices_v2").upsert(
                    chunk,
                    on_conflict="code,date"
                ).execute()

            print(f"✅ 완료")
            success_count += 1

            # API 호출 제한 방지
            time.sleep(0.1)

        except Exception as e:
            print(f"❌ 실패: {e}")
            fail_count += 1
            continue

    print(f"\n✅ ETF 가격 데이터 업로드 완료!")
    print(f"   성공: {success_count}개")
    print(f"   실패: {fail_count}개")

def main():
    print("=" * 60)
    print("ETF 데이터 업로드 스크립트")
    print("=" * 60)

    # 1. ETF 리스트 업로드
    etf_codes = upload_etf_list()

    if not etf_codes:
        print("❌ ETF 리스트를 가져오는데 실패했습니다.")
        return

    # 2. ETF 가격 데이터 업로드
    upload_etf_prices(etf_codes, start_date='2024-01-01')

    print("\n" + "=" * 60)
    print("✅ 모든 작업 완료!")
    print("=" * 60)

if __name__ == "__main__":
    main()
