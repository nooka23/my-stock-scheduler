import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from datetime import datetime
from dotenv import load_dotenv
import time

# .env.local 파일 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정이 필요합니다.")
    exit()

supabase: Client = create_client(url, key)

# ---------------------------------------------------------
# 1. 전 종목 리스트 가져오기
# ---------------------------------------------------------
print("1. 전체 상장 종목 리스트를 가져오는 중...")
try:
    kospi = fdr.StockListing('KOSPI')[['Code', 'Name']]
    kosdaq = fdr.StockListing('KOSDAQ')[['Code', 'Name']]
    konex = fdr.StockListing('KONEX')[['Code', 'Name']]
    
    # 전체 합치기
    all_stocks = pd.concat([kospi, kosdaq, konex])
    target_stocks = all_stocks.to_dict('records')
    
    print(f"✅ 총 {len(target_stocks)}개 종목을 발견했습니다.")

except Exception as e:
    print(f"❌ 종목 리스트 가져오기 실패: {e}")
    exit()

# ---------------------------------------------------------
# 2. 데이터 수집 및 업로드 설정 (2021년 부터!)
# ---------------------------------------------------------
START_DATE = '2021-01-01' # ★ 2010년에서 2021년으로 변경
total_count = len(target_stocks)

print(f"2. {START_DATE} 부터 주가 데이터 수집 및 업로드 시작...")
print("⚠️ 예상 소요 시간: 30분 ~ 1시간")

for idx, stock in enumerate(target_stocks):
    code = stock['Code']
    name = stock['Name']
    
    print(f"[{idx+1}/{total_count}] {name}({code}) 처리 중...", end=" ")

    try:
        # 주가 데이터 가져오기
        df = fdr.DataReader(code, START_DATE)
        
        if df.empty:
            print("Pass (데이터 없음)")
            continue

        # 데이터 가공
        prices = []
        for date, row in df.iterrows():
            # NaN 값 처리
            if pd.isna(row['Open']) or pd.isna(row['Close']):
                continue
            
            # 거래량이 0인 날도 저장할지 선택 (일단 저장)
            prices.append({
                "code": code,
                "date_str": date.strftime('%Y-%m-%d'),
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume']),
                "rs_rating": None # ★ 나중에 계산해서 채워넣을 예정
            })

        # DB에 업로드 (1000개씩 끊어서)
        if prices:
            chunk_size = 1000
            for i in range(0, len(prices), chunk_size):
                chunk = prices[i:i + chunk_size]
                # upsert: 중복되면 덮어쓰기
                supabase.table("stock_prices").upsert(chunk, on_conflict="code, date_str").execute()
            
            print(f"✅ ({len(prices)}건)")
        else:
            print("Pass (유효 데이터 없음)")

    except Exception as e:
        print(f"❌ 실패: {e}")
        continue
        
    # 차단 방지 딜레이
    time.sleep(0.05)

print("\n🎉 모든 종목 데이터 업데이트가 완료되었습니다!")