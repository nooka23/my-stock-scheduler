"""Build the RS-leader WMA150 market-breadth history or refresh the latest day.

The database function performs the window calculation close to the data.  A normal
run refreshes the newest common RS/price date.  Use --backfill once after the
migration to write the full available history in manageable calendar-year chunks.
"""

import argparse
import os
from datetime import date, datetime, timedelta
from typing import Optional

from dotenv import load_dotenv
from supabase import Client, create_client


DEFAULT_CHUNK_DAYS = 365


def load_env() -> None:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(project_root, ".env.local")
    if not os.path.exists(env_path):
        env_path = os.path.join(project_root, ".env")
    load_dotenv(env_path)


def get_supabase_client() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Supabase credentials not found in .env.local/.env")
    return create_client(url, key)


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def fetch_edge_date(supabase: Client, table: str, descending: bool) -> Optional[date]:
    response = (
        supabase.table(table)
        .select("date")
        .order("date", desc=descending)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return parse_date(response.data[0]["date"])


def fetch_latest_common_date(supabase: Client) -> date:
    latest_rs = fetch_edge_date(supabase, "rs_rankings_v2", descending=True)
    latest_price = fetch_edge_date(supabase, "daily_prices_v2", descending=True)
    if not latest_rs or not latest_price:
        raise RuntimeError("RS ranking or daily price data is unavailable")
    return min(latest_rs, latest_price)


def refresh_range(supabase: Client, start_date: date, end_date: date) -> int:
    response = supabase.rpc(
        "refresh_market_breadth_daily",
        {
            "p_start_date": start_date.isoformat(),
            "p_end_date": end_date.isoformat(),
        },
    ).execute()
    if response.data is None:
        raise RuntimeError("Market-breadth refresh returned no result")
    return int(response.data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Refresh the RS top-400 stocks above WMA150 market breadth."
    )
    parser.add_argument("--start-date", help="Inclusive YYYY-MM-DD start date")
    parser.add_argument("--end-date", help="Inclusive YYYY-MM-DD end date")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Refresh all available RS history in chunks.",
    )
    parser.add_argument(
        "--chunk-days",
        type=int,
        default=DEFAULT_CHUNK_DAYS,
        help=f"Calendar days per backfill RPC call (default: {DEFAULT_CHUNK_DAYS}).",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.chunk_days < 1:
        raise SystemExit("--chunk-days must be at least 1")
    if args.backfill and (args.start_date or args.end_date):
        raise SystemExit("Use either --backfill or an explicit --start-date/--end-date range")
    if bool(args.start_date) != bool(args.end_date):
        raise SystemExit("--start-date and --end-date must be supplied together")

    load_env()
    supabase = get_supabase_client()
    latest_common = fetch_latest_common_date(supabase)

    if args.backfill:
        first_rs = fetch_edge_date(supabase, "rs_rankings_v2", descending=False)
        if not first_rs:
            raise SystemExit("No RS history is available")
        start_date = first_rs
        end_date = latest_common
    elif args.start_date and args.end_date:
        start_date = parse_date(args.start_date)
        end_date = min(parse_date(args.end_date), latest_common)
    else:
        start_date = latest_common
        end_date = latest_common

    if start_date > end_date:
        raise SystemExit("Requested range has no available RS/price data")

    current_start = start_date
    total_rows = 0
    while current_start <= end_date:
        current_end = min(
            current_start + timedelta(days=args.chunk_days - 1), end_date
        )
        inserted = refresh_range(supabase, current_start, current_end)
        total_rows += inserted
        print(
            f"[DONE] {current_start.isoformat()} ~ {current_end.isoformat()}: "
            f"{inserted} trading-day rows"
        )
        current_start = current_end + timedelta(days=1)

    print(f"[COMPLETE] Market breadth refresh: {total_rows} rows")


if __name__ == "__main__":
    main()
