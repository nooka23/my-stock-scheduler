import FinanceDataReader as fdr
import pandas as pd
import os

# 1. 설정
code_krx = 'KRX:054630' 
name = '에이디칩스'
start_date = '2024-01-01'
end_date = '2025-12-04'
output_file = 'ADChips_Only_Naver.xlsx' # 파일명 변경

print(f"🚀 {name} 데이터 추출 (네이버 금융 소스) 시작")

try:
    # 2. 네이버 금융 (KRX) 데이터 가져오기
    df = fdr.DataReader(code_krx, start_date, end_date)
    
    if df.empty:
        print("❌ 데이터를 가져오지 못했습니다.")
        exit()

    # 3. 데이터 다듬기
    df = df.reset_index()
    df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
    
    # 4. 엑셀 저장
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='Naver_Data', index=False)
        
    print(f"🎉 파일 저장 완료: {os.path.abspath(output_file)}")

except Exception as e:
    print(f"❌ 오류 발생: {e}")
