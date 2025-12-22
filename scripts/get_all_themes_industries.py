import time
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def get_all_themes(driver):
    """Get all themes from all pages"""
    all_themes = []
    page = 1

    while True:
        url = f"https://finance.naver.com/sise/theme.naver?&page={page}"
        print(f"[INFO] Fetching theme page {page}: {url}")
        driver.get(url)
        time.sleep(2)

        soup = BeautifulSoup(driver.page_source, 'html.parser')

        # Find theme links
        theme_links = soup.find_all('a', href=lambda x: x and 'theme' in x and 'no=' in x)

        if not theme_links:
            print(f"[INFO] No more themes found on page {page}")
            break

        page_themes = []
        for link in theme_links:
            href = link.get('href')
            if 'no=' in href:
                theme_no = href.split('no=')[1].split('&')[0] if '&' in href.split('no=')[1] else href.split('no=')[1]
                theme_name = link.text.strip()

                # Avoid duplicates
                if not any(t['no'] == theme_no for t in all_themes):
                    theme_dict = {
                        'no': theme_no,
                        'name': theme_name
                    }
                    all_themes.append(theme_dict)
                    page_themes.append(theme_dict)

        print(f"[OK] Found {len(page_themes)} themes on page {page}")

        # Check if there's a next page
        next_page = soup.find('a', text=str(page + 1))
        if not next_page:
            print(f"[INFO] No more pages after page {page}")
            break

        page += 1
        time.sleep(1)

    return all_themes

def get_all_industries(driver):
    """Get all industries (single page)"""
    url = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
    print(f"[INFO] Fetching industries: {url}")
    driver.get(url)
    time.sleep(2)

    soup = BeautifulSoup(driver.page_source, 'html.parser')

    # Find industry links
    industry_links = soup.find_all('a', href=lambda x: x and 'upjong' in x and 'no=' in x)

    all_industries = []
    for link in industry_links:
        href = link.get('href')
        if 'no=' in href:
            industry_no = href.split('no=')[1].split('&')[0] if '&' in href.split('no=')[1] else href.split('no=')[1]
            industry_name = link.text.strip()

            # Avoid duplicates
            if not any(i['no'] == industry_no for i in all_industries):
                all_industries.append({
                    'no': industry_no,
                    'name': industry_name
                })

    print(f"[OK] Found {len(all_industries)} industries")
    return all_industries

def main():
    print("[START] Fetching all themes and industries\n")

    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        # Get all themes
        print("=" * 60)
        print("Fetching Themes")
        print("=" * 60)
        themes = get_all_themes(driver)

        print(f"\n[RESULT] Total themes: {len(themes)}")
        print("\nFirst 10 themes:")
        for i, theme in enumerate(themes[:10], 1):
            print(f"  {i}. {theme['name']} (no={theme['no']})")

        print("\nLast 10 themes:")
        for i, theme in enumerate(themes[-10:], len(themes) - 9):
            print(f"  {i}. {theme['name']} (no={theme['no']})")

        time.sleep(2)

        # Get all industries
        print("\n" + "=" * 60)
        print("Fetching Industries")
        print("=" * 60)
        industries = get_all_industries(driver)

        print(f"\n[RESULT] Total industries: {len(industries)}")
        print("\nFirst 10 industries:")
        for i, industry in enumerate(industries[:10], 1):
            print(f"  {i}. {industry['name']} (no={industry['no']})")

        # Save to file
        import json

        with open('themes_industries.json', 'w', encoding='utf-8') as f:
            json.dump({
                'themes': themes,
                'industries': industries
            }, f, ensure_ascii=False, indent=2)

        print(f"\n[SAVED] Data saved to themes_industries.json")

    finally:
        driver.quit()
        print("\n" + "=" * 60)
        print("[DONE]")

if __name__ == "__main__":
    main()
