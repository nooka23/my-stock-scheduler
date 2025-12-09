import FinanceDataReader as fdr
import pandas as pd

try:
    print("FinanceDataReader.StockListing('KRX-DESC') 테스트...")
    df = fdr.StockListing('KRX-DESC')
    print("성공적으로 데이터 로드.")

    print("\n컬럼 목록:")
    print(df.columns.tolist())

    if 'Sector' in df.columns:
        print("\n'Sector' 컬럼이 존재합니다.")
        print("\n'Sector' 컬럼의 고유값 (상위 10개):")
        print(df['Sector'].value_counts().head(10))
        print("\n'Sector' 컬럼의 데이터 예시 (Code, Name, Sector):")
        print(df[['Code', 'Name', 'Sector']].head())
    elif '업종' in df.columns:
        print("\n'업종' 컬럼이 존재합니다. (한국어 컬럼명)")
        print("\n'업종' 컬럼의 고유값 (상위 10개):")
        print(df['업종'].value_counts().head(10))
        print("\n'업종' 컬럼의 데이터 예시 (Code, Name, 업종):")
        print(df[['Code', 'Name', '업종']].head())
    else:
        print("\n'Sector' 또는 '업종' 컬럼을 찾을 수 없습니다. 다른 컬럼 목록을 확인하세요.")

except Exception as e:
    print(f"\n데이터 로드 중 오류 발생: {e}")
    print("Traceback:")
    import traceback
    traceback.print_exc()