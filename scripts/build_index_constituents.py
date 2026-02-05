import os
from datetime import date, datetime, timedelta
from typing import List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client


def load_env() -> None:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    env_path = os.path.join(project_root, ".env.local")
    if not os.path.exists(env_path):
        env_path = os.path.join(project_root, ".env")
    load_dotenv(dotenv_path=env_path)


def get_supabase_client() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Supabase credentials not found in .env.local/.env")
    return create_client(url, key)


def fetch_latest_trading_date(supabase: Client) -> Optional[date]:
    response = (
        supabase.table("daily_prices_v2")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return datetime.strptime(response.data[0]["date"], "%Y-%m-%d").date()


def iter_month_starts(start_date: date, end_date: date) -> List[date]:
    months = []
    cur = date(start_date.year, start_date.month, 1)
    last = date(end_date.year, end_date.month, 1)
    while cur <= last:
        months.append(cur)
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return months


def first_trading_date_of_month(supabase: Client, month_start: date) -> Optional[date]:
    next_month = date(month_start.year + (1 if month_start.month == 12 else 0),
                      1 if month_start.month == 12 else month_start.month + 1, 1)
    response = (
        supabase.table("daily_prices_v2")
        .select("date")
        .gte("date", month_start.isoformat())
        .lt("date", next_month.isoformat())
        .order("date")
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return datetime.strptime(response.data[0]["date"], "%Y-%m-%d").date()


def fetch_last_n_trading_dates(
    supabase: Client, rebalance_date: date, n: int
) -> List[date]:
    unique_dates = []
    offset = 0
    page_size = 1000
    while len(unique_dates) < n:
        response = (
            supabase.table("daily_prices_v2")
            .select("date")
            .lte("date", rebalance_date.isoformat())
            .order("date", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        for row in response.data:
            d = datetime.strptime(row["date"], "%Y-%m-%d").date()
            if d not in unique_dates:
                unique_dates.append(d)
            if len(unique_dates) >= n:
                break
        offset += page_size
    return sorted(unique_dates)


def chunk_list(items: List[str], size: int) -> List[List[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_prices_for_dates(
    supabase: Client, dates: List[date]
) -> List[dict]:
    rows = []
    page_size = 1000
    for d in dates:
        offset = 0
        while True:
            response = (
                supabase.table("daily_prices_v2")
                .select("code, date, trading_value")
                .eq("date", d.isoformat())
                .range(offset, offset + page_size - 1)
                .execute()
            )
            if not response.data:
                break
            rows.extend(response.data)
            if len(response.data) < page_size:
                break
            offset += page_size
    return rows


def build_constituents_rows(
    supabase: Client,
    rebalance_date: date,
    index_type: str,
    index_code: str,
    top_pct: float,
) -> List[dict]:
    last_60 = fetch_last_n_trading_dates(supabase, rebalance_date, 60)
    if len(last_60) < 60:
        print(f"[WARN] {rebalance_date} has only {len(last_60)} trading days, skipping.")
        return []

    rows = fetch_prices_for_dates(supabase, last_60)
    print(f"[INFO] {rebalance_date} fetched rows: {len(rows)}")
    sums = {}
    counts = {}
    for row in rows:
        code = row["code"]
        tv = row.get("trading_value")
        if tv is None:
            continue
        sums[code] = sums.get(code, 0.0) + float(tv)
        counts[code] = counts.get(code, 0) + 1

    eligible = []
    for code, total in sums.items():
        if counts.get(code, 0) == 60:
            eligible.append((code, total / 60.0))

    if not eligible:
        print(f"[WARN] {rebalance_date} no eligible codes with 60 days.")
        return []

    eligible.sort(key=lambda x: x[1], reverse=True)
    universe_count = len(eligible)
    cutoff = int((universe_count * top_pct + 0.999999))
    selected = eligible[:cutoff]
    print(f"[INFO] {rebalance_date} eligible: {universe_count}, selected: {len(selected)}")

    out = []
    for idx, (code, avg_tv) in enumerate(selected, start=1):
        out.append(
            {
                "index_type": index_type,
                "index_code": index_code,
                "rebalance_date": rebalance_date.isoformat(),
                "code": code,
                "avg_trading_value_60": avg_tv,
                "rank_in_universe": idx,
                "universe_count": universe_count,
            }
        )
    return out


def upsert_constituents(
    supabase: Client, rows: List[dict]
) -> None:
    if not rows:
        return
    for batch in chunk_list(rows, 500):
        response = (
            supabase.table("index_constituents_monthly")
            .upsert(
                batch,
                on_conflict="index_type,index_code,rebalance_date,code",
            )
            .execute()
        )
        if response.data is None and response.error:
            raise RuntimeError(response.error.message)


def main() -> None:
    load_env()
    supabase = get_supabase_client()

    base_date = os.environ.get("INDEX_BASE_DATE", "2024-01-01")
    index_type = os.environ.get("INDEX_TYPE", "custom")
    index_code = os.environ.get("INDEX_CODE", "EW_60D_TOP70")
    top_pct = float(os.environ.get("TOP_PCT", "0.7"))

    latest_date = fetch_latest_trading_date(supabase)
    if not latest_date:
        print("[ERROR] No trading dates found.")
        return
    base_dt = datetime.strptime(base_date, "%Y-%m-%d").date()
    month_starts = iter_month_starts(base_dt, latest_date)
    rebalance_dates = []
    for ms in month_starts:
        d = first_trading_date_of_month(supabase, ms)
        if d:
            rebalance_dates.append(d)
    print(f"[INFO] Rebalance months: {len(rebalance_dates)}")

    for i, rebalance_date in enumerate(rebalance_dates, start=1):
        print(f"[{i}/{len(rebalance_dates)}] {rebalance_date.isoformat()}...")
        rows = build_constituents_rows(
            supabase,
            rebalance_date,
            index_type=index_type,
            index_code=index_code,
            top_pct=top_pct,
        )
        upsert_constituents(supabase, rows)

    print("[DONE] Constituents updated.")


if __name__ == "__main__":
    main()
