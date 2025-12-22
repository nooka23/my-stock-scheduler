import pandas as pd
import time
from io import StringIO
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def get_theme_companies(driver, theme_no):
    """Fetch companies in a theme"""
    try:
        url = f"https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no={theme_no}"
        print(f"[INFO] Accessing: {url}")
        driver.get(url)
        time.sleep(3)

        # Check current URL
        current_url = driver.current_url
        print(f"[DEBUG] Current URL: {current_url}")
        print(f"[DEBUG] Page title: {driver.title}")

        # Save HTML for debugging
        html_content = driver.page_source
        with open(f'theme_{theme_no}_debug.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"[DEBUG] HTML saved to theme_{theme_no}_debug.html")

        # Parse HTML with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')

        # Find all stock links
        companies = []
        links = soup.select('a')

        print(f"[DEBUG] Total links found: {len(links)}")

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
                        print(f"[DEBUG] Added: {name} ({code})")

        return companies

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        return []

def get_industry_companies(driver, industry_no):
    """Fetch companies in an industry"""
    try:
        url = f"https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no={industry_no}"
        print(f"[INFO] Accessing: {url}")
        driver.get(url)
        time.sleep(3)

        # Save HTML for debugging
        html_content = driver.page_source
        with open(f'industry_{industry_no}_debug.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"[DEBUG] HTML saved to industry_{industry_no}_debug.html")

        # Parse HTML with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')

        # Find all stock links
        companies = []
        links = soup.select('a')

        print(f"[DEBUG] Total links found: {len(links)}")

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
                        print(f"[DEBUG] Added: {name} ({code})")

        return companies

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        return []

def main():
    print("[START] Theme/Industry Crawler Test\n")

    # Chrome driver setup
    options = webdriver.ChromeOptions()
    # Headless mode disabled to see what's happening
    # options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        # Test 1: Theme (Semiconductor Equipment - no 12)
        print("=" * 60)
        print("[TEST 1] Semiconductor Equipment Theme (no=12)")
        print("=" * 60)
        theme_companies = get_theme_companies(driver, 12)

        if theme_companies:
            print(f"\n[OK] Found {len(theme_companies)} companies:")
            for i, comp in enumerate(theme_companies[:10], 1):
                print(f"  {i}. {comp['name']} ({comp['code']})")
            if len(theme_companies) > 10:
                print(f"  ... and {len(theme_companies) - 10} more")
        else:
            print("[WARN] No companies found")

        time.sleep(2)

        # Test 2: Industry (Venture Capital - no 277)
        print("\n" + "=" * 60)
        print("[TEST 2] Venture Capital Industry (no=277)")
        print("=" * 60)
        industry_companies = get_industry_companies(driver, 277)

        if industry_companies:
            print(f"\n[OK] Found {len(industry_companies)} companies:")
            for i, comp in enumerate(industry_companies[:10], 1):
                print(f"  {i}. {comp['name']} ({comp['code']})")
            if len(industry_companies) > 10:
                print(f"  ... and {len(industry_companies) - 10} more")
        else:
            print("[WARN] No companies found")

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()

    finally:
        driver.quit()
        print("\n" + "=" * 60)
        print("[DONE] Test Complete!")

if __name__ == "__main__":
    main()
