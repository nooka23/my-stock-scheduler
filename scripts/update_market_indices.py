import os
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timedelta
from pykrx import stock as krx_stock
import pandas as pd

# 환경 변수 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: .env.local 파일 설정을 확인하세요.")
    exit()

supabase: Client = create_client(url, key)

def update_market_indices():
    print("📊 시장 지수(KOSPI, KOSDAQ) 업데이트 중 (pykrx 사용)...")
    
    # 최근 2년치 데이터 로드
    start_date = '20150101'
    end_date = '20251208'
    
    indices = [
        {'ticker': '1001', 'code': 'KOSPI', 'name': 'KOSPI'},
        {'ticker': '2001', 'code': 'KOSDAQ', 'name': 'KOSDAQ'}
    ]
    
    for idx in indices:
        try:
            print(f"   - {idx['name']} 데이터 수집 중...")
            df = krx_stock.get_index_ohlcv_by_date(start_date, end_date, idx['ticker'])
            
            if df.empty:
                print(f"     ⚠️ 데이터 없음")
                continue
                
            upload_list = []
            for d, row in df.iterrows():
                date_str = d.strftime('%Y-%m-%d')
                
                upload_list.append({
                    "code": idx['code'],
                    "date": date_str,
                    "open": float(row['시가']),
                    "high": float(row['고가']),
                    "low": float(row['저가']),
                    "close": float(row['종가']),
                    "volume": float(row['거래량']),
                    "trading_value": float(row['거래대금']), 
                    "change": 0
                })
            
            if upload_list:
                for i in range(0, len(upload_list), 1000):
                    chunk = upload_list[i:i+1000]
                    supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
                print(f"     ✅ {len(upload_list)}건 업로드 완료")
                
                # companies 테이블 등록
                supabase.table("companies").upsert({
                    "code": idx['code'],
                    "name": idx['name'],
                    "market": "INDEX",
                    "marcap": 0
                }).execute()
                
        except Exception as e:
            print(f"     ❌ 에러: {e}")

if __name__ == "__main__":
    update_market_indices()