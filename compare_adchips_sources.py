import FinanceDataReader as fdr
import pandas as pd
import os

# 1. 설정
code_krx = 'KRX:054630' # 네이버 금융 기반 (FDR 기본)
code_yahoo = '054630.KQ' # 야후 파이낸스 기반 (코스닥은 .KQ)
name = '에이디칩스'
start_date = '2024-01-01'
end_date = '2025-12-04'
output_file = 'ADChips_Source_Compare.xlsx'

print(f"🚀 {name} 데이터 소스별 비교 시작 ({start_date} ~ {end_date})")

try:
    # -------------------------------------------------------
    # 2. 네이버 금융 (KRX) 데이터 가져오기
    # -------------------------------------------------------
    print(f"📡 네이버(KRX) 데이터 가져오는 중...")
    df_naver = fdr.DataReader(code_krx, start_date, end_date)
    
    # -------------------------------------------------------
    # 3. 야후 파이낸스 데이터 가져오기
    # -------------------------------------------------------
    print(f"📡 야후 파이낸스 데이터 가져오는 중...")
    # 야후는 가끔 연결이 불안정할 수 있어서 예외처리
    try:
        df_yahoo = fdr.DataReader(code_yahoo, start_date, end_date)
    except Exception as e:
        print(f"⚠️ 야후 데이터 가져오기 실패: {e}")
        df_yahoo = pd.DataFrame()

    # -------------------------------------------------------
    # 4. 비교 데이터 만들기
    # -------------------------------------------------------
    if not df_naver.empty and not df_yahoo.empty:
        # 인덱스(날짜)를 기준으로 병합
        # suffix를 붙여서 컬럼 이름 구분 (_Naver, _Yahoo)
        merged = df_naver[['Close']].join(df_yahoo[['Close', 'Adj Close']], lsuffix='_Naver', rsuffix='_Yahoo')
        
        # 야후는 'Adj Close(수정종가)'를 따로 줍니다. 이걸 명확히 표시
        merged.columns = ['Naver_Close', 'Yahoo_Close', 'Yahoo_Adj_Close']
        
        # 보기 좋게 날짜 인덱스를 컬럼으로
        merged = merged.reset_index()
        merged['Date'] = merged['Date'].dt.strftime('%Y-%m-%d')
        
        # 차이 계산 (네이버 vs 야후 수정종가)
        # 두 값이 다르면 True, 같으면 False (엑셀에서 조건부 서식 걸기 좋게)
        merged['Diff_Check'] = abs(merged['Naver_Close'] - merged['Yahoo_Adj_Close']) > 1 # 1원 이상 차이나면 체크
        
        print(f"✅ 데이터 병합 완료 ({len(merged)}건)")
    else:
        print("❌ 비교할 데이터가 부족합니다.")
        merged = pd.DataFrame()

    # -------------------------------------------------------
    # 5. 엑셀로 저장
    # -------------------------------------------------------
    with pd.ExcelWriter(output_file, engine='openpyxl') as writer:
        # 시트 1: 한눈에 비교
        if not merged.empty:
            merged.to_excel(writer, sheet_name='Compare(비교)', index=False)
        
        # 시트 2: 네이버 원본
        df_naver.reset_index().to_excel(writer, sheet_name='Source_Naver', index=False)
        
        # 시트 3: 야후 원본
        if not df_yahoo.empty:
            df_yahoo.reset_index().to_excel(writer, sheet_name='Source_Yahoo', index=False)
        
    print(f"🎉 파일 저장 완료: {os.path.abspath(output_file)}")
    print("👉 엑셀 파일의 'Compare' 시트에서 'Diff_Check'가 TRUE인 날짜를 확인하세요!")

except Exception as e:
    print(f"❌ 오류 발생: {e}")
