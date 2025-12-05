import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

# 과거 JSON 방식과 동일하게 2010년부터 시작 (수정주가 반영 확률 높이기 위해)
START_DATE = '2010-01-01'

print(f"🚀 V2 DB 초기화 및 전체 재적재 시작 (Start: {START_DATE})")
print("⚠️ 주의: 실행 전 Supabase SQL Editor에서 'TRUNCATE TABLE daily_prices_v2;'를 실행하는 것을 권장합니다.")

# 1. 종목 리스트 가져오기 (DB에서 가져오거나 새로 갱신)
print("1. 종목 리스트 조회 중...")
try:
    # 최신 종목 리스트로 갱신
    df_krx = fdr.StockListing('KRX')
    filter_mask = (
        ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False) & 
        ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
    )
    target_stocks = df_krx[filter_mask][['Code', 'Name']].to_dict('records')
    print(f"✅ 대상 종목: {len(target_stocks)}개")
except Exception as e:
    print(f"❌ 종목 리스트 조회 실패: {e}")
    exit()

# 2. 데이터 수집 및 적재
total_count = len(target_stocks)
failed_list = []

for idx, stock in enumerate(target_stocks):
    code = str(stock['Code'])
    name = stock['Name']
    
    if idx % 10 == 0:
        print(f"[{idx+1}/{total_count}] {name}({code}) 처리 중...", end='\r')

    try:
        # KRX 데이터 로드 (2010년부터)
        df = fdr.DataReader(f'KRX:{code}', START_DATE)
        
        if df.empty:
            continue

        df = df.reset_index()
        
        upload_list = []
        for _, row in df.iterrows():
            upload_list.append({
                "code": code,
                "date": row['Date'].strftime('%Y-%m-%d'),
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "volume": int(row['Volume']),
                "change": float(row['Change']) if 'Change' in row and not pd.isna(row['Change']) else 0.0
            })
        
        # 청크 업로드 (Upsert)
        for i in range(0, len(upload_list), 1000):
            chunk = upload_list[i:i+1000]
            try:
                supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
            except Exception as e:
                print(f"\n   ❌ {name} 업로드 실패 (chunk {i}): {e}")
                time.sleep(1)

    except Exception as e:
        print(f"\n   ❌ {name}({code}) 실패: {e}")
        failed_list.append(code)
        
    time.sleep(0.05)

print(f"\n🎉 재적재 완료! (실패: {len(failed_list)}건)")
