import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta

import pandas as pd
import requests
from dotenv import load_dotenv


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

import kis_master_loader  # noqa: E402


load_dotenv(".env.local")

APP_KEY = os.environ.get("KIS_APP_KEY")
APP_SECRET = os.environ.get("KIS_APP_SECRET")

if not APP_KEY or not APP_SECRET:
    print("ERROR: Missing KIS_APP_KEY or KIS_APP_SECRET in .env.local.")
    sys.exit(1)

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


def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def load_cache(cache_path: str) -> dict:
    if not os.path.exists(cache_path):
        return {}
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_cache(cache_path: str, cache: dict) -> None:
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def write_dataframe(file_path: str, sheet_name: str, rows: list[dict]) -> None:
    if not rows:
        return
    df = pd.DataFrame(rows)
    df.to_excel(file_path, sheet_name=sheet_name, index=False)


def update_indices(output_dir: str, timestamp: str) -> None:
    print("\nFetching indices with KIS data...")
    start_date = (datetime.now() - timedelta(days=730)).strftime("%Y%m%d")
    end_date = datetime.now().strftime("%Y%m%d")

    indices = [
        {"kis_code": "0001", "code": "KOSPI", "name": "KOSPI"},
        {"kis_code": "1001", "code": "KOSDAQ", "name": "KOSDAQ"},
    ]

    rows = []
    for idx in indices:
        print(f"  - {idx['name']}")
        items = get_kis_index_ohlcv(idx["kis_code"], start_date, end_date)
        for item in items:
            date_str = item.get("stck_bsop_date", "")
            if not date_str:
                continue
            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
            rows.append(
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

    if rows:
        file_path = os.path.join(output_dir, f"indices_{timestamp}.xlsx")
        write_dataframe(file_path, "indices", rows)
        print(f"  Saved indices to {file_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="KIS-only update test. Writes results to Excel files."
    )
    parser.add_argument(
        "--codes",
        default="",
        help="Comma-separated stock codes to limit (default: all stocks).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Number of stock codes per Excel file.",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join("scripts", "output", "update_today_v3_excel"),
        help="Output directory for Excel files.",
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    cache_path = os.path.join(args.output_dir, "last_snapshot.json")
    cache = load_cache(cache_path)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    update_indices(args.output_dir, timestamp)

    print("\nLoading stock master from KIS...")
    stocks_df = kis_master_loader.get_all_stocks()
    if stocks_df.empty:
        print("ERROR: Failed to load stock master.")
        return

    target_stocks = stocks_df.to_dict("records")
    if args.codes:
        codes = {code.strip() for code in args.codes.split(",") if code.strip()}
        target_stocks = [s for s in target_stocks if str(s["Code"]) in codes]

    print(f"Total stocks to process: {len(target_stocks)}")

    today = datetime.now().strftime("%Y%m%d")
    check_start_date = (datetime.now() - timedelta(days=3)).strftime("%Y%m%d")
    full_start_date = "20150101"

    api_call_count = 0
    success_count = 0
    updated_count = 0

    for batch_index, batch in enumerate(chunked(target_stocks, args.batch_size), start=1):
        batch_rows = []
        for idx, stock in enumerate(batch):
            code = str(stock["Code"])
            name = stock["Name"]

            if idx % 20 == 0:
                print(
                    f"[Batch {batch_index}] {idx + 1}/{len(batch)} {name}({code}) "
                    f"(API calls: {api_call_count})"
                )

            try:
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
                cached = cache.get(code)

                if cached:
                    db_date_str = cached.get("date")
                    db_close = float(cached.get("close", 0) or 0)
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

                    for date_str, item in full_series.items():
                        normalized = normalize_kis_row(item)
                        batch_rows.append(
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

                    latest_date = max(full_series.keys())
                    latest_close = normalize_kis_row(full_series[latest_date])["close"]
                    cache[code] = {"date": latest_date, "close": latest_close}
                else:
                    if cached:
                        last_db_date = datetime.strptime(cached["date"], "%Y-%m-%d")
                        new_rows = {
                            k: v
                            for k, v in recent_by_date.items()
                            if datetime.strptime(k, "%Y-%m-%d") > last_db_date
                        }
                    else:
                        new_rows = recent_by_date

                    if not new_rows:
                        continue

                    for date_str, item in new_rows.items():
                        normalized = normalize_kis_row(item)
                        batch_rows.append(
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

                    latest_date = max(new_rows.keys())
                    latest_close = normalize_kis_row(new_rows[latest_date])["close"]
                    cache[code] = {"date": latest_date, "close": latest_close}

                success_count += 1

            except Exception as e:
                print(f"  ERROR {name}({code}): {e}")
                time.sleep(1)

        if batch_rows:
            file_path = os.path.join(
                args.output_dir, f"prices_batch_{batch_index}_{timestamp}.xlsx"
            )
            write_dataframe(file_path, "daily_prices_v2", batch_rows)
            print(f"Saved batch {batch_index} to {file_path}")

    save_cache(cache_path, cache)

    print("\nTest export complete.")
    print(f"  Success: {success_count}")
    print(f"  Full reloads: {updated_count}")
    print(f"  API calls (approx): {api_call_count}")


if __name__ == "__main__":
    main()
