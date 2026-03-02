import argparse
import json
import os
import sys
import time

import requests
from dotenv import load_dotenv


load_dotenv(".env.local")

APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not APP_KEY or not APP_SECRET:
    print("ERROR: Missing KIS_APP_KEY or KIS_APP_SECRET in .env.local.")
    sys.exit(1)

KIS_BASE_URL = "https://openapi.koreainvestment.com:9443"
TOKEN_MIN_INTERVAL_SEC = 300
TOKEN_ERROR_CODES = {"EGW00123", "EGW00124", "EGW00125"}


class TokenManager:
    def __init__(self) -> None:
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

        response = requests.post(
            f"{KIS_BASE_URL}/oauth2/tokenP",
            headers={"content-type": "application/json"},
            data=json.dumps(
                {
                    "grant_type": "client_credentials",
                    "appkey": APP_KEY,
                    "appsecret": APP_SECRET,
                }
            ),
        )
        response.raise_for_status()
        data = response.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"Failed to issue token: {data}")

        self._token = token
        self._issued_at = time.monotonic()
        return token


token_manager = TokenManager()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect KIS daily item chart response fields for one stock and one date."
    )
    parser.add_argument("--code", default="005930", help="6-digit KIS stock code")
    parser.add_argument("--date", default="2026-02-27", help="YYYY-MM-DD")
    return parser.parse_args()


def kis_request(path: str, headers: dict, params: dict) -> dict:
    for attempt in range(2):
        token = token_manager.get_token()
        request_headers = headers.copy()
        request_headers["authorization"] = f"Bearer {token}"

        response = requests.get(f"{KIS_BASE_URL}{path}", headers=request_headers, params=params)
        if response.status_code == 401:
            token_manager.refresh_token()
            continue

        data = response.json()
        if data.get("rt_cd") != "0":
            if data.get("msg_cd") in TOKEN_ERROR_CODES and attempt == 0:
                token_manager.refresh_token()
                continue
        return data

    return {}


def main() -> None:
    args = parse_args()
    target_date = args.date.replace("-", "")

    headers = {
        "content-type": "application/json; charset=utf-8",
        "appkey": APP_KEY,
        "appsecret": APP_SECRET,
        "tr_id": "FHKST03010100",
    }
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": args.code,
        "FID_INPUT_DATE_1": target_date,
        "FID_INPUT_DATE_2": target_date,
        "FID_PERIOD_DIV_CODE": "D",
        "FID_ORG_ADJ_PRC": "0",
    }

    data = kis_request(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        headers,
        params,
    )

    print("rt_cd:", data.get("rt_cd"))
    print("msg_cd:", data.get("msg_cd"))
    print("msg1:", data.get("msg1"))

    rows = data.get("output2") or []
    print("row_count:", len(rows))
    if not rows:
        return

    row = rows[0]
    print("keys:")
    for key in sorted(row.keys()):
        print(key)

    print("\nsample_row:")
    for key in sorted(row.keys()):
        print(f"{key}: {row[key]}")


if __name__ == "__main__":
    main()
