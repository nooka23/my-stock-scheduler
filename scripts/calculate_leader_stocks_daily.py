import os
import time
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import pandas as pd
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


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def fetch_latest_date(supabase: Client, table: str) -> Optional[date]:
    response = execute_with_retry(
        lambda: supabase.table(table)
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute(),
        f"fetch_latest_date:{table}",
    )
    if not response.data:
        return None
    return parse_date(response.data[0]["date"])


def fetch_prev_trading_date(supabase: Client, target_date: date) -> Optional[date]:
    response = execute_with_retry(
        lambda: supabase.table("daily_prices_v2")
        .select("date")
        .lt("date", target_date.isoformat())
        .order("date", desc=True)
        .limit(1)
        .execute(),
        "fetch_prev_trading_date",
    )
    if not response.data:
        return None
    return parse_date(response.data[0]["date"])


def fetch_table_rows_by_date(
    supabase: Client, table: str, columns: str, target_date: date
) -> List[dict]:
    rows: List[dict] = []
    offset = 0
    page_size = 1000
    while True:
        response = execute_with_retry(
            lambda: supabase.table(table)
            .select(columns)
            .eq("date", target_date.isoformat())
            .range(offset, offset + page_size - 1)
            .execute(),
            f"fetch_rows:{table}:{target_date}",
        )
        if not response.data:
            break
        rows.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
    return rows


def chunk_list(items: List[str], size: int) -> List[List[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_daily_rows_for_codes(
    supabase: Client,
    codes: List[str],
    target_date: date,
    columns: str,
) -> List[dict]:
    rows: List[dict] = []
    page_size = 1000
    for batch in chunk_list(codes, 200):
        offset = 0
        while True:
            response = execute_with_retry(
                lambda: supabase.table("daily_prices_v2")
                .select(columns)
                .eq("date", target_date.isoformat())
                .in_("code", batch)
                .range(offset, offset + page_size - 1)
                .execute(),
                f"fetch_daily_rows:{target_date}",
            )
            if not response.data:
                break
            rows.extend(response.data)
            if len(response.data) < page_size:
                break
            offset += page_size
    return rows


def upsert_leader_rows(supabase: Client, rows: List[dict]) -> None:
    if not rows:
        return
    for batch in chunk_list(rows, 500):
        response = execute_with_retry(
            lambda: supabase.table("leader_stocks_daily")
            .upsert(batch, on_conflict="date,code")
            .execute(),
            "upsert_leader_rows",
        )
        if response.data is None and response.error:
            raise RuntimeError(response.error.message)


def main() -> None:
    load_env()
    supabase = get_supabase_client()

    target_env = os.environ.get("TARGET_DATE")
    if target_env:
        target_date = parse_date(target_env)
    else:
        latest_price_date = fetch_latest_date(supabase, "daily_prices_v2")
        latest_rs_date = fetch_latest_date(supabase, "rs_rankings_v2")

        if not latest_price_date or not latest_rs_date:
            print("[ERROR] Missing latest dates from required tables.")
            return

        target_date = min(latest_price_date, latest_rs_date)

    prev_date = fetch_prev_trading_date(supabase, target_date)
    if not prev_date:
        print("[ERROR] No previous trading date found.")
        return

    print(f"[INFO] Leader calculation target date: {target_date} (prev: {prev_date})")

    rs_rows = fetch_table_rows_by_date(
        supabase,
        "rs_rankings_v2",
        "code, rank_weighted",
        target_date,
    )

    if not rs_rows:
        print("[ERROR] No RS data for target date.")
        return

    rs_map: Dict[str, int] = {}
    for row in rs_rows:
        code = row.get("code")
        if not code:
            continue
        rank_rs = row.get("rank_weighted")
        if rank_rs is None:
            continue
        rs_map[code] = int(rank_rs)

    codes = sorted(set(rs_map.keys()))
    if not codes:
        print("[ERROR] No RS codes for target date.")
        return

    today_rows = fetch_daily_rows_for_codes(
        supabase, codes, target_date, "code, close, trading_value"
    )
    prev_rows = fetch_daily_rows_for_codes(
        supabase, codes, prev_date, "code, close"
    )

    if not today_rows or not prev_rows:
        print("[ERROR] Missing daily price rows for target or prev date.")
        return

    today_map: Dict[str, dict] = {row["code"]: row for row in today_rows if row.get("code")}
    prev_close: Dict[str, float] = {
        row["code"]: float(row["close"])
        for row in prev_rows
        if row.get("code") and row.get("close") is not None
    }

    rows: List[dict] = []
    for code in codes:
        today = today_map.get(code)
        if not today:
            continue
        close_today = today.get("close")
        close_prev = prev_close.get(code)
        trading_value = today.get("trading_value")
        if close_today is None or close_prev is None or close_prev == 0:
            continue
        if trading_value is None:
            continue
        ret_1d = (float(close_today) / close_prev - 1.0) * 100
        rows.append(
            {
                "code": code,
                "ret_1d": ret_1d,
                "trading_value": float(trading_value),
                "rank_rs": rs_map.get(code),
            }
        )

    if not rows:
        print("[ERROR] No rows with valid returns.")
        return

    df = pd.DataFrame(rows)
    df = df[df["rank_rs"].notna()].copy()
    df["rank_rs"] = df["rank_rs"].astype(int)
    tv_top200 = set(
        df.sort_values("trading_value", ascending=False).head(200)["code"].tolist()
    )
    rs_top500 = set(
        df.sort_values("rank_rs", ascending=False).head(500)["code"].tolist()
    )
    target_codes = tv_top200 & rs_top500
    df = df[df["code"].isin(target_codes)].copy()
    if df.empty:
        print("[ERROR] No rows after intersection filter.")
        return
    df["ret_rank"] = (
        df["ret_1d"].rank(pct=True).fillna(0).round().astype(int).clip(1, 99)
    )
    df["rank_trading_value"] = (
        df["trading_value"].rank(pct=True).fillna(0).round().astype(int).clip(1, 99)
    )

    weight_rs = float(os.environ.get("LEADER_WEIGHT_RS", "0.2"))
    weight_tv = float(os.environ.get("LEADER_WEIGHT_TV", "0.4"))
    weight_ret = float(os.environ.get("LEADER_WEIGHT_RET", "0.4"))

    df["leader_score"] = (
        (df["rank_rs"] * weight_rs)
        + (df["rank_trading_value"] * weight_tv)
        + (df["ret_rank"] * weight_ret)
    )

    df = df.fillna(0)
    upload_list = []
    for _, row in df.iterrows():
        upload_list.append(
            {
                "date": target_date.isoformat(),
                "code": row["code"],
                "leader_score": float(row["leader_score"]),
                "trading_value": float(row["trading_value"]),
                "ret_1d": float(row["ret_1d"]),
                "ret_rank": int(row["ret_rank"]),
                "rank_amount_60": int(row["rank_trading_value"]),
                "rank_rs": int(row["rank_rs"]),
            }
        )

    upsert_leader_rows(supabase, upload_list)
    print(f"[DONE] Leader rows upserted: {len(upload_list)}")


if __name__ == "__main__":
    main()
