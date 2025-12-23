"""
주간 전체 데이터 업데이트 스크립트
- 테마/업종 정보 업데이트
- 테마/업종별 종목 매핑 업데이트
- 전체 종목 재무정보 업데이트
"""

import json
import pandas as pd
import time
import re
from io import StringIO
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from supabase import create_client, Client
import os
from dotenv import load_dotenv

# ---------------------------------------------------------
# 환경변수 로드
# ---------------------------------------------------------
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"[ENV] Loading from: {env_path}")
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("[ERROR] Supabase credentials not found in .env")
    exit(1)

supabase: Client = create_client(url, key)

# ---------------------------------------------------------
# 공통 유틸리티
# ---------------------------------------------------------
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

def setup_chrome_driver(headless=True):
    """Chrome 드라이버 설정"""
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    return webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

# ---------------------------------------------------------
# PART 1: 테마/업종 업데이트
# ---------------------------------------------------------
def get_all_themes(driver):
    """모든 테마 수집"""
    print("\n[1-1] Collecting all themes...")
    all_themes = []
    page = 1

    while True:
        url = f"https://finance.naver.com/sise/theme.naver?&page={page}"
        driver.get(url)
        time.sleep(2)

        soup = BeautifulSoup(driver.page_source, 'html.parser')
        theme_links = soup.find_all('a', href=lambda x: x and 'theme' in x and 'no=' in x)

        if not theme_links:
            break

        page_themes = []
        for link in theme_links:
            href = link.get('href')
            if 'no=' in href:
                theme_no = href.split('no=')[1].split('&')[0] if '&' in href.split('no=')[1] else href.split('no=')[1]
                theme_name = link.text.strip()

                if not any(t['no'] == theme_no for t in all_themes):
                    theme_dict = {'no': theme_no, 'name': theme_name}
                    all_themes.append(theme_dict)
                    page_themes.append(theme_dict)

        print(f"  Page {page}: {len(page_themes)} themes")

        next_page = soup.find('a', string=str(page + 1))
        if not next_page:
            break

        page += 1
        time.sleep(1)

    print(f"[OK] Total themes collected: {len(all_themes)}")
    return all_themes

def get_all_industries(driver):
    """모든 업종 수집"""
    print("\n[1-2] Collecting all industries...")
    url = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
    driver.get(url)
    time.sleep(2)

    soup = BeautifulSoup(driver.page_source, 'html.parser')
    industry_links = soup.find_all('a', href=lambda x: x and 'upjong' in x and 'no=' in x)

    all_industries = []
    for link in industry_links:
        href = link.get('href')
        if 'no=' in href:
            industry_no = href.split('no=')[1].split('&')[0] if '&' in href.split('no=')[1] else href.split('no=')[1]
            industry_name = link.text.strip()

            if not any(i['no'] == industry_no for i in all_industries):
                all_industries.append({'no': industry_no, 'name': industry_name})

    print(f"[OK] Total industries collected: {len(all_industries)}")
    return all_industries

def save_themes_and_industries(themes, industries):
    """테마/업종을 DB에 저장"""
    print("\n[1-3] Saving themes to DB...")
    theme_records = [{'code': t['no'], 'name': t['name']} for t in themes]
    try:
        supabase.table('themes').upsert(theme_records, on_conflict='code').execute()
        print(f"[OK] Saved {len(theme_records)} themes")
    except Exception as e:
        print(f"[ERROR] Failed to save themes: {e}")
        return False

    print("\n[1-4] Saving industries to DB...")
    industry_records = [{'code': i['no'], 'name': i['name']} for i in industries]
    try:
        supabase.table('industries').upsert(industry_records, on_conflict='code').execute()
        print(f"[OK] Saved {len(industry_records)} industries")
    except Exception as e:
        print(f"[ERROR] Failed to save industries: {e}")
        return False

    return True

def get_companies_from_page(driver, page_type, no):
    """테마/업종 페이지에서 종목 크롤링"""
    try:
        url = f"https://finance.naver.com/sise/sise_group_detail.naver?type={page_type}&no={no}"
        driver.get(url)
        time.sleep(2)

        if driver.current_url != url:
            return []

        soup = BeautifulSoup(driver.page_source, 'html.parser')
        companies = []
        links = soup.select('a')

        for link in links:
            href = link.get('href', '')
            if 'item/main.naver?code=' in href or 'item/main.nhn?code=' in href:
                code = href.split('code=')[1].split('&')[0] if 'code=' in href else None
                name = link.text.strip()

                if code and name and len(code) == 6 and code.isdigit():
                    if not any(c['code'] == code for c in companies):
                        companies.append({'code': code, 'name': name})

        return companies

    except Exception as e:
        return []

def update_theme_companies(driver):
    """테마별 종목 매핑 업데이트"""
    print("\n[1-5] Updating theme-company mappings...")

    try:
        response = supabase.table('themes').select('id, code, name').execute()
        themes = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load themes: {e}")
        return

    success_count = 0
    fail_count = 0

    for idx, theme in enumerate(themes):
        theme_id = theme['id']
        theme_code = theme['code']
        theme_name = theme['name']

        print(f"  [{idx + 1}/{len(themes)}] {theme_name}...", end=" ")

        companies = get_companies_from_page(driver, 'theme', theme_code)

        if not companies:
            print("No companies")
            fail_count += 1
            continue

        try:
            mapping_records = [{'company_code': comp['code'], 'theme_id': theme_id} for comp in companies]
            supabase.table('company_themes').delete().eq('theme_id', theme_id).execute()
            supabase.table('company_themes').insert(mapping_records).execute()
            print(f"{len(companies)} companies")
            success_count += 1
        except Exception as e:
            print(f"Error: {e}")
            fail_count += 1

        time.sleep(1)

    print(f"[RESULT] Success: {success_count}, Failed: {fail_count}")

def update_industry_companies(driver):
    """업종별 종목 매핑 업데이트"""
    print("\n[1-6] Updating industry-company mappings...")

    try:
        response = supabase.table('industries').select('id, code, name').execute()
        industries = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load industries: {e}")
        return

    success_count = 0
    fail_count = 0

    for idx, industry in enumerate(industries):
        industry_id = industry['id']
        industry_code = industry['code']
        industry_name = industry['name']

        print(f"  [{idx + 1}/{len(industries)}] {industry_name}...", end=" ")

        companies = get_companies_from_page(driver, 'upjong', industry_code)

        if not companies:
            print("No companies")
            fail_count += 1
            continue

        try:
            mapping_records = [{'company_code': comp['code'], 'industry_id': industry_id} for comp in companies]
            supabase.table('company_industries').delete().eq('industry_id', industry_id).execute()
            supabase.table('company_industries').insert(mapping_records).execute()
            print(f"{len(companies)} companies")
            success_count += 1
        except Exception as e:
            print(f"Error: {e}")
            fail_count += 1

        time.sleep(1)

    print(f"[RESULT] Success: {success_count}, Failed: {fail_count}")

# ---------------------------------------------------------
# PART 2: 재무정보 업데이트
# ---------------------------------------------------------
def get_financial_summary_annual(driver, code):
    """네이버 금융(WiseReport)에서 연간 재무제표 크롤링"""
    try:
        url = f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}"
        driver.get(url)

        WebDriverWait(driver, 5).until(EC.presence_of_element_located((By.CSS_SELECTOR, "table")))

        try:
            annual_btns = driver.find_elements(By.XPATH, "//a[contains(text(), '연간')] | //label[contains(text(), '연간')]")
            for btn in annual_btns:
                if btn.is_displayed():
                    btn.click()
                    time.sleep(0.5)
                    break
        except Exception:
            pass

        html = driver.page_source
        dfs = pd.read_html(StringIO(html), flavor='bs4')

        target_df = None
        for df in dfs:
            if '매출액' in str(df) and len(df.columns) >= 5:
                target_df = df
                break

        if target_df is None:
            return None

        df = target_df.copy()
        df.set_index(df.columns[0], inplace=True)

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(1)

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

        int_columns = ['revenue', 'op_income', 'net_income', 'assets', 'equity', 'equity_controlling', 'liabilities', 'shares_outstanding']

        records = []

        for col_name in df.columns:
            year_match = re.search(r'20\d{2}', str(col_name))
            if not year_match:
                continue

            year = int(year_match.group())

            record = {
                'company_code': code,
                'year': year
            }

            for db_col, search_keyword in item_map.items():
                try:
                    matches = df.index[df.index.astype(str).str.contains(search_keyword, regex=False)]
                    if len(matches) > 0:
                        raw_val = df.loc[matches[0], col_name]
                        val = clean_value(raw_val)

                        if val is not None and db_col in int_columns:
                            record[db_col] = int(val)
                        else:
                            record[db_col] = val
                    else:
                        record[db_col] = None
                except:
                    record[db_col] = None

            if record['revenue'] is not None or record['assets'] is not None:
                records.append(record)

        return records

    except Exception as e:
        return None

def update_financials():
    """전체 종목 재무정보 업데이트"""
    print("\n[2-1] Updating financial information...")

    try:
        response = supabase.table('companies').select('code, name').execute()
        companies = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load companies: {e}")
        return

    print(f"[INFO] Total companies: {len(companies)}")

    driver = setup_chrome_driver(headless=True)

    try:
        success_count = 0
        fail_count = 0

        for idx, company in enumerate(companies):
            code = company['code']
            name = company['name']

            print(f"  [{idx+1}/{len(companies)}] {name}({code})...", end=" ")

            data_list = get_financial_summary_annual(driver, code)

            if data_list:
                try:
                    supabase.table('company_financials').upsert(
                        data_list,
                        on_conflict='company_code, year'
                    ).execute()

                    print(f"{len(data_list)} years saved")
                    success_count += 1
                except Exception as e:
                    print(f"DB Error: {e}")
                    fail_count += 1
            else:
                print("No data")
                fail_count += 1

            time.sleep(1)

        print(f"[RESULT] Success: {success_count}, Failed: {fail_count}")

    finally:
        driver.quit()

# ---------------------------------------------------------
# 메인 실행
# ---------------------------------------------------------
def main():
    print("=" * 60)
    print("Weekly Full Data Update")
    print("=" * 60)
    print("This script will:")
    print("  1. Update themes and industries")
    print("  2. Update theme-company mappings")
    print("  3. Update industry-company mappings")
    print("  4. Update financial information for all companies")
    print("=" * 60)

    start_time = time.time()

    # PART 1: 테마/업종 업데이트
    print("\n" + "=" * 60)
    print("PART 1: Themes and Industries Update")
    print("=" * 60)

    driver = setup_chrome_driver(headless=True)

    try:
        themes = get_all_themes(driver)
        industries = get_all_industries(driver)

        if not save_themes_and_industries(themes, industries):
            print("[ERROR] Failed to save themes/industries. Exiting.")
            return

        update_theme_companies(driver)
        update_industry_companies(driver)

    finally:
        driver.quit()

    # PART 2: 재무정보 업데이트
    print("\n" + "=" * 60)
    print("PART 2: Financial Information Update")
    print("=" * 60)

    update_financials()

    # 완료
    elapsed_time = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"[DONE] All tasks completed in {elapsed_time:.1f} seconds ({elapsed_time/60:.1f} minutes)")
    print("=" * 60)

if __name__ == "__main__":
    main()
