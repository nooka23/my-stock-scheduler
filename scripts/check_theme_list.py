import time
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def main():
    print("[START] Checking Theme/Industry List Pages\n")

    options = webdriver.ChromeOptions()
    # options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

    try:
        # Check theme list page
        print("=" * 60)
        print("[CHECK 1] Theme List Page")
        print("=" * 60)

        url1 = "https://finance.naver.com/sise/theme.naver"
        driver.get(url1)
        time.sleep(3)

        print(f"URL: {driver.current_url}")
        print(f"Title: {driver.title}")

        # Save HTML
        with open('theme_list_debug.html', 'w', encoding='utf-8') as f:
            f.write(driver.page_source)
        print("HTML saved to theme_list_debug.html")

        # Find theme links
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        theme_links = soup.find_all('a', href=lambda x: x and 'theme' in x and 'no=' in x)

        print(f"\nFound {len(theme_links)} theme links")
        print("\nFirst 5 themes:")
        for i, link in enumerate(theme_links[:5], 1):
            print(f"  {i}. {link.text.strip()}: {link.get('href')}")

        time.sleep(2)

        # Check industry list page
        print("\n" + "=" * 60)
        print("[CHECK 2] Industry List Page")
        print("=" * 60)

        url2 = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
        driver.get(url2)
        time.sleep(3)

        print(f"URL: {driver.current_url}")
        print(f"Title: {driver.title}")

        # Save HTML
        with open('industry_list_debug.html', 'w', encoding='utf-8') as f:
            f.write(driver.page_source)
        print("HTML saved to industry_list_debug.html")

        # Find industry links
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        industry_links = soup.find_all('a', href=lambda x: x and 'upjong' in x and 'no=' in x)

        print(f"\nFound {len(industry_links)} industry links")
        print("\nFirst 5 industries:")
        for i, link in enumerate(industry_links[:5], 1):
            print(f"  {i}. {link.text.strip()}: {link.get('href')}")

    finally:
        driver.quit()
        print("\n" + "=" * 60)
        print("[DONE]")

if __name__ == "__main__":
    main()
