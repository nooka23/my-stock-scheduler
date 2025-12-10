import os
from pykrx import stock
from pykrx import bond
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

def get_alpha_etf_list():
    """알파벳 포함 ETF 리스트 불러오기"""
    try:
        csv_path = 'scripts/alpha_etf_list.csv'
        df = pd.read_csv(csv_path)
        return df['code'].tolist()
    except Exception as e:
        print(f"❌ CSV 파일을 읽을 수 없습니다: {e}")
        return []

def upload_alpha_etf_prices(etf_codes, start_date='20240101'):
    """pykrx를 사용하여 알파벳 포함 ETF 가격 데이터 업로드"""
    print(f"\n🚀 pykrx로 알파벳 포함 ETF 가격 데이터 업로드 시작...")
    print(f"   시작일: {start_date}")

    total = len(etf_codes)
    success_count = 0
    fail_count = 0
    end_date = datetime.now().strftime('%Y%m%d')

    for idx, code in enumerate(etf_codes, 1):
        try:
            print(f"\n[{idx}/{total}] {code} 다운로드 중...", end=' ')

            # pykrx로 ETF 데이터 가져오기
            df = stock.get_market_ohlcv_by_date(start_date, end_date, code)

            if df is None or df.empty:
                print("데이터 없음")
                fail_count += 1
                continue

            # 데이터 정리
            df = df.reset_index()
            df['code'] = code

            # 컬럼명 변경
            df = df.rename(columns={
                '날짜': 'date',
                '시가': 'open',
                '고가': 'high',
                '저가': 'low',
                '종가': 'close',
                '거래량': 'volume'
            })

            # 필요한 컬럼만 선택
            df = df[['code', 'date', 'open', 'high', 'low', 'close', 'volume']]

            # NaN 처리
            df = df.fillna(0)

            # date를 문자열로 변환
            df['date'] = pd.to_datetime(df['date']).dt.strftime('%Y-%m-%d')

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
            time.sleep(0.5)

        except Exception as e:
            print(f"❌ 실패: {e}")
            fail_count += 1
            continue

    print(f"\n✅ 알파벳 포함 ETF 가격 데이터 업로드 완료!")
    print(f"   성공: {success_count}개")
    print(f"   실패: {fail_count}개")

def main():
    print("=" * 60)
    print("pykrx를 사용한 알파벳 포함 ETF 데이터 업로드")
    print("=" * 60)

    # 알파벳 포함 ETF 리스트 불러오기
    etf_codes = get_alpha_etf_list()

    if not etf_codes:
        print("❌ 알파벳 ETF 리스트를 찾을 수 없습니다.")
        print("   먼저 'python scripts/check_alpha_etf.py'를 실행하세요.")
        return

    print(f"\n총 {len(etf_codes)}개 알파벳 포함 ETF 발견")

    # ETF 가격 데이터 업로드
    upload_alpha_etf_prices(etf_codes, start_date='20240101')

    print("\n" + "=" * 60)
    print("✅ 모든 작업 완료!")
    print("=" * 60)

if __name__ == "__main__":
    main()
