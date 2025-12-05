from pykrx import stock
import pandas as pd
import os
import time

# 1. 설정
code = '054630' # 에이디칩스
name = '에이디칩스'
start_date = '20240101' # pykrx는 YYYYMMDD 형식을 좋아합니다.
end_date = '20251204'
output_file = 'ADChips_KRX_Official.xlsx'

print(f"🚀 {name}({code}) KRX 공식 데이터 추출 시작 ({start_date} ~ {end_date})")

try:
    # 2. pykrx로 데이터 가져오기 (핵심: adjusted=True)
    # get_market_ohlcv: 시가, 고가, 저가, 종가, 거래량 가져오기
    print("📡 한국거래소(KRX) 접속 중...")
    
    # 수정주가 적용 (adjusted=True)
    df_adj = stock.get_market_ohlcv(start_date, end_date, code, adjusted=True)
    
    # 수정주가 미적용 (adjusted=False) - 비교용
    time.sleep(1) # 너무 빨리 요청하면 차단될 수 있음
    df_raw = stock.get_market_ohlcv(start_date, end_date, code, adjusted=False)
    
    if df_adj.empty:
        print("❌ 데이터를 가져오지 못했습니다. (거래 정지 기간일 수 있음)")
        # 데이터가 없어도 빈 파일은 만들지 않고 종료
        exit()

    # 3. 데이터 다듬기
    df_adj = df_adj.reset_index()
    df_raw = df_raw.reset_index()
    
    # 날짜 포맷 변경 (YYYY-MM-DD)
    # pykrx의 인덱스 이름은 '날짜' 입니다.
    df_adj['날짜'] = df_adj['날짜'].dt.strftime('%Y-%m-%d')
    df_raw['날짜'] = df_raw['날짜'].dt.strftime('%Y-%m-%d')
    
    # 4. 비교 시트 만들기
    # 날짜를 기준으로 합칩니다.
    merged = pd.merge(df_adj[['날짜', '종가']], df_raw[['날짜', '종가']], on='날짜', suffixes=('_수정주가', '_원본주가'))
    merged['차이'] = merged['종가_수정주가'] != merged['종가_원본주가']
    
    # 5. 엑셀 저장
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        merged.to_excel(writer, sheet_name='비교(수정vs원본)', index=False)
        df_adj.to_excel(writer, sheet_name='수정주가_데이터', index=False)
        df_raw.to_excel(writer, sheet_name='원본주가_데이터', index=False)
        
    print(f"🎉 파일 저장 완료: {os.path.abspath(output_file)}")
    print("👉 '비교(수정vs원본)' 시트에서 '차이'가 TRUE인 날짜를 확인해보세요!")
    
except Exception as e:
    print(f"❌ 오류 발생: {e}")
