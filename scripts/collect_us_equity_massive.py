"""Sync the US common-stock universe and collect daily OHLCV from Massive.

The collector is deliberately independent from the Korean stock pipeline.
The default 365-day lookback is intended for the initial backfill. Scheduled
runs should use a short lookback such as 3 days to repair weekends, holidays,
and late corrections without reloading the whole year.

Examples:
    python scripts/collect_us_equity_massive.py --dry-run --lookback-days 7
    python scripts/collect_us_equity_massive.py --lookback-days 365
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from supabase import Client, create_client


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(REPO_ROOT, ".env.local"))

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY")

MASSIVE_BASE_URL = "https://api.massive.com"
SOURCE = "MASSIVE_GROUPED_DAILY"
PIPELINE_KEY = "us_equity_daily_prices"
PROVIDER = "MASSIVE"
ALLOWED_EXCHANGES = {"XNAS", "XNYS", "XASE"}
NON_COMMON_SECURITY_NAME_RE = re.compile(
    r"\b(?:NOTES?|RIGHTS?|WARRANTS?|UNITS?|PREFERRED|DEPOSITARY|DEBENTURES?)\b",
    re.IGNORECASE,
)

CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 30
API_MAX_ATTEMPTS = 4
API_MIN_INTERVAL_SECONDS = float(
    os.environ.get("MASSIVE_API_MIN_INTERVAL_SECONDS", "12.5")
)


class MassiveApiError(RuntimeError):
    """An actionable Massive API error without exposing credentials."""


class RateLimiter:
    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self.last_call = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self.last_call
        if elapsed < self.interval_seconds:
            time.sleep(self.interval_seconds - elapsed)
        self.last_call = time.monotonic()


class MassiveClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.session = requests.Session()
        self.rate_limiter = RateLimiter(API_MIN_INTERVAL_SECONDS)
        self.request_count = 0

    def get(self, path_or_url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = path_or_url if path_or_url.startswith("http") else f"{MASSIVE_BASE_URL}{path_or_url}"
        query = dict(params or {})
        query["apiKey"] = self.api_key

        for attempt in range(API_MAX_ATTEMPTS):
            self.rate_limiter.wait()
            try:
                response = self.session.get(
                    url,
                    params=query,
                    timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
                )
            except requests.RequestException as exc:
                if attempt == API_MAX_ATTEMPTS - 1:
                    raise MassiveApiError(f"Massive request failed: {exc}") from exc
                time.sleep(2**attempt)
                continue

            self.request_count += 1
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == API_MAX_ATTEMPTS - 1:
                    raise MassiveApiError(
                        f"Massive HTTP {response.status_code}: {response.text[:200]}"
                    )
                retry_after = response.headers.get("Retry-After")
                try:
                    default_wait = 60.0 if response.status_code == 429 else 2**attempt
                    wait_seconds = max(float(retry_after or 0), default_wait)
                except ValueError:
                    wait_seconds = 60.0 if response.status_code == 429 else 2**attempt
                time.sleep(wait_seconds)
                continue

            if response.status_code >= 400:
                raise MassiveApiError(
                    f"Massive HTTP {response.status_code}: {response.text[:200]}"
                )

            payload = response.json()
            if payload.get("status") not in {None, "OK", "DELAYED"}:
                raise MassiveApiError(
                    f"Massive rejected request: {payload.get('status')}"
                )
            return payload

        raise MassiveApiError("Massive request exhausted retries")


def require_environment() -> None:
    missing = [
        name
        for name, value in {
            "NEXT_PUBLIC_SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
            "MASSIVE_API_KEY": MASSIVE_API_KEY,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")


def as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def is_likely_common_stock(item: dict[str, Any]) -> bool:
    """Keep equity shares while excluding debt, rights, units, and preferreds.

    Massive's ``type=CS`` is broader than the common-stock universe needed by
    this project and can include notes or rights. The name heuristic is a
    defensive second filter; class A/B ordinary shares remain eligible.
    """

    name = str(item.get("name") or "").strip()
    return not NON_COMMON_SECURITY_NAME_RE.search(name)


def current_us_date() -> date:
    return datetime.now(ZoneInfo("America/New_York")).date()


def latest_completed_us_date() -> date:
    """Return a date that is no longer the current US calendar date."""
    return current_us_date() - timedelta(days=1)


def normalize_next_url(next_url: str, api_key: str) -> tuple[str, dict[str, str]]:
    parsed = urlsplit(next_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.pop("apiKey", None)
    query["apiKey"] = api_key
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")), query


def fetch_common_stock_universe(client: MassiveClient) -> list[dict[str, Any]]:
    url = "/v3/reference/tickers"
    params: dict[str, Any] = {
        "market": "stocks",
        "type": "CS",
        "active": "true",
        "order": "asc",
        "limit": 1000,
        "sort": "ticker",
    }
    collected: dict[str, dict[str, Any]] = {}

    while url:
        payload = client.get(url, params)
        results = payload.get("results") or []
        if not isinstance(results, list):
            raise MassiveApiError("Massive returned an invalid ticker list")

        for item in results:
            if not isinstance(item, dict):
                continue
            ticker = str(item.get("ticker") or "").strip().upper()
            exchange = str(item.get("primary_exchange") or "").strip().upper()
            security_type = str(item.get("type") or "").strip().upper()
            market = str(item.get("market") or "").strip().lower()
            if (
                ticker
                and market == "stocks"
                and security_type == "CS"
                and exchange in ALLOWED_EXCHANGES
                and is_likely_common_stock(item)
            ):
                collected[ticker] = item

        next_url = str(payload.get("next_url") or "").strip()
        if next_url:
            url, params = normalize_next_url(next_url, client.api_key)
        else:
            url = ""

    return [collected[ticker] for ticker in sorted(collected)]


def upsert_universe(
    supabase: Client,
    universe: list[dict[str, Any]],
    as_of_date: date,
    dry_run: bool,
) -> int:
    if not universe:
        raise MassiveApiError("Massive returned no eligible US common stocks")

    rows = [
        {
            "ticker": str(item["ticker"]).upper(),
            "company_name": str(item.get("name") or item["ticker"]).strip(),
            "primary_exchange": str(item["primary_exchange"]).upper(),
            "security_type": "CS",
            "is_etf": False,
            "provider": PROVIDER,
            "provider_symbol": str(item["ticker"]).upper(),
            "is_active": True,
            "last_seen_on": as_of_date.isoformat(),
            "metadata": {
                "locale": item.get("locale"),
                "cik": item.get("cik"),
                "share_class_figi": item.get("share_class_figi"),
                "last_updated_utc": item.get("last_updated_utc"),
            },
        }
        for item in universe
    ]
    if dry_run:
        return len(rows)

    table = supabase.schema("market_data").table("us_equity_universe")
    for offset in range(0, len(rows), 500):
        table.upsert(rows[offset : offset + 500], on_conflict="ticker").execute()

    # Rows not seen in the current snapshot remain in the table for history but
    # are excluded from the next price load.
    table.update({"is_active": False}).eq("provider", PROVIDER).eq(
        "is_active", True
    ).neq("last_seen_on", as_of_date.isoformat()).execute()
    return len(rows)


def load_active_tickers(supabase: Client) -> set[str]:
    table = supabase.schema("market_data").table("us_equity_universe")
    active: set[str] = set()
    offset = 0
    page_size = 1000
    while True:
        response = (
            table.select("ticker")
            .eq("provider", PROVIDER)
            .eq("is_active", True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data or []
        active.update(str(row["ticker"]).upper() for row in rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return active


def fetch_grouped_daily(
    client: MassiveClient,
    trade_date: date,
    active_tickers: set[str],
    previous_closes: dict[str, float],
) -> list[dict[str, Any]]:
    payload = client.get(
        f"/v2/aggs/grouped/locale/us/market/stocks/{trade_date.isoformat()}",
        {"adjusted": "true", "include_otc": "false"},
    )
    results = payload.get("results") or []
    if not isinstance(results, list):
        raise MassiveApiError(f"Invalid grouped daily response for {trade_date}")

    normalized_by_ticker: dict[str, dict[str, Any]] = {}
    for raw in results:
        if not isinstance(raw, dict):
            continue
        ticker = str(raw.get("T") or "").strip().upper()
        if ticker not in active_tickers or ticker in normalized_by_ticker:
            continue
        close = as_number(raw.get("c"))
        volume = as_number(raw.get("v"))
        previous_close = previous_closes.get(ticker)
        change = close - previous_close if close is not None and previous_close is not None else None
        change_pct = (
            change / previous_close * 100
            if change is not None and previous_close
            else None
        )
        trading_value = close * volume if close is not None and volume is not None else None
        normalized_by_ticker[ticker] = {
            "ticker": ticker,
            "trade_date": trade_date.isoformat(),
            "open": as_number(raw.get("o")),
            "high": as_number(raw.get("h")),
            "low": as_number(raw.get("l")),
            "close": close,
            "volume": volume,
            "trading_value": trading_value,
            "vwap": as_number(raw.get("vw")),
            "change": change,
            "change_pct": change_pct,
            "market_cap": None,
            "currency": "USD",
            "source": SOURCE,
            "source_updated_at": None,
            "raw_payload": raw,
        }
        if close is not None:
            previous_closes[ticker] = close
    return list(normalized_by_ticker.values())


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
        raise RuntimeError("Could not create data_ingestion_runs row")
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


def upsert_prices(supabase: Client, rows: list[dict[str, Any]]) -> int:
    table = supabase.schema("market_data").table("us_daily_prices")
    written = 0
    for offset in range(0, len(rows), 500):
        chunk = rows[offset : offset + 500]
        table.upsert(chunk, on_conflict="ticker,trade_date,source").execute()
        written += len(chunk)
    return written


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=365,
        help="Calendar days to collect, default 365 for the initial backfill.",
    )
    parser.add_argument(
        "--end-date",
        type=lambda value: datetime.strptime(value, "%Y-%m-%d").date(),
        default=latest_completed_us_date(),
        help="Completed US calendar date to finish at, YYYY-MM-DD. Defaults to yesterday in New York.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.lookback_days < 1:
        raise SystemExit("--lookback-days must be at least 1")

    require_environment()
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    start_date = args.end_date - timedelta(days=args.lookback_days - 1)
    history_start = start_date - timedelta(days=10)
    client = MassiveClient(MASSIVE_API_KEY)
    run_id: str | None = None
    rows_read = 0
    rows_written = 0
    successful_days = 0
    failures: list[dict[str, str]] = []

    metadata: dict[str, Any] = {
        "start_date": start_date.isoformat(),
        "end_date": args.end_date.isoformat(),
        "history_seed_start_date": history_start.isoformat(),
        "lookback_days": args.lookback_days,
        "dry_run": args.dry_run,
        "allowed_exchanges": sorted(ALLOWED_EXCHANGES),
        "security_type": "CS",
        "exclude_etf": True,
    }

    try:
        universe = fetch_common_stock_universe(client)
        universe_count = upsert_universe(
            supabase, universe, args.end_date, args.dry_run
        )
        active_tickers = {
            str(item["ticker"]).upper() for item in universe
        } if args.dry_run else load_active_tickers(supabase)
        if not active_tickers:
            raise MassiveApiError("No active US common stocks found after universe sync")
        metadata["universe_count"] = universe_count
        metadata["active_ticker_count"] = len(active_tickers)

        if not args.dry_run:
            run_id = insert_run(supabase, metadata)

        previous_closes: dict[str, float] = {}
        cursor = history_start
        while cursor <= args.end_date:
            if cursor.weekday() >= 5:
                cursor += timedelta(days=1)
                continue
            try:
                rows = fetch_grouped_daily(
                    client, cursor, active_tickers, previous_closes
                )
                rows_read += len(rows)
                if cursor >= start_date and rows and not args.dry_run:
                    rows_written += upsert_prices(supabase, rows)
                if cursor >= start_date:
                    successful_days += 1
                print(f"OK {cursor}: {len(rows)} rows")
            except Exception as exc:
                failures.append({"trade_date": cursor.isoformat(), "error": str(exc)})
                print(f"ERROR {cursor}: {exc}", file=sys.stderr)
            cursor += timedelta(days=1)

        status = "SUCCEEDED" if not failures else ("PARTIAL" if successful_days else "FAILED")
        metadata.update(
            {
                "successful_days": successful_days,
                "failed_days": failures,
                "massive_request_count": client.request_count,
            }
        )
        if run_id:
            finish_run(
                supabase,
                run_id,
                status,
                rows_read,
                rows_written,
                "; ".join(
                    f"{item['trade_date']}: {item['error']}" for item in failures
                ) or None,
                metadata,
            )
        print(
            f"Completed: {successful_days} trading days, {rows_written} rows written, "
            f"status={status}."
        )
        return 0 if not failures else 2
    except Exception as exc:
        if run_id:
            finish_run(supabase, run_id, "FAILED", rows_read, rows_written, str(exc), metadata)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
