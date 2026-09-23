"""Collect US daily market data from KIS into the market_data schema.

This job intentionally starts with daily OHLCV for the enabled US equity
universe. It is safe to re-run: rows are upserted by instrument/date/source
and each run is recorded in data_ingestion_runs. KIS credentials are read
from the app's .env.local and are never logged.

Examples:
    python scripts/collect_us_market_data.py --dry-run --limit 2
    python scripts/collect_us_market_data.py --lookback-days 45
    python scripts/collect_us_market_data.py --validate-only
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import Client, create_client

from kis_token_cache import KisTokenManager


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(REPO_ROOT, ".env.local"))

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
KIS_APP_KEY = os.environ.get("KIS_APP_KEY")
KIS_APP_SECRET = os.environ.get("KIS_APP_SECRET")

KIS_BASE_URL = "https://openapi.koreainvestment.com:9443"
KIS_DAILY_PATH = "/uapi/overseas-price/v1/quotations/dailyprice"
KIS_DAILY_TR_ID = "HHDFS76240000"
KIS_DAILY_CHART_PATH = "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice"
KIS_DAILY_CHART_TR_ID = "FHKST03030100"
SOURCE = "KIS_OVERSEAS_DAILYPRICE"
PIPELINE_KEY = "us_market_daily_prices"

CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 20
API_MIN_INTERVAL_SECONDS = 0.12
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
TOKEN_ERROR_CODES = {"EGW00123", "EGW00124", "EGW00125"}


class KisApiError(RuntimeError):
    """An actionable KIS API error without exposing credentials."""


class RateLimiter:
    def __init__(self, interval_seconds: float) -> None:
        self.interval_seconds = interval_seconds
        self.last_call = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self.last_call
        if elapsed < self.interval_seconds:
            time.sleep(self.interval_seconds - elapsed)
        self.last_call = time.monotonic()


class KisClient:
    def __init__(self, app_key: str, app_secret: str) -> None:
        self.app_key = app_key
        self.app_secret = app_secret
        self.session = requests.Session()
        self.rate_limiter = RateLimiter(API_MIN_INTERVAL_SECONDS)
        self.token_manager = KisTokenManager(
            app_key,
            app_secret,
            session=self.session,
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        )
        self.token: str | None = None
        self.request_count = 0

    def _issue_token(self) -> str:
        try:
            self.token = self.token_manager.get_token()
            return self.token
        except Exception as exc:
            raise KisApiError(str(exc)) from exc

    def _get_token(self, force_refresh: bool = False) -> str:
        if force_refresh or not self.token:
            try:
                self.token = self.token_manager.get_token(force_refresh=force_refresh)
                return self.token
            except Exception as exc:
                raise KisApiError(str(exc)) from exc
        return self.token

    def get_daily_page(self, excd: str, symb: str, bymd: str) -> tuple[dict[str, Any], dict[str, str]]:
        """Fetch one KIS daily-price page ending at ``bymd``."""

        params = {
            "AUTH": "",
            "EXCD": excd,
            "SYMB": symb,
            "GUBN": "0",  # day
            "BYMD": bymd,
            "MODP": "0",  # unadjusted/standard KIS response mode
        }

        for attempt in range(3):
            token = self._get_token(force_refresh=attempt > 0 and self.token is None)
            headers = {
                "content-type": "application/json; charset=utf-8",
                "authorization": f"Bearer {token}",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
                "tr_id": KIS_DAILY_TR_ID,
            }
            self.rate_limiter.wait()
            try:
                response = self.session.get(
                    f"{KIS_BASE_URL}{KIS_DAILY_PATH}",
                    headers=headers,
                    params=params,
                    timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
                )
            except requests.RequestException as exc:
                if attempt == 2:
                    raise KisApiError(f"KIS request failed for {symb}: {exc}") from exc
                time.sleep(2**attempt)
                continue

            self.request_count += 1
            if response.status_code == 401:
                self.token = None
                continue
            if response.status_code in RETRYABLE_STATUS_CODES:
                if attempt == 2:
                    raise KisApiError(
                        f"KIS HTTP {response.status_code} for {symb}"
                    )
                time.sleep(2**attempt)
                continue

            response.raise_for_status()
            payload = response.json()
            if payload.get("rt_cd") != "0":
                msg_cd = payload.get("msg_cd", "unknown")
                msg = payload.get("msg1", "no message")
                if msg_cd in TOKEN_ERROR_CODES and attempt < 2:
                    self.token = None
                    continue
                raise KisApiError(f"KIS rejected {symb}: {msg_cd} {msg}")
            return payload, {str(k).lower(): str(v) for k, v in response.headers.items()}

        raise KisApiError(f"KIS request exhausted retries for {symb}")

    def get_daily_chart_page(
        self,
        market_code: str,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> dict[str, Any]:
        """Fetch daily index, rate, FX, or commodity chart data from KIS."""

        params = {
            "FID_COND_MRKT_DIV_CODE": market_code,
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start_date,
            "FID_INPUT_DATE_2": end_date,
            "FID_PERIOD_DIV_CODE": "D",
        }

        for attempt in range(3):
            token = self._get_token(force_refresh=attempt > 0 and self.token is None)
            headers = {
                "content-type": "application/json; charset=utf-8",
                "authorization": f"Bearer {token}",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
                "tr_id": KIS_DAILY_CHART_TR_ID,
            }
            self.rate_limiter.wait()
            try:
                response = self.session.get(
                    f"{KIS_BASE_URL}{KIS_DAILY_CHART_PATH}",
                    headers=headers,
                    params=params,
                    timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
                )
            except requests.RequestException as exc:
                if attempt == 2:
                    raise KisApiError(f"KIS chart request failed for {symbol}: {exc}") from exc
                time.sleep(2**attempt)
                continue

            self.request_count += 1
            if response.status_code == 401:
                self.token = None
                continue
            if response.status_code in RETRYABLE_STATUS_CODES:
                if attempt == 2:
                    raise KisApiError(f"KIS chart HTTP {response.status_code} for {symbol}")
                time.sleep(2**attempt)
                continue

            response.raise_for_status()
            payload = response.json()
            if payload.get("rt_cd") != "0":
                msg_cd = payload.get("msg_cd", "unknown")
                msg = payload.get("msg1", "no message")
                if msg_cd in TOKEN_ERROR_CODES and attempt < 2:
                    self.token = None
                    continue
                raise KisApiError(f"KIS chart rejected {symbol}: {msg_cd} {msg}")
            return payload

        raise KisApiError(f"KIS chart request exhausted retries for {symbol}")

    def get_ranking_page(
        self,
        path: str,
        tr_id: str,
        params: dict[str, str],
        tr_cont: str = "",
    ) -> tuple[dict[str, Any], dict[str, str]]:
        """Fetch one KIS overseas-ranking page with continuation support."""

        for attempt in range(3):
            token = self._get_token(force_refresh=attempt > 0 and self.token is None)
            headers = {
                "content-type": "application/json; charset=utf-8",
                "authorization": f"Bearer {token}",
                "appkey": self.app_key,
                "appsecret": self.app_secret,
                "tr_id": tr_id,
                "custtype": "P",
            }
            if tr_cont:
                headers["tr_cont"] = tr_cont
            self.rate_limiter.wait()
            try:
                response = self.session.get(
                    f"{KIS_BASE_URL}{path}",
                    headers=headers,
                    params=params,
                    timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
                )
            except requests.RequestException as exc:
                if attempt == 2:
                    raise KisApiError(f"KIS ranking request failed for {path}: {exc}") from exc
                time.sleep(2**attempt)
                continue

            self.request_count += 1
            if response.status_code == 401:
                self.token = None
                continue
            if response.status_code in RETRYABLE_STATUS_CODES:
                if attempt == 2:
                    raise KisApiError(f"KIS ranking HTTP {response.status_code} for {path}")
                time.sleep(2**attempt)
                continue

            response.raise_for_status()
            payload = response.json()
            if payload.get("rt_cd") != "0":
                msg_cd = payload.get("msg_cd", "unknown")
                msg = payload.get("msg1", "no message")
                if msg_cd in TOKEN_ERROR_CODES and attempt < 2:
                    self.token = None
                    continue
                raise KisApiError(f"KIS ranking rejected {path}: {msg_cd} {msg}")
            return payload, {str(k).lower(): str(v) for k, v in response.headers.items()}

        raise KisApiError(f"KIS ranking request exhausted retries for {path}")


def require_environment() -> None:
    missing = [
        name
        for name, value in {
            "NEXT_PUBLIC_SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
            "KIS_APP_KEY": KIS_APP_KEY,
            "KIS_APP_SECRET": KIS_APP_SECRET,
        }.items()
        if not value
    ]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")


def as_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "--", "N/A", "null"}:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_trade_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return datetime.strptime(text, "%Y%m%d").date()
    except ValueError:
        return None


def get_exchange_code(instrument: dict[str, Any]) -> str:
    provider_params = instrument.get("provider_params") or {}
    configured = str(provider_params.get("excd") or "").strip().upper()
    if configured:
        return configured

    exchange = str(instrument.get("exchange") or "").strip().upper()
    fallback = {"NASDAQ": "NAS", "NYSE": "NYS", "AMEX": "AMS"}
    if exchange in fallback:
        return fallback[exchange]
    raise KisApiError(
        f"No KIS EXCD configured for {instrument.get('internal_code', 'unknown')}"
    )


def fetch_daily_history(
    client: KisClient,
    instrument: dict[str, Any],
    start_date: date,
    end_date: date,
) -> tuple[list[dict[str, Any]], int]:
    """Fetch and normalize all daily rows in the requested date range."""

    symbol = str(instrument.get("provider_symbol") or "").strip()
    if not symbol:
        raise KisApiError(f"No KIS symbol configured for {instrument.get('internal_code')}")
    exchange_code = get_exchange_code(instrument)

    cursor = end_date
    collected: dict[date, dict[str, Any]] = {}
    page_count = 0
    # KIS returns at most 100 rows per page. The cursor moves to the day before
    # the oldest returned row, so weekends and market holidays are harmless.
    max_pages = max(2, math.ceil((end_date - start_date).days / 70) + 2)

    while cursor >= start_date and page_count < max_pages:
        payload, _headers = client.get_daily_page(
            exchange_code, symbol, cursor.strftime("%Y%m%d")
        )
        page_count += 1
        rows = payload.get("output2") or []
        if isinstance(rows, dict):
            rows = [rows]

        parsed_dates: list[date] = []
        for raw in rows:
            trade_date = parse_trade_date(raw.get("xymd"))
            if not trade_date:
                continue
            parsed_dates.append(trade_date)
            if start_date <= trade_date <= end_date:
                collected[trade_date] = raw

        if not parsed_dates:
            break
        oldest = min(parsed_dates)
        if oldest >= cursor:
            # Protect against a provider response that ignores BYMD.
            break
        cursor = oldest - timedelta(days=1)

    normalized: list[dict[str, Any]] = []
    for trade_date, raw in sorted(collected.items()):
        normalized.append(
            {
                "instrument_id": instrument["id"],
                "trade_date": trade_date.isoformat(),
                "open": as_number(raw.get("open")),
                "high": as_number(raw.get("high")),
                "low": as_number(raw.get("low")),
                "close": as_number(raw.get("clos")),
                "volume": as_number(raw.get("tvol")),
                "trading_value": as_number(raw.get("tamt")),
                "currency": instrument.get("currency") or "USD",
                "source": SOURCE,
                "source_updated_at": None,
                "raw_payload": raw,
            }
        )
    return normalized, len(collected)


def load_enabled_instruments(supabase: Client, limit: int | None) -> list[dict[str, Any]]:
    query = (
        supabase.schema("market_data")
        .table("market_instruments")
        .select(
            "id,internal_code,display_name,asset_class,exchange,currency,provider,"
            "provider_symbol,provider_params,display_order"
        )
        .eq("provider", "KIS")
        .eq("asset_class", "EQUITY")
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
        table.upsert(
            chunk, on_conflict="instrument_id,trade_date,source"
        ).execute()
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
        help="Last calendar date to request, YYYY-MM-DD (default: today).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N enabled instruments.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Call KIS and print results without writing prices or run logs.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Call KIS for each selected symbol but never write market data.",
    )
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
        print("No enabled KIS US equity instruments found.")
        return 1

    start_date = args.end_date - timedelta(days=args.lookback_days)
    client = KisClient(KIS_APP_KEY, KIS_APP_SECRET)
    run_id: str | None = None
    rows_read = 0
    rows_written = 0
    successful = 0
    failures: list[dict[str, str]] = []
    all_rows: list[dict[str, Any]] = []

    metadata: dict[str, Any] = {
        "lookback_days": args.lookback_days,
        "start_date": start_date.isoformat(),
        "end_date": args.end_date.isoformat(),
        "instrument_count": len(instruments),
        "dry_run": args.dry_run or args.validate_only,
    }
    if not args.dry_run and not args.validate_only:
        run_id = insert_run(supabase, metadata)

    try:
        for instrument in instruments:
            label = f"{instrument['internal_code']} ({instrument['provider_symbol']})"
            try:
                rows, raw_count = fetch_daily_history(
                    client, instrument, start_date, args.end_date
                )
                if not rows:
                    raise KisApiError(
                        "KIS returned no daily rows; verify the provider symbol and EXCD."
                    )
                rows_read += raw_count
                all_rows.extend(rows)
                successful += 1
                newest = rows[-1]["trade_date"] if rows else "none"
                oldest = rows[0]["trade_date"] if rows else "none"
                print(f"OK {label}: {len(rows)} rows ({oldest} .. {newest})")
            except Exception as exc:  # keep other symbols flowing
                failures.append({"instrument": label, "error": str(exc)})
                print(f"ERROR {label}: {exc}", file=sys.stderr)

        if not (args.dry_run or args.validate_only):
            rows_written = upsert_rows(supabase, all_rows)

        if args.dry_run or args.validate_only:
            if all_rows:
                sample = all_rows[-1]
                print(
                    "Sample: "
                    f"{sample['trade_date']} close={sample['close']} "
                    f"volume={sample['volume']}"
                )

        status = "SUCCEEDED" if not failures else ("PARTIAL" if successful else "FAILED")
        metadata.update(
            {
                "successful_instruments": successful,
                "failed_instruments": failures,
                "kis_request_count": client.request_count,
            }
        )
        if run_id:
            finish_run(
                supabase,
                run_id,
                status,
                rows_read,
                rows_written,
                "; ".join(f"{f['instrument']}: {f['error']}" for f in failures) or None,
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
