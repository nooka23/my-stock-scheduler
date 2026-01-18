import os
import json
import time
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv


load_dotenv(".env.local")

APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not APP_KEY or not APP_SECRET:
    print("ERROR: Missing KIS_APP_KEY or KIS_APP_SECRET in .env.local.")
    raise SystemExit(1)

KIS_BASE_URL = "https://openapi.koreainvestment.com:9443"
TOKEN_MIN_INTERVAL_SEC = 300
API_MIN_INTERVAL_SEC = 0.11
TOKEN_ERROR_CODES = {"EGW00123", "EGW00124", "EGW00125"}


class RateLimiter:
    def __init__(self, min_interval_sec: float):
        self.min_interval_sec = min_interval_sec
        self._last_call = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_call
        if elapsed < self.min_interval_sec:
            time.sleep(self.min_interval_sec - elapsed)
        self._last_call = time.monotonic()


class TokenManager:
    def __init__(self):
        self._token = None
        self._issued_at = 0.0

    def get_token(self) -> str:
        if self._token:
            return self._token
        return self._issue_token()

    def refresh_token(self) -> str:
        return self._issue_token()

    def _issue_token(self) -> str:
        now = time.monotonic()
        elapsed = now - self._issued_at
        if self._issued_at and elapsed < TOKEN_MIN_INTERVAL_SEC:
            wait_for = TOKEN_MIN_INTERVAL_SEC - elapsed
            print(f"Waiting {wait_for:.1f}s before requesting a new token...")
            time.sleep(wait_for)

        token_url = f"{KIS_BASE_URL}/oauth2/tokenP"
        headers = {"content-type": "application/json"}
        body = {
            "grant_type": "client_credentials",
            "appkey": APP_KEY,
            "appsecret": APP_SECRET,
        }

        response = requests.post(token_url, headers=headers, data=json.dumps(body))
        response.raise_for_status()
        data = response.json()

        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"Failed to issue token: {data}")

        self._token = token
        self._issued_at = time.monotonic()
        return token


rate_limiter = RateLimiter(API_MIN_INTERVAL_SEC)
token_manager = TokenManager()


def kis_request(path: str, headers: dict, params: dict) -> dict:
    url = f"{KIS_BASE_URL}{path}"
    for attempt in range(2):
        token = token_manager.get_token()
        req_headers = headers.copy()
        req_headers["authorization"] = f"Bearer {token}"

        rate_limiter.wait()
        response = requests.get(url, headers=req_headers, params=params)

        if response.status_code == 401:
            token_manager.refresh_token()
            continue

        data = response.json()
        if data.get("rt_cd") != "0":
            msg_cd = data.get("msg_cd")
            if msg_cd in TOKEN_ERROR_CODES and attempt == 0:
                token_manager.refresh_token()
                continue

        return data

    return {}


def fetch_stock_daily(code: str, start_date: str, end_date: str) -> list[dict]:
    headers = {
        "content-type": "application/json; charset=utf-8",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKST03010100",
    }
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
        "FID_ORG_ADJ_PRC": "0",
    }

    data = kis_request(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        headers,
        params,
    )
    return data.get("output2", []) if data.get("rt_cd") == "0" else []


def fetch_index_daily(kis_code: str, start_date: str, end_date: str) -> list[dict]:
    headers = {
        "content-type": "application/json; charset=utf-8",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKUP03500100",
    }
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": kis_code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
    }

    data = kis_request(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
        headers,
        params,
    )
    return data.get("output2", []) if data.get("rt_cd") == "0" else []


def print_stock_result(name: str, code: str, rows: list[dict]) -> None:
    print(f"\n{name} ({code})")
    if not rows:
        print("  No data returned.")
        return

    rows = sorted(rows, key=lambda x: x.get("stck_bsop_date", ""), reverse=True)
    for item in rows[:5]:
        date_str = item.get("stck_bsop_date", "")
        close_price = item.get("stck_clpr", "0")
        volume = item.get("acml_vol", "0")
        trading_value = item.get("acml_tr_pbmn", "0")
        print(f"  {date_str}: close={close_price} vol={volume} value={trading_value}")


def print_index_result(name: str, code: str, rows: list[dict]) -> None:
    print(f"\n{name} ({code})")
    if not rows:
        print("  No data returned.")
        return

    rows = sorted(rows, key=lambda x: x.get("stck_bsop_date", ""), reverse=True)
    for item in rows[:5]:
        date_str = item.get("stck_bsop_date", "")
        close_price = item.get("bstp_nmix_prpr", "0")
        print(f"  {date_str}: close={close_price}")


def main() -> None:
    print("Testing KIS data fetch (no uploads)...")
    start_date = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")
    end_date = datetime.now().strftime("%Y%m%d")

    stocks = [
        ("Samsung Electronics", "005930"),
        ("SK Hynix", "000660"),
    ]
    indices = [
        ("KOSPI", "0001"),
        ("KOSDAQ", "1001"),
    ]

    for name, code in stocks:
        rows = fetch_stock_daily(code, start_date, end_date)
        print_stock_result(name, code, rows)

    for name, code in indices:
        rows = fetch_index_daily(code, start_date, end_date)
        print_index_result(name, code, rows)


if __name__ == "__main__":
    main()
