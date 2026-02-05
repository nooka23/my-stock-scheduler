import os
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import time

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


def execute_with_retry(callable_fn, label: str, retries: int = 5, delay: float = 1.0):
    attempt = 0
    while True:
        try:
            return callable_fn()
        except Exception as exc:
            attempt += 1
            if attempt > retries:
                raise
            wait = delay * (2 ** (attempt - 1))
            print(f"[WARN] {label} failed ({exc}), retrying in {wait:.1f}s...")
            time.sleep(wait)


def fetch_latest_trading_date(supabase: Client) -> Optional[date]:
    response = execute_with_retry(
        lambda: supabase.table("daily_prices_v2")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute(),
        "fetch_latest_trading_date",
    )
    if not response.data:
        return None
    return datetime.strptime(response.data[0]["date"], "%Y-%m-%d").date()


def fetch_group_names(
    supabase: Client, group: str
) -> Dict[str, str]:
    table = "industries" if group == "industry" else "themes"
    names: Dict[str, str] = {}
    offset = 0
    page_size = 1000
    while True:
        response = execute_with_retry(
            lambda: supabase.table(table)
            .select("code, name")
            .order("code")
            .range(offset, offset + page_size - 1)
            .execute(),
            f"fetch_group_names:{group}",
        )
        if not response.data:
            break
        for row in response.data:
            names[row["code"]] = row["name"]
        if len(response.data) < page_size:
            break
        offset += page_size
    return names


def fetch_index_codes(
    supabase: Client, group: str, base_date: date
) -> List[str]:
    codes: List[str] = []
    offset = 0
    page_size = 1000
    while True:
        response = execute_with_retry(
            lambda: supabase.table("index_constituents_monthly")
            .select("index_code")
            .eq("index_type", group)
            .gte("rebalance_date", base_date.isoformat())
            .order("index_code")
            .range(offset, offset + page_size - 1)
            .execute(),
            f"fetch_index_codes:{group}",
        )
        if not response.data:
            break
        codes.extend([row["index_code"] for row in response.data])
        if len(response.data) < page_size:
            break
        offset += page_size
    return sorted(set(codes))


def fetch_rebalance_dates_for_index(
    supabase: Client, index_type: str, index_code: str, base_date: date
) -> List[date]:
    dates: List[date] = []
    offset = 0
    page_size = 1000
    while True:
        response = execute_with_retry(
            lambda: supabase.table("index_constituents_monthly")
            .select("rebalance_date")
            .eq("index_type", index_type)
            .eq("index_code", index_code)
            .gte("rebalance_date", base_date.isoformat())
            .order("rebalance_date")
            .range(offset, offset + page_size - 1)
            .execute(),
            f"fetch_rebalance_dates:{index_type}:{index_code}",
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
        response = execute_with_retry(
            lambda: supabase.table("index_constituents_monthly")
            .select("code")
            .eq("index_type", index_type)
            .eq("index_code", index_code)
            .eq("rebalance_date", rebalance_date.isoformat())
            .order("code")
            .range(offset, offset + page_size - 1)
            .execute(),
            f"fetch_constituent_codes:{index_type}:{index_code}:{rebalance_date}",
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
            response = execute_with_retry(
                lambda: supabase.table("daily_prices_v2")
                .select("code, date, close")
                .in_("code", batch)
                .gte("date", start_date.isoformat())
                .lt("date", end_date.isoformat())
                .order("date")
                .range(offset, offset + page_size - 1)
                .execute(),
                "fetch_prices",
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
    for series in by_code.values():
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
        response = execute_with_retry(
            lambda: supabase.table("equal_weight_indices")
            .upsert(batch, on_conflict="index_type,index_code,date")
            .execute(),
            "upsert_index_rows",
        )
        if response.data is None and response.error:
            raise RuntimeError(response.error.message)


def build_index_series(
    supabase: Client,
    index_type: str,
    index_code: str,
    index_name: str,
    rebalance_dates: List[date],
    base_date: date,
    latest_date: date,
) -> None:
    current_index = 100.0
    first_index_date: Optional[date] = None
    buffer_rows: List[dict] = []

    for i, rebalance_date in enumerate(rebalance_dates):
        period_start = max(rebalance_date, base_date)
        if i + 1 >= len(rebalance_dates):
            period_end = latest_date + timedelta(days=1)
        else:
            period_end = rebalance_dates[i + 1]

        codes = fetch_constituent_codes(
            supabase, index_type, index_code, rebalance_date
        )
        if not codes:
            continue

        prev_date = max(period_start - timedelta(days=7), base_date)
        rows = fetch_prices(supabase, codes, prev_date, period_end)
        if not rows:
            continue

        avg_returns = compute_daily_avg_returns(rows, period_start, period_end)
        if not avg_returns:
            continue

        for d in sorted(avg_returns.keys()):
            avg_ret, cnt = avg_returns[d]
            if first_index_date is None:
                first_index_date = d
                index_value = current_index
            else:
                current_index *= (1.0 + avg_ret)
                index_value = current_index
            buffer_rows.append(
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

        if len(buffer_rows) >= 5000:
            upsert_index_rows(supabase, buffer_rows)
            buffer_rows = []

    if buffer_rows:
        upsert_index_rows(supabase, buffer_rows)


def main() -> None:
    load_env()
    supabase = get_supabase_client()

    base_date = datetime.strptime(
        os.environ.get("INDEX_BASE_DATE", "2024-01-01"), "%Y-%m-%d"
    ).date()

    latest_date = fetch_latest_trading_date(supabase)
    if not latest_date:
        print("[ERROR] No trading dates found.")
        return

    start_group = os.environ.get("START_GROUP")
    start_code = os.environ.get("START_CODE")
    passed_start = start_group is None and start_code is None

    for group in ["industry", "theme"]:
        if start_group and group != start_group and not passed_start:
            continue
        if start_group == group:
            passed_start = True
        print(f"[INFO] Building indices for {group}...")
        group_names = fetch_group_names(supabase, group)
        index_codes = fetch_index_codes(supabase, group, base_date)
        print(f"[INFO] {group} indices: {len(index_codes)}")

        for i, index_code in enumerate(index_codes, start=1):
            if start_code and not passed_start:
                if index_code != start_code:
                    continue
                passed_start = True
            index_name = group_names.get(index_code, index_code)
            rebalance_dates = fetch_rebalance_dates_for_index(
                supabase, group, index_code, base_date
            )
            if not rebalance_dates:
                continue
            print(f"[{group} {i}/{len(index_codes)}] {index_code}...")
            try:
                build_index_series(
                    supabase,
                    index_type=group,
                    index_code=index_code,
                    index_name=index_name,
                    rebalance_dates=rebalance_dates,
                    base_date=base_date,
                    latest_date=latest_date,
                )
            except Exception as exc:
                print(f"[ERROR] {group}:{index_code} failed: {exc}")
                continue

    print("[DONE] Group indices updated.")


if __name__ == "__main__":
    main()
