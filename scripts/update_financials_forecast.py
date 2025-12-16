"""
네이버 금융(WiseReport)에서 향후 예측치를 수집하는 스크립트
- DART API로 수집할 수 없는 미래 예측 데이터를 네이버에서 가져옴
"""

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
from supabase import create_client, Client
import os
from dotenv import load_dotenv
from datetime import datetime

# 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"📂 환경변수 로드 경로: {env_path}")
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("❌ 오류: .env 파일에서 Supabase URL 또는 Key를 찾을 수 없습니다.")
    exit(1)

supabase: Client = create_client(url, key)


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


def get_forecast_data(driver, code):
    """네이버 금융(WiseReport)에서 예측치 크롤링 (미래 연도만)"""
    try:
        url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
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
            return None

        # 데이터프레임 정리
        df = target_df.copy()
        df.set_index(df.columns[0], inplace=True)

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(1)

        # 컬럼 매핑 (예측치만 필요: 매출액, 영업이익)
        item_map = {
            'revenue': '매출액',
            'op_income': '영업이익'
        }

        # 현재 연도 확인
        current_year = datetime.now().year

        records = []

        for col_name in df.columns:
            # 연도 추출
            year_match = re.search(r'20\d{2}', str(col_name))
            if not year_match:
                continue

            year = int(year_match.group())

            # ⭐ 중요: 미래 연도만 수집 (예측치)
            # 현재 연도 이후의 데이터만 예측치로 간주
            if year <= current_year:
                continue

            record = {
                'company_code': code,
                'year': year,
                'quarter': 0,  # 연간 예측치는 quarter=0
                'data_source': 'forecast'
            }

            for db_col, search_keyword in item_map.items():
                try:
                    matches = df.index[df.index.astype(str).str.contains(search_keyword, regex=False)]
                    if len(matches) > 0:
                        raw_val = df.loc[matches[0], col_name]
                        val = clean_value(raw_val)

                        # 정수로 변환 (이미 억원 단위)
                        if val is not None:
                            record[db_col] = int(val)  # 억원 그대로 저장
                        else:
                            record[db_col] = None
                    else:
                        record[db_col] = None
                except:
                    record[db_col] = None

            # 매출액이 있는 경우만 저장
            if record.get('revenue') is not None:
                records.append(record)

        return records if len(records) > 0 else None

    except Exception as e:
        return None


def main():
    print("📡 DB에서 종목 목록을 가져옵니다...")

    try:
        response = supabase.table('companies').select('code, name').execute()
        companies = response.data
    except Exception as e:
        print(f"❌ 종목 목록 로드 실패: {e}")
        return

    # 이어하기 (필요시 인덱스 수정)
    start_idx = 0
    companies = companies[start_idx:]

    current_year = datetime.now().year
    print(f"🚀 총 {len(companies)}개 종목의 예측치({current_year+1}년 이후) 업데이트 시작...")

    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        success_count = 0
        fail_count = 0

        for idx, company in enumerate(companies):
            code = company['code']
            name = company['name']

            print(f"[{idx+1}/{len(companies)}] {name}({code}) 처리 중...", end=" ")

            data_list = get_forecast_data(driver, code)

            if data_list:
                try:
                    # DB 저장
                    supabase.table('company_financials_v2').upsert(
                        data_list,
                        on_conflict='company_code,year,quarter,data_source'
                    ).execute()

                    years = [d['year'] for d in data_list]
                    print(f"✅ {len(data_list)}개 연도 저장 완료 ({', '.join(map(str, years))})")
                    success_count += 1
                except Exception as e:
                    if hasattr(e, 'message'):
                        print(f"❌ DB 저장 실패: {e.message}")
                    else:
                        print(f"❌ DB 저장 실패: {e}")
                    fail_count += 1
            else:
                print("⚠️ 예측 데이터 없음")
                fail_count += 1

            time.sleep(1)

    except KeyboardInterrupt:
        print("\n🛑 사용자에 의해 중단되었습니다.")

    finally:
        driver.quit()
        print("="*50)
        print(f"🎉 작업 종료! 성공: {success_count}, 실패/없음: {fail_count}")

if __name__ == "__main__":
    main()
