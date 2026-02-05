import os
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

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


def fetch_first_trading_date_on_or_after(
    supabase: Client, start_date: date
) -> Optional[date]:
    response = (
        supabase.table("daily_prices_v2")
        .select("date")
        .gte("date", start_date.isoformat())
        .order("date")
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return datetime.strptime(response.data[0]["date"], "%Y-%m-%d").date()


def fetch_prev_trading_date(
    supabase: Client, target_date: date
) -> Optional[date]:
    response = (
        supabase.table("daily_prices_v2")
        .select("date")
        .lt("date", target_date.isoformat())
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return datetime.strptime(response.data[0]["date"], "%Y-%m-%d").date()


def fetch_rebalance_dates(
    supabase: Client, index_type: str, index_code: str, base_date: date
) -> List[date]:
    dates: List[date] = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("index_constituents_monthly")
            .select("rebalance_date")
            .eq("index_type", index_type)
            .eq("index_code", index_code)
            .gte("rebalance_date", base_date.isoformat())
            .order("rebalance_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        for row in response.data:
            dates.append(datetime.strptime(row["rebalance_date"], "%Y-%m-%d").date())
        if len(response.data) < page_size:
            break
        offset += page_size
    return sorted(set(dates))


def fetch_constituent_codes(
    supabase: Client, index_type: str, index_code: str, rebalance_date: date
) -> List[str]:
    codes: List[str] = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("index_constituents_monthly")
            .select("code")
            .eq("index_type", index_type)
            .eq("index_code", index_code)
            .eq("rebalance_date", rebalance_date.isoformat())
            .order("code")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        codes.extend([row["code"] for row in response.data])
        if len(response.data) < page_size:
            break
        offset += page_size
    return codes


def chunk_list(items: List[str], size: int) -> List[List[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_prices(
    supabase: Client,
    codes: List[str],
    start_date: date,
    end_date: date,
) -> List[dict]:
    rows: List[dict] = []
    page_size = 1000
    for batch in chunk_list(codes, 50):
        offset = 0
        while True:
            response = (
                supabase.table("daily_prices_v2")
                .select("code, date, close")
                .in_("code", batch)
                .gte("date", start_date.isoformat())
                .lt("date", end_date.isoformat())
                .order("date")
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


def compute_daily_avg_returns(
    rows: List[dict],
    period_start: date,
    period_end: date,
) -> Dict[date, Tuple[float, int]]:
    by_code: Dict[str, List[Tuple[date, float]]] = {}
    for row in rows:
        code = row["code"]
        d = datetime.strptime(row["date"], "%Y-%m-%d").date()
        close = row.get("close")
        if close is None:
            continue
        by_code.setdefault(code, []).append((d, float(close)))

    daily_returns: Dict[date, List[float]] = {}
    for code, series in by_code.items():
        series.sort(key=lambda x: x[0])
        prev_close = None
        for d, close in series:
            if prev_close is not None and prev_close > 0:
                ret = (close / prev_close) - 1.0
                if period_start <= d < period_end:
                    daily_returns.setdefault(d, []).append(ret)
            prev_close = close

    avg_returns: Dict[date, Tuple[float, int]] = {}
    for d, rets in daily_returns.items():
        if rets:
            avg_returns[d] = (sum(rets) / len(rets), len(rets))
    return avg_returns


def upsert_index_rows(
    supabase: Client,
    rows: List[dict],
) -> None:
    if not rows:
        return
    for batch in chunk_list(rows, 500):
        response = (
            supabase.table("equal_weight_indices")
            .upsert(
                batch,
                on_conflict="index_type,index_code,date",
            )
            .execute()
        )
        if response.data is None and response.error:
            raise RuntimeError(response.error.message)


def main() -> None:
    load_env()
    supabase = get_supabase_client()

    base_date = datetime.strptime(
        os.environ.get("INDEX_BASE_DATE", "2024-01-01"), "%Y-%m-%d"
    ).date()
    index_type = os.environ.get("INDEX_TYPE", "custom")
    index_code = os.environ.get("INDEX_CODE", "EW_60D_TOP70")
    index_name = os.environ.get("INDEX_NAME", "Equal Weight 60D Top70")

    latest_date = fetch_latest_trading_date(supabase)
    if not latest_date:
        print("[ERROR] No trading dates found.")
        return

    rebalance_dates = fetch_rebalance_dates(supabase, index_type, index_code, base_date)
    if not rebalance_dates:
        print("[ERROR] No rebalance dates found in index_constituents_monthly.")
        return

    first_trade = fetch_first_trading_date_on_or_after(supabase, base_date)
    if not first_trade:
        print("[ERROR] No trading dates on or after base date.")
        return

    current_index = 100.0
    first_index_date = first_trade
    print(f"[INFO] First index date: {first_index_date}")

    all_rows: List[dict] = []

    for i, rebalance_date in enumerate(rebalance_dates):
        period_start = max(rebalance_date, base_date)
        if i + 1 >= len(rebalance_dates):
            period_end = latest_date + timedelta(days=1)
        else:
            period_end = rebalance_dates[i + 1]

        codes = fetch_constituent_codes(supabase, index_type, index_code, rebalance_date)
        if not codes:
            print(f"[WARN] {rebalance_date} has no constituents, skipping.")
            continue

        prev_date = fetch_prev_trading_date(supabase, period_start)
        fetch_start = prev_date if prev_date else period_start
        rows = fetch_prices(supabase, codes, fetch_start, period_end)
        if not rows:
            print(f"[WARN] {rebalance_date} no price rows in period.")
            continue

        avg_returns = compute_daily_avg_returns(rows, period_start, period_end)
        if not avg_returns:
            print(f"[WARN] {rebalance_date} no daily returns computed.")
            continue

        for d in sorted(avg_returns.keys()):
            avg_ret, cnt = avg_returns[d]
            if d == first_index_date:
                index_value = current_index
            else:
                current_index *= (1.0 + avg_ret)
                index_value = current_index
            all_rows.append(
                {
                    "index_type": index_type,
                    "index_code": index_code,
                    "index_name": index_name,
                    "date": d.isoformat(),
                    "index_value": index_value,
                    "constituent_count": cnt,
                    "base_date": base_date.isoformat(),
                }
            )

        if len(all_rows) >= 5000:
            upsert_index_rows(supabase, all_rows)
            all_rows = []

    if all_rows:
        upsert_index_rows(supabase, all_rows)

    print("[DONE] Index series updated.")


if __name__ == "__main__":
    main()
