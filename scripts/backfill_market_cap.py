import argparse
import os
import sys
from collections import defaultdict
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

import kis_master_loader  # noqa: E402


load_dotenv(".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase environment variables.")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PAGE_SIZE = 1000
UPSERT_CHUNK_SIZE = 500
DEFAULT_START_DATE = "2026-01-01"
DEFAULT_END_DATE = "2026-02-28"
TARGET_MARKETS = ["KOSPI", "KOSDAQ"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill daily_prices_v2.market_cap using the current KIS master market cap snapshot."
    )
    parser.add_argument("--start-date", default=DEFAULT_START_DATE, help="YYYY-MM-DD")
    parser.add_argument("--end-date", default=DEFAULT_END_DATE, help="YYYY-MM-DD")
    return parser.parse_args()


def validate_date(date_text: str) -> str:
    return datetime.strptime(date_text, "%Y-%m-%d").strftime("%Y-%m-%d")


def fetch_target_codes() -> set[str]:
    response = (
        supabase.table("companies")
        .select("code, market")
        .in_("market", TARGET_MARKETS)
        .execute()
    )

    return {
        row["code"]
        for row in (response.data or [])
        if isinstance(row.get("code"), str) and len(row["code"]) == 6
    }


def fetch_existing_price_dates(
    start_date: str, end_date: str, target_codes: set[str]
) -> dict[str, set[str]]:
    code_dates: dict[str, set[str]] = defaultdict(set)
    offset = 0
    scanned_rows = 0

    while True:
        response = (
            supabase.table("daily_prices_v2")
            .select("code, date")
            .gte("date", start_date)
            .lte("date", end_date)
            .is_("market_cap", "null")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break

        scanned_rows += len(rows)

        for row in rows:
            code = row.get("code")
            date = row.get("date")
            if code in target_codes and isinstance(date, str):
                code_dates[code].add(date)

        if len(rows) < PAGE_SIZE:
            break

        offset += PAGE_SIZE

    print(f"  Rows with NULL market_cap in date range: {scanned_rows}")
    return code_dates


def fetch_kis_market_cap_map() -> dict[str, float]:
    stocks_df = kis_master_loader.get_all_stocks()
    if stocks_df.empty:
        return {}

    market_cap_map = {}
    for stock in stocks_df.to_dict("records"):
        code = str(stock.get("Code", ""))
        marcap = stock.get("Marcap")
        if len(code) != 6 or pd.isna(marcap):
            continue
        market_cap_map[code] = float(marcap)

    return market_cap_map


def upsert_market_caps(records: list[dict]) -> None:
    for idx in range(0, len(records), UPSERT_CHUNK_SIZE):
        chunk = records[idx : idx + UPSERT_CHUNK_SIZE]
        supabase.table("daily_prices_v2").upsert(
            chunk,
            on_conflict="code, date",
        ).execute()


def main() -> None:
    args = parse_args()
    start_date = validate_date(args.start_date)
    end_date = validate_date(args.end_date)

    if start_date > end_date:
        raise ValueError("start-date must be on or before end-date")

    print("Starting market_cap backfill...")
    print(f"  Date range: {start_date} ~ {end_date}")
    print("  Source: current KIS master snapshot")

    target_codes = fetch_target_codes()
    print(f"  Target companies: {len(target_codes)}")

    code_dates = fetch_existing_price_dates(start_date, end_date, target_codes)
    print(f"  Target codes with rows in daily_prices_v2: {len(code_dates)}")

    market_cap_map = fetch_kis_market_cap_map()
    print(f"  KIS market cap snapshot codes: {len(market_cap_map)}")

    updated_codes = 0
    updated_rows = 0

    for index, code in enumerate(sorted(code_dates.keys()), start=1):
        if index % 50 == 1:
            print(f"[{index}/{len(code_dates)}] Processing {code}...")

        target_dates = code_dates[code]

        try:
            market_cap = market_cap_map.get(code)
            if market_cap is None:
                print(f"  SKIP {code}: no KIS market cap snapshot")
                continue

            upload_list = [
                {
                    "code": code,
                    "date": date,
                    "market_cap": market_cap,
                }
                for date in sorted(target_dates)
            ]

            if not upload_list:
                print(f"  SKIP {code}: no matching daily_prices_v2 rows")
                continue

            upsert_market_caps(upload_list)
            updated_codes += 1
            updated_rows += len(upload_list)
        except Exception as exc:
            print(f"  ERROR {code}: {exc}")

    print("Backfill complete.")
    print(f"  Updated codes: {updated_codes}")
    print(f"  Updated rows: {updated_rows}")


if __name__ == "__main__":
    main()
