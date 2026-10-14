"""Collect KIS-verified US/global index, rate, and FX daily data.

Only instruments explicitly enabled in market_data.market_instruments are
loaded. This avoids silently substituting values for unsupported series such as
US 2Y, DXY, Russell 2000, and commodities that have not yet passed a live KIS
API verification.

Examples:
    python scripts/collect_global_market_data.py --dry-run
    python scripts/collect_global_market_data.py --lookback-days 45
"""

from __future__ import annotations

import argparse
import math
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from supabase import Client, create_client

from collect_us_market_data import (
    KIS_APP_KEY,
    KIS_APP_SECRET,
    KisApiError,
    KisClient,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
    as_number,
    parse_trade_date,
    require_environment,
)


from daily_review_kis_instruments import EXTRA_INSTRUMENTS, DERIVED_SOURCE

SOURCE = "KIS_OVERSEAS_DAILY_CHARTPRICE"
PIPELINE_KEY = "global_market_daily_chart_prices"
VERIFIED_CODES = [
    "US_INDEX_SP500", "US_INDEX_NASDAQ", "US_INDEX_DOW", "US_INDEX_SOX",
    "US_INDEX_VIX", "US_RATE_10Y", "FX_USDKRW", "FX_USDJPY",
]
VERIFIED_CODES += [item[0] for item in EXTRA_INSTRUMENTS]
ASSET_CLASSES = ["INDEX", "RATE", "FX", "COMMODITY", "FUTURE"]


def get_market_code(instrument: dict[str, Any]) -> str:
    provider_params = instrument.get("provider_params") or {}
    market_code = str(provider_params.get("fid_cond_mrkt_div_code") or "").strip()
    if not market_code:
        raise KisApiError(
            "No FID_COND_MRKT_DIV_CODE configured for "
            f"{instrument.get('internal_code', 'unknown')}"
        )
    return market_code


def fetch_daily_chart_history(
    client: KisClient,
    instrument: dict[str, Any],
    start_date: date,
    end_date: date,
) -> tuple[list[dict[str, Any]], int]:
    """Fetch date-bounded daily chart rows in API-safe calendar chunks."""

    symbol = str(instrument.get("provider_symbol") or "").strip()
    if not symbol:
        raise KisApiError(f"No KIS symbol configured for {instrument.get('internal_code')}")

    market_code = get_market_code(instrument)
    cursor = start_date
    collected: dict[date, dict[str, Any]] = {}
    while cursor <= end_date:
        chunk_end = min(cursor + timedelta(days=90), end_date)
        payload = client.get_daily_chart_page(
            market_code,
            symbol,
            cursor.strftime("%Y%m%d"),
            chunk_end.strftime("%Y%m%d"),
        )
        rows = payload.get("output2") or []
        if isinstance(rows, dict):
            rows = [rows]

        for raw in rows:
            trade_date = parse_trade_date(raw.get("stck_bsop_date"))
            if trade_date and start_date <= trade_date <= end_date:
                collected[trade_date] = raw
        cursor = chunk_end + timedelta(days=1)

    normalized: list[dict[str, Any]] = []
    for trade_date, raw in sorted(collected.items()):
        close = as_number(raw.get("ovrs_nmix_prpr"))
        if close is None or not math.isfinite(close):
            raise KisApiError(f"Invalid close for {instrument['internal_code']} on {trade_date}")
        normalized.append(
            {
                "instrument_id": instrument["id"],
                "trade_date": trade_date.isoformat(),
                "open": as_number(raw.get("ovrs_nmix_oprc")),
                "high": as_number(raw.get("ovrs_nmix_hgpr")),
                "low": as_number(raw.get("ovrs_nmix_lwpr")),
                "close": close,
                "volume": as_number(raw.get("acml_vol")),
                "trading_value": None,
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
        .in_("internal_code", VERIFIED_CODES)
        .in_("asset_class", ASSET_CLASSES)
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
        default=datetime.now(ZoneInfo("Asia/Seoul")).date() - timedelta(days=1),
        help="Last calendar date to request, YYYY-MM-DD (default: previous Korean date).",
    )
    parser.add_argument("--limit", type=int, default=None)
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
        print("No enabled KIS global market instruments found.")
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
    client = KisClient(KIS_APP_KEY, KIS_APP_SECRET)
    rows_read = 0
    rows_written = 0
    all_rows: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    successful = 0

    try:
        for instrument in instruments:
            label = f"{instrument['internal_code']} ({instrument['provider_symbol']})"
            try:
                rows, raw_count = fetch_daily_chart_history(
                    client, instrument, start_date, args.end_date
                )
                if not rows:
                    raise KisApiError(
                        "KIS returned no daily rows; keep this instrument disabled."
                    )
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

        # Derived close only: matching dates do not imply simultaneous FX fixes.
        ids = {i['internal_code']: i['id'] for i in instruments}
        if 'FX_USDKRW' in ids and 'FX_USDCNY' in ids:
            try:
                target = supabase.schema('market_data').table('market_instruments').select('id').eq('internal_code', 'FX_CNYKRW').eq('is_enabled', True).maybe_single().execute().data
                if not target:
                    raise KisApiError('FX_CNYKRW configuration missing')
                krw = {r['trade_date']: r for r in all_rows if r['instrument_id'] == ids['FX_USDKRW']}
                cny = {r['trade_date']: r for r in all_rows if r['instrument_id'] == ids['FX_USDCNY']}
                derived = [dict(instrument_id=target['id'], trade_date=day,
                                open=None, high=None, low=None, close=krw[day]['close']/cny[day]['close'],
                                volume=None, trading_value=None, currency='KRW', source=DERIVED_SOURCE,
                                raw_payload={'formula': 'USD/KRW / USD/CNY', 'usdkrw': krw[day]['close'], 'usdcny': cny[day]['close'], 'note': 'same date; fixing times may differ'})
                           for day in sorted(krw.keys() & cny.keys()) if cny[day]['close'] > 0]
                if not derived:
                    raise KisApiError('No matching observation dates for CNY/KRW')
                all_rows.extend(derived)
                metadata['derived_rows'] = len(derived)
                print(f"OK FX_CNYKRW (derived): {len(derived)} rows")
            except Exception as exc:
                failures.append({'instrument': 'FX_CNYKRW', 'error': str(exc)})
        if not args.dry_run:
            rows_written = upsert_rows(supabase, all_rows)

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
        return 0 if not failures else 2
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
