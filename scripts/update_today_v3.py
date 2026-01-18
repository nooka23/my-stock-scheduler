import os
import sys
import json
import time
from datetime import datetime, timedelta

import requests
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

import kis_master_loader  # noqa: E402


load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase environment variables.")
    sys.exit(1)

if not APP_KEY or not APP_SECRET:
    print("ERROR: Missing KIS environment variables.")
    print("       Please set KIS_APP_KEY and KIS_APP_SECRET in .env.local.")
    sys.exit(1)

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


def kis_request(method: str, path: str, headers: dict, params: dict | None = None) -> dict:
    url = f"{KIS_BASE_URL}{path}"
    for attempt in range(2):
        token = token_manager.get_token()
        req_headers = headers.copy()
        req_headers["authorization"] = f"Bearer {token}"

        rate_limiter.wait()
        response = requests.request(method, url, headers=req_headers, params=params)

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


def get_kis_daily_ohlcv(code: str, start_date: str, end_date: str) -> list[dict]:
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
        "GET",
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        headers,
        params,
    )
    return data.get("output2", []) if data.get("rt_cd") == "0" else []


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

    data = kis_request(
        "GET",
        "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
        headers,
        params,
    )
    return data.get("output2", []) if data.get("rt_cd") == "0" else []


def fetch_kis_daily_series(code: str, start_date: str, end_date: str) -> dict:
    current = datetime.strptime(start_date, "%Y%m%d")
    end_dt = datetime.strptime(end_date, "%Y%m%d")
    results = {}

    while current <= end_dt:
        chunk_end = min(current + timedelta(days=99), end_dt)
        rows = get_kis_daily_ohlcv(
            code,
            current.strftime("%Y%m%d"),
            chunk_end.strftime("%Y%m%d"),
        )

        for item in rows:
            date_str = item.get("stck_bsop_date")
            if not date_str:
                continue

            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
            results[formatted_date] = item

        current = chunk_end + timedelta(days=1)

    return results


def normalize_kis_row(item: dict) -> dict:
    return {
        "open": int(item.get("stck_oprc", 0) or 0),
        "high": int(item.get("stck_hgpr", 0) or 0),
        "low": int(item.get("stck_lwpr", 0) or 0),
        "close": int(item.get("stck_clpr", 0) or 0),
        "volume": int(item.get("acml_vol", 0) or 0),
        "trading_value": int(item.get("acml_tr_pbmn", 0) or 0),
    }


def update_indices() -> None:
    print("\nUpdating indices with KIS data...")

    start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")
    end_date = datetime.now().strftime("%Y%m%d")

    indices = [
        {"kis_code": "0001", "code": "KOSPI", "name": "KOSPI"},
        {"kis_code": "1001", "code": "KOSDAQ", "name": "KOSDAQ"},
    ]

    for idx in indices:
        print(f"  - Fetching {idx['name']} data...")
        rows = get_kis_index_ohlcv(idx["kis_code"], start_date, end_date)

        if not rows:
            print("    No data returned.")
            continue

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

        for i in range(0, len(upload_list), 1000):
            chunk = upload_list[i : i + 1000]
            supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()

        supabase.table("companies").upsert(
            {
                "code": idx["code"],
                "name": idx["name"],
                "market": "INDEX",
                "marcap": 0,
            }
        ).execute()

        print(f"    Uploaded {len(upload_list)} rows.")


def main() -> None:
    print("Starting update_today_v3 (KIS-only data)...")

    update_indices()

    print("\nLoading stock master from KIS...")
    stocks_df = kis_master_loader.get_all_stocks()
    if stocks_df.empty:
        print("ERROR: Failed to load stock master.")
        return

    target_stocks = stocks_df.to_dict("records")
    print(f"Total stocks: {len(target_stocks)}")

    print("Upserting companies table...")
    company_upload_list = []
    for stock in target_stocks:
        company_upload_list.append(
            {
                "code": str(stock["Code"]),
                "name": stock["Name"],
                "market": stock["Market"],
                "marcap": float(stock["Marcap"]) if not pd.isna(stock["Marcap"]) else 0,
            }
        )

    for i in range(0, len(company_upload_list), 1000):
        chunk = company_upload_list[i : i + 1000]
        supabase.table("companies").upsert(chunk).execute()

    today = datetime.now().strftime("%Y%m%d")
    check_start_date = (datetime.now() - timedelta(days=3)).strftime("%Y%m%d")
    full_start_date = "20150101"

    success_count = 0
    updated_count = 0
    api_call_count = 0

    print("Fetching latest data snapshot from DB...")
    db_latest_data = {}
    try:
        res = supabase.rpc("get_latest_prices_by_code").execute()
        if res.data:
            for row in res.data:
                db_latest_data[row["code"]] = {
                    "date": row["date"],
                    "close": float(row["close"]),
                }
        else:
            db_latest_data = None
    except Exception:
        db_latest_data = None

    for idx, stock in enumerate(target_stocks):
        code = str(stock["Code"])
        name = stock["Name"]

        if idx % 50 == 0:
            print(
                f"[{idx + 1}/{len(target_stocks)}] {name}({code}) "
                f"(API calls: {api_call_count})"
            )

        try:
            if db_latest_data is not None:
                db_last_data = db_latest_data.get(code)
            else:
                res = (
                    supabase.table("daily_prices_v2")
                    .select("date, close")
                    .eq("code", code)
                    .order("date", desc=True)
                    .limit(1)
                    .execute()
                )
                db_last_data = res.data[0] if res.data else None

            recent_rows = get_kis_daily_ohlcv(code, check_start_date, today)
            api_call_count += 1

            if not recent_rows:
                continue

            recent_by_date = {}
            for item in recent_rows:
                date_str = item.get("stck_bsop_date", "")
                if date_str:
                    formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                    recent_by_date[formatted_date] = item

            need_full_reload = False

            if db_last_data:
                db_date_str = db_last_data["date"]
                db_close = float(db_last_data["close"])
                if db_date_str in recent_by_date:
                    kis_close = float(recent_by_date[db_date_str].get("stck_clpr", 0) or 0)
                    if db_close and abs(kis_close - db_close) / db_close > 0.01:
                        print(f"  Adjustment detected for {name}({code}), reloading full data.")
                        need_full_reload = True
            else:
                need_full_reload = True

            if need_full_reload:
                updated_count += 1
                full_series = fetch_kis_daily_series(code, full_start_date, today)
                api_call_count += max(1, len(full_series) // 100)

                if not full_series:
                    continue

                upload_list = []
                for date_str, item in full_series.items():
                    normalized = normalize_kis_row(item)
                    upload_list.append(
                        {
                            "code": code,
                            "date": date_str,
                            "open": normalized["open"],
                            "high": normalized["high"],
                            "low": normalized["low"],
                            "close": normalized["close"],
                            "volume": normalized["volume"],
                            "trading_value": normalized["trading_value"],
                            "change": 0.0,
                        }
                    )

                for i in range(0, len(upload_list), 1000):
                    chunk = upload_list[i : i + 1000]
                    supabase.table("daily_prices_v2").upsert(
                        chunk, on_conflict="code, date"
                    ).execute()
            else:
                if db_last_data:
                    last_db_date = datetime.strptime(db_last_data["date"], "%Y-%m-%d")
                    new_rows = {
                        k: v
                        for k, v in recent_by_date.items()
                        if datetime.strptime(k, "%Y-%m-%d") > last_db_date
                    }
                else:
                    new_rows = recent_by_date

                if not new_rows:
                    continue

                upload_list = []
                for date_str, item in new_rows.items():
                    normalized = normalize_kis_row(item)
                    upload_list.append(
                        {
                            "code": code,
                            "date": date_str,
                            "open": normalized["open"],
                            "high": normalized["high"],
                            "low": normalized["low"],
                            "close": normalized["close"],
                            "volume": normalized["volume"],
                            "trading_value": normalized["trading_value"],
                            "change": 0.0,
                        }
                    )

                supabase.table("daily_prices_v2").upsert(
                    upload_list, on_conflict="code, date"
                ).execute()

            success_count += 1

        except Exception as e:
            print(f"  ERROR {name}({code}): {e}")
            time.sleep(1)

    print("\nUpdate complete.")
    print(f"  Success: {success_count}")
    print(f"  Full reloads: {updated_count}")
    print(f"  API calls (approx): {api_call_count}")


if __name__ == "__main__":
    main()
