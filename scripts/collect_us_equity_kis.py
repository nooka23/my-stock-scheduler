"""KIS collection for the separate US common-stock universe."""
import argparse
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from supabase import create_client
from collect_us_market_data import KisClient, KIS_APP_KEY, KIS_APP_SECRET
from collect_us_equity_massive import (
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, as_number, finish_run,
    is_likely_common_stock, upsert_prices,
)

SOURCE = "KIS_OVERSEAS_DAILYPRICE"
EXCHANGES = {"XNAS": "NAS", "XNYS": "NYS", "XASE": "AMS"}
KIS_PAGE_SIZE = 100


def parse_date_arg(value: str, option_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{option_name} must use YYYY-MM-DD format") from exc


def fetch_ticker_rows(
    client: KisClient,
    ticker: str,
    exchange: str,
    start: date,
    end: date,
) -> tuple[list[dict], int]:
    """Fetch every KIS 100-row page needed for the requested date range."""

    by_date: dict[str, dict] = {}
    cursor = end
    pages = 0
    while cursor >= start:
        payload, _ = client.get_daily_page(exchange, ticker.replace(".", "/"), cursor.strftime("%Y%m%d"))
        pages += 1
        raw_rows = payload.get("output2") or []
        if not raw_rows:
            break

        parsed_dates: list[date] = []
        for raw in raw_rows:
            try:
                trade_date = datetime.strptime(raw["xymd"], "%Y%m%d").date()
            except (KeyError, TypeError, ValueError):
                continue
            parsed_dates.append(trade_date)
            if not start <= trade_date <= end:
                continue
            close = as_number(raw.get("clos"))
            if close is None or close <= 0:
                continue
            by_date[str(trade_date)] = {
                "ticker": ticker,
                "trade_date": str(trade_date),
                "source": SOURCE,
                "open": as_number(raw.get("open")),
                "high": as_number(raw.get("high")),
                "low": as_number(raw.get("low")),
                "close": close,
                "volume": as_number(raw.get("tvol")),
                "trading_value": as_number(raw.get("tamt")),
                "change_pct": as_number(raw.get("rate")),
                "currency": "USD",
                "raw_payload": raw,
            }

        oldest = min(parsed_dates) if parsed_dates else None
        if oldest is None or oldest <= start or len(raw_rows) < KIS_PAGE_SIZE:
            break
        next_cursor = oldest - timedelta(days=1)
        if next_cursor >= cursor:
            raise RuntimeError(f"KIS pagination did not move backward for {ticker}")
        cursor = next_cursor

    return [by_date[key] for key in sorted(by_date)], pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--tickers", nargs="+", help="Optional exact universe tickers for targeted repair")
    parser.add_argument("--start-date", help="Inclusive YYYY-MM-DD start date; enables historical pagination")
    parser.add_argument("--end-date", help="Inclusive YYYY-MM-DD end date")
    parser.add_argument("--lookback-days", type=int, help="Inclusive calendar-day range ending at end date")
    args = parser.parse_args()
    if not all((KIS_APP_KEY, KIS_APP_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)):
        raise RuntimeError("Missing KIS or Supabase configuration")
    # The LaunchAgent runs at 06:10 KST. The prior Korean calendar date is
    # the intended US session date in both EDT and EST; KIS returns the last
    # available rows when that date was a US holiday.
    default_end = datetime.now(ZoneInfo("Asia/Seoul")).date() - timedelta(days=1)
    end = parse_date_arg(args.end_date, "--end-date") if args.end_date else default_end
    if args.start_date:
        start = parse_date_arg(args.start_date, "--start-date")
    else:
        lookback_days = args.lookback_days or 7
        if lookback_days < 1:
            raise ValueError("--lookback-days must be positive")
        start = end - timedelta(days=lookback_days - 1)
    if start > end:
        raise ValueError("start date must not be after end date")
    db = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    universe = []
    excluded_tickers = []
    offset = 0
    while True:
        page = db.schema("market_data").table("us_equity_universe").select(
            "ticker,primary_exchange,company_name"
        ).eq("is_active", True).eq("security_type", "CS").eq("is_etf", False).order(
            "ticker"
        ).range(offset, offset + 999).execute().data or []
        for row in page:
            if is_likely_common_stock({"name": row.get("company_name") or ""}):
                universe.append(row)
            else:
                excluded_tickers.append(row["ticker"])
        if len(page) < 1000:
            break
        offset += 1000
    if excluded_tickers and not args.dry_run:
        for offset in range(0, len(excluded_tickers), 500):
            db.schema("market_data").table("us_equity_universe").update(
                {"is_active": False}
            ).in_("ticker", excluded_tickers[offset : offset + 500]).execute()
    if args.tickers:
        selected = {ticker.upper() for ticker in args.tickers}
        universe = [row for row in universe if row["ticker"] in selected]
    if args.limit:
        universe = universe[:args.limit]
    if not universe:
        raise RuntimeError("US common-stock universe is empty")
    metadata = {"start_date": str(start), "end_date": str(end), "universe_count": len(universe)}
    run_id = None
    if not args.dry_run:
        run_id = db.schema("market_data").table("data_ingestion_runs").insert({
            "pipeline_key": "us_equity_kis_morning", "source": SOURCE,
            "status": "RUNNING", "metadata": metadata,
        }).execute().data[0]["id"]
    client = KisClient(KIS_APP_KEY, KIS_APP_SECRET)
    written = read = latest = pages_read = 0
    failures = []
    pending = []
    missing_latest = []
    try:
        for index, stock in enumerate(universe, 1):
            ticker = stock["ticker"]
            try:
                rows, ticker_pages = fetch_ticker_rows(
                    client,
                    ticker,
                    EXCHANGES[stock["primary_exchange"]],
                    start,
                    end,
                )
                pages_read += ticker_pages
                if not rows:
                    raise RuntimeError("No prices in requested date range")
                read += len(rows)
                has_latest = any(r["trade_date"] == str(end) for r in rows)
                latest += int(has_latest)
                if not has_latest:
                    missing_latest.append(ticker)
                if not args.dry_run:
                    pending.extend(rows)
            except Exception as exc:
                failures.append({"ticker": ticker, "error": str(exc)[:200]})
            # Batch database writes while respecting KIS's per-request limiter.
            # A failed database write fails the run instead of losing its buffer.
            if pending and (len(pending) >= 500 or index == len(universe)):
                written += upsert_prices(db, pending)
                pending.clear()
            if index % 100 == 0 or index == len(universe):
                print(f"{index}/{len(universe)}: rows={written}, latest={latest}, failed={len(failures)}", flush=True)
        metadata.update(
            latest_date_tickers=latest,
            failures=failures,
            missing_latest=missing_latest,
            pages_read=pages_read,
        )
        status = "SUCCEEDED" if not failures and latest == len(universe) else ("PARTIAL" if read else "FAILED")
        if run_id:
            finish_run(db, run_id, status, read, written,
                       f"{len(failures)} ticker failures; {latest} tickers for {end}" if status != "SUCCEEDED" else None, metadata)
        print(f"Completed {end}: {status}; rows={written}, latest={latest}", flush=True)
        return 0 if status == "SUCCEEDED" else 2
    except Exception as exc:
        if run_id:
            finish_run(db, run_id, "FAILED", read, written, str(exc), metadata)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
