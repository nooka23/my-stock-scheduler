import json
import os
import time
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv
from supabase import create_client, Client


load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase environment variables.")
    raise SystemExit(1)

if not APP_KEY or not APP_SECRET:
    print("ERROR: Missing KIS_APP_KEY or KIS_APP_SECRET in .env.local.")
    raise SystemExit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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


def kis_request(path: str, headers: dict, params: dict) -> tuple[dict, dict]:
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

        return data, response.headers

    return {}, {}


def get_kis_index_ohlcv(kis_code: str, start_date: str, end_date: str) -> list[dict]:
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

    rows_by_date = {}
    current = datetime.strptime(start_date, "%Y%m%d")
    end_dt = datetime.strptime(end_date, "%Y%m%d")

    while current <= end_dt:
        chunk_end = min(current + timedelta(days=59), end_dt)
        params["FID_INPUT_DATE_1"] = current.strftime("%Y%m%d")
        params["FID_INPUT_DATE_2"] = chunk_end.strftime("%Y%m%d")
        tr_cont = ""

        while True:
            current_headers = headers.copy()
            if tr_cont:
                current_headers["tr_cont"] = tr_cont

            data, resp_headers = kis_request(
                "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
                current_headers,
                params,
            )

            rows = data.get("output2", []) if data.get("rt_cd") == "0" else []
            for item in rows:
                date_str = item.get("stck_bsop_date")
                if date_str:
                    rows_by_date[date_str] = item

            tr_cont = resp_headers.get("tr_cont", "")
            if tr_cont not in ["M", "F"]:
                break

        current = chunk_end + timedelta(days=1)

    return list(rows_by_date.values())


def upload_rows(rows: list[dict]) -> None:
    for i in range(0, len(rows), 1000):
        chunk = rows[i : i + 1000]
        supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()


def main() -> None:
    start_date = "20240101"
    end_date = "20260116"

    indices = [
        {"kis_code": "0001", "code": "KOSPI", "name": "KOSPI"},
        {"kis_code": "1001", "code": "KOSDAQ", "name": "KOSDAQ"},
    ]

    print("Uploading index data to daily_prices_v2...")
    print(f"Range: {start_date} ~ {end_date}")

    for idx in indices:
        print(f"  - Fetching {idx['name']}...")
        rows = get_kis_index_ohlcv(idx["kis_code"], start_date, end_date)
        if not rows:
            print("    No data returned.")
            continue
        dates = sorted(
            {item.get("stck_bsop_date") for item in rows if item.get("stck_bsop_date")}
        )
        if dates:
            print(f"    Range returned: {dates[0]} ~ {dates[-1]} (unique {len(dates)})")

        upload_list = []
        for item in rows:
            date_str = item.get("stck_bsop_date", "")
            if not date_str:
                continue

            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
            upload_list.append(
                {
                    "code": idx["code"],
                    "date": formatted_date,
                    "open": float(item.get("bstp_nmix_oprc", 0) or 0),
                    "high": float(item.get("bstp_nmix_hgpr", 0) or 0),
                    "low": float(item.get("bstp_nmix_lwpr", 0) or 0),
                    "close": float(item.get("bstp_nmix_prpr", 0) or 0),
                    "volume": float(item.get("acml_vol", 0) or 0),
                    "trading_value": float(item.get("acml_tr_pbmn", 0) or 0),
                    "change": 0,
                }
            )

        upload_rows(upload_list)
        print(f"    Uploaded {len(upload_list)} rows.")

        supabase.table("companies").upsert(
            {
                "code": idx["code"],
                "name": idx["name"],
                "market": "INDEX",
                "marcap": 0,
            }
        ).execute()

    print("Done.")


if __name__ == "__main__":
    main()
