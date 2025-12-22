import pandas as pd
import time
import re
from io import StringIO
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

def clean_value(val):
    """문자열에서 쉼표, 공백 등을 제거하고 float로 변환"""
    if pd.isna(val) or val == '' or val == '-':
        return None
    try:
        if isinstance(val, str):
            val = val.replace(',', '').strip()
        return float(val)
    except:
        return None

def get_financial_summary_annual(driver, code):
    """네이버 금융(WiseReport)에서 연간 재무제표 크롤링 - 삼성전자 테스트"""
    try:
        url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
        print(f"[INFO] Accessing: {url}")
        driver.get(url)

        # 테이블 로딩 대기
        WebDriverWait(driver, 5).until(EC.presence_of_element_located((By.CSS_SELECTOR, "table")))

        # '연간' 버튼 클릭 시도
        try:
            annual_btns = driver.find_elements(By.XPATH, "//a[contains(text(), '연간')] | //label[contains(text(), '연간')]")
            for btn in annual_btns:
                if btn.is_displayed():
                    btn.click()
                    time.sleep(0.5)
                    break
        except Exception:
            pass

        # HTML 파싱
        html = driver.page_source
        dfs = pd.read_html(StringIO(html), flavor='bs4')

        target_df = None
        for df in dfs:
            if '매출액' in str(df) and len(df.columns) >= 5:
                target_df = df
                break

        if target_df is None:
            print("[ERROR] Could not find financial table")
            return None

        # 데이터프레임 정리
        df = target_df.copy()
        df.set_index(df.columns[0], inplace=True)

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(1)

        print(f"\n[DEBUG] Available columns: {df.columns.tolist()}")
        print(f"\n[DEBUG] Available rows (first 20):")
        for i, row_name in enumerate(df.index[:20]):
            print(f"  {i+1}. {row_name}")

        # ★ DB 컬럼 매핑 (수정된 버전)
        item_map = {
            'revenue': '매출액',
            'op_income': '영업이익(발표기준)',
            'net_income': '당기순이익',
            'assets': '자산총계',
            'equity': '자본총계',
            'equity_controlling': '자본총계(지배)',
            'liabilities': '부채총계',
            'eps': 'EPS',
            'per': 'PER',
            'bps': 'BPS',
            'pbr': 'PBR',
            'div_yield': '현금배당수익률',
            'shares_outstanding': '발행주식수'
        }

        # ★ 정수형(bigint)으로 변환해야 하는 컬럼 목록 (소수점 제거용)
        int_columns = ['revenue', 'op_income', 'net_income', 'assets', 'equity', 'equity_controlling', 'liabilities', 'shares_outstanding']

        # 2024년 데이터만 추출
        year_2024_col = None
        for col_name in df.columns:
            if '2024' in str(col_name):
                year_2024_col = col_name
                break

        if year_2024_col is None:
            print("[WARN] 2024 column not found")
            return None

        print(f"\n[INFO] Found 2024 column: {year_2024_col}")
        print("\n" + "=" * 60)
        print("Samsung Electronics - 2024 Financial Data")
        print("=" * 60)

        record = {
            'company_code': code,
            'year': 2024
        }

        for db_col, search_keyword in item_map.items():
            try:
                matches = df.index[df.index.astype(str).str.contains(search_keyword, regex=False)]
                if len(matches) > 0:
                    raw_val = df.loc[matches[0], year_2024_col]
                    val = clean_value(raw_val)

                    # ★ 핵심 수정: bigint 컬럼은 int()로 변환하여 .0 제거
                    if val is not None and db_col in int_columns:
                        record[db_col] = int(val)
                    else:
                        record[db_col] = val

                    # Print result
                    if val is not None:
                        if db_col in int_columns:
                            print(f"{search_keyword:20s} : {int(val):,}")
                        else:
                            print(f"{search_keyword:20s} : {val}")
                    else:
                        print(f"{search_keyword:20s} : NULL")
                else:
                    record[db_col] = None
                    print(f"{search_keyword:20s} : NOT FOUND")
            except Exception as e:
                record[db_col] = None
                print(f"{search_keyword:20s} : ERROR - {e}")

        print("=" * 60)

        return record

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        return None

def main():
    print("[START] Samsung Electronics Financial Data Test\n")

    # Chrome 드라이버 설정
    options = webdriver.ChromeOptions()
    # options.add_argument("--headless")  # 테스트 시에는 브라우저를 보는 것이 좋음
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        # 삼성전자 (005930)
        result = get_financial_summary_annual(driver, "005930")

        if result:
            print("\n[SUCCESS] Data retrieved successfully!")
            print("\nRecord to be saved to DB:")
            import json
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print("\n[FAILED] Could not retrieve data")

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()

    finally:
        driver.quit()
        print("\n[DONE]")

if __name__ == "__main__":
    main()
