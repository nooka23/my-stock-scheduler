import json
import time
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from supabase import create_client, Client
import os
from dotenv import load_dotenv

# ---------------------------------------------------------
# 1. 환경변수 로드
# ---------------------------------------------------------
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
env_path = os.path.join(project_root, '.env.local')

if not os.path.exists(env_path):
    env_path = os.path.join(project_root, '.env')

print(f"[ENV] Loading from: {env_path}")
load_dotenv(dotenv_path=env_path)

url: str = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key: str = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("[ERROR] Supabase credentials not found in .env")
    exit(1)

supabase: Client = create_client(url, key)

# ---------------------------------------------------------
# 2. 테마/업종 목록을 DB에 저장
# ---------------------------------------------------------
def save_themes_and_industries():
    """Load themes_industries.json and save to DB"""

    # Load JSON file
    json_path = os.path.join(project_root, 'themes_industries.json')

    if not os.path.exists(json_path):
        print(f"[ERROR] {json_path} not found. Run get_all_themes_industries.py first.")
        return False

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    themes = data['themes']
    industries = data['industries']

    print(f"\n[INFO] Loaded {len(themes)} themes and {len(industries)} industries")

    # Save themes
    print("\n[STEP 1] Saving themes to DB...")
    theme_records = [{'code': t['no'], 'name': t['name']} for t in themes]

    try:
        result = supabase.table('themes').upsert(
            theme_records,
            on_conflict='code'
        ).execute()
        print(f"[OK] Saved {len(theme_records)} themes")
    except Exception as e:
        print(f"[ERROR] Failed to save themes: {e}")
        return False

    # Save industries
    print("\n[STEP 2] Saving industries to DB...")
    industry_records = [{'code': i['no'], 'name': i['name']} for i in industries]

    try:
        result = supabase.table('industries').upsert(
            industry_records,
            on_conflict='code'
        ).execute()
        print(f"[OK] Saved {len(industry_records)} industries")
    except Exception as e:
        print(f"[ERROR] Failed to save industries: {e}")
        return False

    return True

# ---------------------------------------------------------
# 3. 종목 크롤링 함수
# ---------------------------------------------------------
def get_companies_from_page(driver, page_type, no):
    """Crawl companies from theme or industry page"""
    try:
        url = f"https://finance.naver.com/sise/sise_group_detail.naver?type={page_type}&no={no}"
        driver.get(url)
        time.sleep(2)

        # Check if redirected
        if driver.current_url != url:
            print(f"[WARN] Redirected from {url}")
            return []

        soup = BeautifulSoup(driver.page_source, 'html.parser')

        # Find all stock links
        companies = []
        links = soup.select('a')

        for link in links:
            href = link.get('href', '')
            if 'item/main.naver?code=' in href or 'item/main.nhn?code=' in href:
                code = href.split('code=')[1].split('&')[0] if 'code=' in href else None
                name = link.text.strip()

                if code and name and len(code) == 6 and code.isdigit():
                    # Avoid duplicates
                    if not any(c['code'] == code for c in companies):
                        companies.append({
                            'code': code,
                            'name': name
                        })

        return companies

    except Exception as e:
        print(f"[ERROR] {e}")
        return []

# ---------------------------------------------------------
# 4. 테마별 종목 매핑 저장
# ---------------------------------------------------------
def update_theme_companies(start_index=0):
    """Crawl and save theme-company mappings"""

    # Get all themes from DB
    try:
        response = supabase.table('themes').select('id, code, name').execute()
        themes = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load themes: {e}")
        return

    themes = themes[start_index:]
    print(f"\n[STEP 3] Processing {len(themes)} themes (starting from index {start_index})...")

    # Setup Chrome driver
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        success_count = 0
        fail_count = 0

        for idx, theme in enumerate(themes):
            theme_id = theme['id']
            theme_code = theme['code']
            theme_name = theme['name']

            print(f"[{start_index + idx + 1}/{start_index + len(themes)}] {theme_name} (code={theme_code})...", end=" ")

            # Crawl companies
            companies = get_companies_from_page(driver, 'theme', theme_code)

            if not companies:
                print("No companies found")
                fail_count += 1
                continue

            # Save to DB
            try:
                # Prepare mapping records
                mapping_records = [
                    {
                        'company_code': comp['code'],
                        'theme_id': theme_id
                    }
                    for comp in companies
                ]

                # Delete existing mappings for this theme
                supabase.table('company_themes').delete().eq('theme_id', theme_id).execute()

                # Insert new mappings
                supabase.table('company_themes').insert(mapping_records).execute()

                print(f"OK - {len(companies)} companies")
                success_count += 1

            except Exception as e:
                print(f"DB Error: {e}")
                fail_count += 1

            time.sleep(1)

        print(f"\n[RESULT] Success: {success_count}, Failed: {fail_count}")

    finally:
        driver.quit()

# ---------------------------------------------------------
# 5. 업종별 종목 매핑 저장
# ---------------------------------------------------------
def update_industry_companies(start_index=0):
    """Crawl and save industry-company mappings"""

    # Get all industries from DB
    try:
        response = supabase.table('industries').select('id, code, name').execute()
        industries = response.data
    except Exception as e:
        print(f"[ERROR] Failed to load industries: {e}")
        return

    industries = industries[start_index:]
    print(f"\n[STEP 4] Processing {len(industries)} industries (starting from index {start_index})...")

    # Setup Chrome driver
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        success_count = 0
        fail_count = 0

        for idx, industry in enumerate(industries):
            industry_id = industry['id']
            industry_code = industry['code']
            industry_name = industry['name']

            print(f"[{start_index + idx + 1}/{start_index + len(industries)}] {industry_name} (code={industry_code})...", end=" ")

            # Crawl companies
            companies = get_companies_from_page(driver, 'upjong', industry_code)

            if not companies:
                print("No companies found")
                fail_count += 1
                continue

            # Save to DB
            try:
                # Prepare mapping records
                mapping_records = [
                    {
                        'company_code': comp['code'],
                        'industry_id': industry_id
                    }
                    for comp in companies
                ]

                # Delete existing mappings for this industry
                supabase.table('company_industries').delete().eq('industry_id', industry_id).execute()

                # Insert new mappings
                supabase.table('company_industries').insert(mapping_records).execute()

                print(f"OK - {len(companies)} companies")
                success_count += 1

            except Exception as e:
                print(f"DB Error: {e}")
                fail_count += 1

            time.sleep(1)

        print(f"\n[RESULT] Success: {success_count}, Failed: {fail_count}")

    finally:
        driver.quit()

# ---------------------------------------------------------
# 6. 메인 실행
# ---------------------------------------------------------
def main():
    print("=" * 60)
    print("Theme/Industry Data Update Script")
    print("=" * 60)

    # Step 1 & 2: Save themes and industries
    if not save_themes_and_industries():
        print("\n[ERROR] Failed to save themes/industries. Exiting.")
        return

    print("\n" + "=" * 60)
    print("Ready to crawl companies for themes and industries")
    print("=" * 60)

    # Step 3: Update theme companies
    update_theme_companies(start_index=0)

    # Step 4: Update industry companies
    update_industry_companies(start_index=0)

    print("\n" + "=" * 60)
    print("[DONE] All tasks completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()
