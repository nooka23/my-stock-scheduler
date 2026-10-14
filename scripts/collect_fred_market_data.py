"""Collect verified FRED daily market series into ``market_data``.

The active universe is configured in ``market_data.market_instruments``. This
job deliberately uses only the exact FRED series mapped there; it does not
substitute broad-dollar, ETF, or other proxy series for a requested market
indicator.

Examples:
    python scripts/collect_fred_market_data.py --dry-run
    python scripts/collect_fred_market_data.py --lookback-days 45
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(REPO_ROOT, ".env.local"))

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

FRED_GRAPH_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
SOURCE = "FRED_GRAPH_CSV"
PIPELINE_KEY = "fred_market_daily_prices"
CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 30


class FredApiError(RuntimeError):
    """An actionable FRED collection failure with no credential output."""


def require_environment() -> None:
    missing = [
        name
        for name, value in {
            "NEXT_PUBLIC_SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")


def as_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {".", "-", "--", "N/A", "null"}:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_observation_date(value: Any) -> date | None:
    text = str(value or "").strip()
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def get_series_id(instrument: dict[str, Any]) -> str:
    provider_params = instrument.get("provider_params") or {}
    series_id = str(
        provider_params.get("series_id") or instrument.get("provider_symbol") or ""
    ).strip()
    if not series_id:
        raise FredApiError(f"No FRED series_id configured for {instrument.get('internal_code')}")
    return series_id


def fetch_daily_history(
    session: requests.Session,
    instrument: dict[str, Any],
    start_date: date,
    end_date: date,
) -> tuple[list[dict[str, Any]], int]:
    """Fetch full FRED graph CSV then retain the requested calendar interval."""

    series_id = get_series_id(instrument)
    try:
        response = session.get(
            FRED_GRAPH_URL,
            params={"id": series_id, "cos": "Close"},
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise FredApiError(f"FRED request failed for {series_id}: {exc}") from exc

    reader = csv.DictReader(io.StringIO(response.text))
    if not reader.fieldnames or "observation_date" not in reader.fieldnames:
        raise FredApiError(f"FRED returned an unexpected CSV format for {series_id}")
    if series_id not in reader.fieldnames:
        raise FredApiError(f"FRED CSV has no {series_id} column")

    normalized: list[dict[str, Any]] = []
    rows_read = 0
    for raw in reader:
        observation_date = parse_observation_date(raw.get("observation_date"))
        close = as_number(raw.get(series_id))
        if not observation_date or close is None:
            continue
        if not start_date <= observation_date <= end_date:
            continue
        rows_read += 1
        normalized.append(
            {
                "instrument_id": instrument["id"],
                "trade_date": observation_date.isoformat(),
                "open": None,
                "high": None,
                "low": None,
                "close": close,
                "volume": None,
                "trading_value": None,
                "currency": instrument.get("currency") or "USD",
                "source": SOURCE,
                "source_updated_at": None,
                "raw_payload": {
                    "series_id": series_id,
                    "observation_date": observation_date.isoformat(),
                    "value": raw.get(series_id),
                },
            }
        )
    return normalized, rows_read


def load_enabled_instruments(supabase: Client, limit: int | None) -> list[dict[str, Any]]:
    query = (
        supabase.schema("market_data")
        .table("market_instruments")
        .select(
            "id,internal_code,display_name,asset_class,exchange,currency,provider,"
            "provider_symbol,provider_params,display_order"
        )
        .eq("provider", "FRED")
        .eq("is_enabled", True)
        .order("display_order")
    )
    if limit:
        query = query.limit(limit)
    response = query.execute()
    return response.data or []


def insert_run(supabase: Client, metadata: dict[str, Any]) -> str:
    response = (
        supabase.schema("market_data")
        .table("data_ingestion_runs")
        .insert(
            {
                "pipeline_key": PIPELINE_KEY,
                "source": SOURCE,
                "status": "RUNNING",
                "metadata": metadata,
            }
        )
        .execute()
    )
    if not response.data:
        raise RuntimeError("Could not create market_data.data_ingestion_runs row")
    return response.data[0]["id"]


def finish_run(
    supabase: Client,
    run_id: str,
    status: str,
    rows_read: int,
    rows_written: int,
    error_message: str | None,
    metadata: dict[str, Any],
) -> None:
    (
        supabase.schema("market_data")
        .table("data_ingestion_runs")
        .update(
            {
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "status": status,
                "rows_read": rows_read,
                "rows_written": rows_written,
                "error_message": error_message,
                "metadata": metadata,
            }
        )
        .eq("id", run_id)
        .execute()
    )


def upsert_rows(supabase: Client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    written = 0
    table = supabase.schema("market_data").table("global_daily_prices")
    for offset in range(0, len(rows), 200):
        chunk = rows[offset : offset + 200]
        table.upsert(chunk, on_conflict="instrument_id,trade_date,source").execute()
        written += len(chunk)
    return written


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=45,
        help="Calendar days of daily history to load (default: 45).",
    )
    parser.add_argument(
        "--end-date",
        type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
        default=date.today(),
        help="Last calendar date to retain, YYYY-MM-DD (default: today).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N enabled FRED instruments.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.lookback_days < 1:
        raise SystemExit("--lookback-days must be at least 1")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    require_environment()
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    instruments = load_enabled_instruments(supabase, args.limit)
    if not instruments:
        print("No enabled FRED market instruments found.")
        return 1

    start_date = args.end_date - timedelta(days=args.lookback_days)
    metadata: dict[str, Any] = {
        "lookback_days": args.lookback_days,
        "start_date": start_date.isoformat(),
        "end_date": args.end_date.isoformat(),
        "instrument_count": len(instruments),
        "dry_run": args.dry_run,
    }
    run_id = None if args.dry_run else insert_run(supabase, metadata)
    session = requests.Session()
    session.headers.update({"User-Agent": "morning-briefing-market-data/1.0"})
    rows_read = 0
    rows_written = 0
    successful = 0
    failures: list[dict[str, str]] = []
    all_rows: list[dict[str, Any]] = []

    try:
        for instrument in instruments:
            label = f"{instrument['internal_code']} ({get_series_id(instrument)})"
            try:
                rows, raw_count = fetch_daily_history(
                    session, instrument, start_date, args.end_date
                )
                if not rows:
                    raise FredApiError("FRED returned no daily observations in the requested range.")
                rows_read += raw_count
                all_rows.extend(rows)
                successful += 1
                print(
                    f"OK {label}: {len(rows)} rows "
                    f"({rows[0]['trade_date']} .. {rows[-1]['trade_date']})"
                )
            except Exception as exc:
                failures.append({"instrument": label, "error": str(exc)})
                print(f"ERROR {label}: {exc}", file=sys.stderr)

        if not args.dry_run:
            rows_written = upsert_rows(supabase, all_rows)

        status = "SUCCEEDED" if not failures else ("PARTIAL" if successful else "FAILED")
        metadata.update({"successful_instruments": successful, "failed_instruments": failures})
        if run_id:
            finish_run(
                supabase,
                run_id,
                status,
                rows_read,
                rows_written,
                "; ".join(f"{item['instrument']}: {item['error']}" for item in failures)
                or None,
                metadata,
            )
        print(
            f"Completed: {successful}/{len(instruments)} instruments, "
            f"{rows_written} rows written, status={status}."
        )
        return 0 if successful == len(instruments) else 2
    except Exception as exc:
        if run_id:
            finish_run(
                supabase,
                run_id,
                "FAILED",
                rows_read,
                rows_written,
                str(exc),
                metadata,
            )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
