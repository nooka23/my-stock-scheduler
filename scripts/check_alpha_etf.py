import os
import FinanceDataReader as fdr
from dotenv import load_dotenv
import pandas as pd

# 환경 변수 로드
load_dotenv('.env.local')

def check_alpha_etf():
    """알파벳이 포함된 ETF 리스트 확인"""
    print("🔍 알파벳 포함 ETF 확인 중...")

    try:
        # ETF 리스트 가져오기
        df_etf = fdr.StockListing('ETF/KR')

        print(f"총 {len(df_etf)}개 ETF 발견\n")

        # 알파벳이 포함된 ETF 필터링
        alpha_etfs = []
        numeric_etfs = []

        for _, row in df_etf.iterrows():
            code = str(row['Code']) if 'Code' in row else str(row['Symbol'])
            name = str(row['Name'])

            if code.isdigit():
                numeric_etfs.append({'code': code, 'name': name})
            else:
                alpha_etfs.append({'code': code, 'name': name})

        print(f"📊 분류 결과:")
        print(f"  - 숫자만: {len(numeric_etfs)}개 (이미 업로드 완료)")
        print(f"  - 알파벳 포함: {len(alpha_etfs)}개\n")

        if alpha_etfs:
            print("=" * 80)
            print("알파벳 포함 ETF 목록:")
            print("=" * 80)
            for idx, etf in enumerate(alpha_etfs, 1):
                print(f"{idx:3d}. {etf['code']:10s} - {etf['name']}")
            print("=" * 80)

            # CSV로 저장
            df_alpha = pd.DataFrame(alpha_etfs)
            csv_path = 'scripts/alpha_etf_list.csv'
            df_alpha.to_csv(csv_path, index=False, encoding='utf-8-sig')
            print(f"\n💾 알파벳 ETF 목록을 '{csv_path}'에 저장했습니다.")

        return alpha_etfs

    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        return []

if __name__ == "__main__":
    alpha_etfs = check_alpha_etf()

    if alpha_etfs:
        print(f"\n⚠️  알파벳 포함 ETF는 일반적인 한국 시장 API로 조회가 안될 수 있습니다.")
        print("   해외 ETF이거나 특수한 경우일 가능성이 높습니다.")
