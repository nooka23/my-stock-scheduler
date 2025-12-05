import FinanceDataReader as fdr
import pandas as pd
import os

# 1. 설정
code = '054630' # 에이디칩스
name = '에이디칩스'
start_date = '2024-01-01'
end_date = '2025-12-04'
output_file = 'ADChips_Compare.xlsx'

print(f"🚀 {name}({code}) 데이터 추출 시작 ({start_date} ~ {end_date})")

try:
    # 2. 데이터 가져오기 (공통 소스)
    # update_today_v2.py와 update_prices_json.py 모두 fdr.DataReader를 사용합니다.
    df = fdr.DataReader(f'KRX:{code}', start_date, end_date)

    if df.empty:
        print("❌ 데이터를 가져오지 못했습니다. (빈 데이터)")
        exit()
    
    # -------------------------------------------------------
    # 3. [스타일 1] update_today_v2 방식 (DB 적재용)
    # -------------------------------------------------------
    # 특징: code 컬럼 포함, 날짜가 'date' 컬럼, 컬럼명 소문자, change 포함
    
    df_db = df.reset_index() # 날짜를 컬럼으로
    df_db['code'] = code # 종목코드 추가
    
    # 필요한 컬럼만 선택 및 이름 변경
    # 원본: Date, Open, High, Low, Close, Volume, Change
    # 목표: code, date, open, high, low, close, volume, change
    df_db = df_db[['code', 'Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Change']]
    df_db.columns = ['code', 'date', 'open', 'high', 'low', 'close', 'volume', 'change']
    
    # 날짜 포맷 통일 (YYYY-MM-DD)
    df_db['date'] = df_db['date'].dt.strftime('%Y-%m-%d')
    
    print(f"✅ DB 스타일 변환 완료 ({len(df_db)}건)")

    # -------------------------------------------------------
    # 4. [스타일 2] update_prices_json 방식 (차트용 JSON)
    # -------------------------------------------------------
    # 특징: code 컬럼 없음(파일명으로 구분), 날짜가 'time' 컬럼, change 없음
    
    df_json = df.reset_index()
    
    # 필요한 컬럼만 선택 및 이름 변경
    # 목표: time, open, high, low, close, volume
    df_json = df_json[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
    df_json.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
    
    # 날짜 포맷 통일
    df_json['time'] = df_json['time'].dt.strftime('%Y-%m-%d')
    
    print(f"✅ JSON 스타일 변환 완료 ({len(df_json)}건)")

    # -------------------------------------------------------
    # 5. 엑셀로 저장 (시트 분리)
    # -------------------------------------------------------
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        df_db.to_excel(writer, sheet_name='DB_Style(Today_v2)', index=False)
        df_json.to_excel(writer, sheet_name='JSON_Style(Prices_json)', index=False)
        
    print(f"🎉 파일 저장 완료: {os.path.abspath(output_file)}")

except Exception as e:
    print(f"❌ 오류 발생: {e}")
