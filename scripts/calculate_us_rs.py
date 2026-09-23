"""Calculate daily RS rankings for the separate US common-stock universe."""

from __future__ import annotations

import argparse
import os
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv(".env.local")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
SOURCE = "KIS_OVERSEAS_DAILYPRICE"
PIPELINE_KEY = "us_equity_rs"
CALCULATION_VERSION = "weighted_3_6_9_12m_v1"


def parse_target_date(value: str | None) -> date:
    if value:
        return date.fromisoformat(value)
    return datetime.now(ZoneInfo("Asia/Seoul")).date() - timedelta(days=1)


def load_active_tickers(db: Client) -> set[str]:
    tickers: set[str] = set()
    offset = 0
    while True:
        rows = (
            db.schema("market_data")
            .table("us_equity_universe")
            .select("ticker")
            .eq("is_active", True)
            .eq("security_type", "CS")
            .eq("is_etf", False)
            .order("ticker")
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        tickers.update(str(row["ticker"]).upper() for row in rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return tickers


def load_prices(db: Client, start: date, end: date, tickers: set[str]) -> pd.DataFrame:
    rows: list[dict] = []
    window_start = start
    while window_start <= end:
        window_end = min(window_start + timedelta(days=30), end)
        offset = 0
        while True:
            page = (
                db.schema("market_data")
                .table("us_daily_prices")
                .select("ticker,trade_date,close")
                .eq("source", SOURCE)
                .gte("trade_date", str(window_start))
                .lte("trade_date", str(window_end))
                .order("trade_date")
                .order("ticker")
                .range(offset, offset + 9999)
                .execute()
                .data
                or []
            )
            rows.extend(row for row in page if str(row["ticker"]).upper() in tickers)
            if len(page) < 10000:
                break
            offset += len(page)
        print(f"loaded {window_start}..{window_end}: total_rows={len(rows)}", flush=True)
        window_start = window_end + timedelta(days=1)

    if not rows:
        raise RuntimeError("No KIS US prices found for the RS input window")
    frame = pd.DataFrame(rows)
    frame["ticker"] = frame["ticker"].astype(str).str.upper()
    frame["date"] = pd.to_datetime(frame["trade_date"])
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame = frame.dropna(subset=["close"]).sort_values(["ticker", "date"])
    return frame[["ticker", "date", "close"]]


def percentile_rank(series: pd.Series) -> pd.Series:
    return (series.rank(pct=True) * 99).fillna(0).round().astype(int).clip(1, 99)


def calculate(frame: pd.DataFrame, target: date) -> pd.DataFrame:
    grouped = frame.groupby("ticker")["close"]
    frame["ret_3m"] = grouped.pct_change(63)
    frame["ret_6m"] = grouped.pct_change(126)
    frame["ret_12m"] = grouped.pct_change(252)

    now = frame["close"]
    p3 = grouped.shift(63).replace(0, np.nan)
    p6 = grouped.shift(126).replace(0, np.nan)
    p9 = grouped.shift(189).replace(0, np.nan)
    p12 = grouped.shift(252).replace(0, np.nan)
    frame["score_weighted"] = (
        0.4 * ((now - p3) / p3)
        + 0.2 * ((p3 - p6) / p6)
        + 0.2 * ((p6 - p9) / p9)
        + 0.2 * ((p9 - p12) / p12)
    )

    today = frame[frame["date"] == pd.Timestamp(target)].copy()
    if today.empty:
        raise RuntimeError(f"No KIS US prices found for target date {target}")
    today["rank_weighted"] = percentile_rank(today["score_weighted"])
    today["rank_3m"] = percentile_rank(today["ret_3m"])
    today["rank_6m"] = percentile_rank(today["ret_6m"])
    today["rank_12m"] = percentile_rank(today["ret_12m"])
    today = today.replace({np.nan: 0})
    return today


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-date")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Missing Supabase environment variables")

    target = parse_target_date(args.target_date)
    start = target - timedelta(days=400)
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    tickers = load_active_tickers(db)
    if not tickers:
        raise RuntimeError("US common-stock universe is empty")
    frame = load_prices(db, start, target, tickers)
    today = calculate(frame, target)
    print(f"RS target={target}: {len(today)} tickers", flush=True)
    if args.dry_run:
        return 0

    run_id = (
        db.schema("market_data")
        .table("data_ingestion_runs")
        .insert(
            {
                "pipeline_key": PIPELINE_KEY,
                "source": SOURCE,
                "status": "RUNNING",
                "metadata": {
                    "target_date": str(target),
                    "input_start_date": str(start),
                    "universe_count": len(tickers),
                    "result_count": len(today),
                    "calculation_version": CALCULATION_VERSION,
                },
            }
        )
        .execute()
        .data[0]["id"]
    )
    try:
        rows = []
        for _, row in today.iterrows():
            rows.append(
                {
                    "date": str(target),
                    "ticker": row["ticker"],
                    "score_weighted": float(row["score_weighted"]),
                    "rank_weighted": int(row["rank_weighted"]),
                    "score_3m": float(row["ret_3m"]),
                    "rank_3m": int(row["rank_3m"]),
                    "score_6m": float(row["ret_6m"]),
                    "rank_6m": int(row["rank_6m"]),
                    "score_12m": float(row["ret_12m"]),
                    "rank_12m": int(row["rank_12m"]),
                    "calculation_version": CALCULATION_VERSION,
                }
            )
        db.schema("market_data").table("us_equity_rs_rankings").delete().eq("date", str(target)).execute()
        for offset in range(0, len(rows), 1000):
            db.schema("market_data").table("us_equity_rs_rankings").upsert(
                rows[offset : offset + 1000], on_conflict="date,ticker"
            ).execute()
        db.schema("market_data").table("data_ingestion_runs").update(
            {
                "status": "SUCCEEDED",
                "completed_at": datetime.now(ZoneInfo("UTC")).isoformat(),
                "rows_read": len(frame),
                "rows_written": len(rows),
                "metadata": {
                    "target_date": str(target),
                    "input_start_date": str(start),
                    "universe_count": len(tickers),
                    "result_count": len(rows),
                    "calculation_version": CALCULATION_VERSION,
                },
            }
        ).eq("id", run_id).execute()
        print(f"RS saved: {len(rows)} rows for {target}", flush=True)
        return 0
    except Exception as exc:
        db.schema("market_data").table("data_ingestion_runs").update(
            {
                "status": "FAILED",
                "completed_at": datetime.now(ZoneInfo("UTC")).isoformat(),
                "error_message": str(exc),
            }
        ).eq("id", run_id).execute()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
