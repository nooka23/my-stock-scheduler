import os
from datetime import date, datetime
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


def fetch_ew_constituents(
    supabase: Client, rebalance_date: date, index_type: str, index_code: str
) -> Dict[str, float]:
    rows: List[dict] = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("index_constituents_monthly")
            .select("code, avg_trading_value_60")
            .eq("index_type", index_type)
            .eq("index_code", index_code)
            .eq("rebalance_date", rebalance_date.isoformat())
            .order("code")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        rows.extend(response.data)
        if len(response.data) < page_size:
            break
        offset += page_size
    return {row["code"]: float(row["avg_trading_value_60"]) for row in rows}


def fetch_group_mappings(
    supabase: Client, group: str
) -> Tuple[Dict[str, str], Dict[str, List[str]]]:
    if group == "industry":
        group_table = "industries"
        map_table = "company_industries"
        id_col = "industry_id"
    else:
        group_table = "themes"
        map_table = "company_themes"
        id_col = "theme_id"

    # Load group id -> (code, name)
    id_to_code: Dict[int, str] = {}
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table(group_table)
            .select("id, code")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        for row in response.data:
            id_to_code[int(row["id"])] = row["code"]
        if len(response.data) < page_size:
            break
        offset += page_size

    # Load mappings group_id -> [company_code]
    group_to_codes: Dict[str, List[str]] = {}
    offset = 0
    while True:
        response = (
            supabase.table(map_table)
            .select(f"{id_col}, company_code")
            .order(id_col)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not response.data:
            break
        for row in response.data:
            group_id = int(row[id_col])
            group_code = id_to_code.get(group_id)
            if not group_code:
                continue
            group_to_codes.setdefault(group_code, []).append(row["company_code"])
        if len(response.data) < page_size:
            break
        offset += page_size

    return id_to_code, group_to_codes


def chunk_list(items: List[dict], size: int) -> List[List[dict]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def upsert_constituents(supabase: Client, rows: List[dict]) -> None:
    if not rows:
        return
    for batch in chunk_list(rows, 500):
        response = (
            supabase.table("index_constituents_monthly")
            .upsert(batch, on_conflict="index_type,index_code,rebalance_date,code")
            .execute()
        )
        if response.data is None and response.error:
            raise RuntimeError(response.error.message)


def build_group_rows(
    rebalance_date: date,
    group: str,
    ew_codes: Dict[str, float],
    group_to_codes: Dict[str, List[str]],
) -> List[dict]:
    out: List[dict] = []
    for group_code, codes in group_to_codes.items():
        eligible = [(c, ew_codes[c]) for c in codes if c in ew_codes]
        if not eligible:
            continue
        eligible.sort(key=lambda x: x[1], reverse=True)
        universe_count = len(eligible)
        for idx, (code, avg_tv) in enumerate(eligible, start=1):
            out.append(
                {
                    "index_type": group,
                    "index_code": group_code,
                    "rebalance_date": rebalance_date.isoformat(),
                    "code": code,
                    "avg_trading_value_60": avg_tv,
                    "rank_in_universe": idx,
                    "universe_count": universe_count,
                }
            )
    return out


def main() -> None:
    load_env()
    supabase = get_supabase_client()

    base_date = datetime.strptime(
        os.environ.get("INDEX_BASE_DATE", "2024-01-01"), "%Y-%m-%d"
    ).date()
    source_index_type = os.environ.get("SOURCE_INDEX_TYPE", "custom")
    source_index_code = os.environ.get("SOURCE_INDEX_CODE", "EW_60D_TOP70")

    rebalance_dates = fetch_rebalance_dates(
        supabase, source_index_type, source_index_code, base_date
    )
    if not rebalance_dates:
        print("[ERROR] No rebalance dates found for source index.")
        return

    for group in ["industry", "theme"]:
        print(f"[INFO] Loading mappings for {group}...")
        _, group_to_codes = fetch_group_mappings(supabase, group)
        print(f"[INFO] {group} groups: {len(group_to_codes)}")

        for i, rebalance_date in enumerate(rebalance_dates, start=1):
            print(f"[{group} {i}/{len(rebalance_dates)}] {rebalance_date}...")
            ew_codes = fetch_ew_constituents(
                supabase, rebalance_date, source_index_type, source_index_code
            )
            if not ew_codes:
                print(f"[WARN] {rebalance_date} no EW constituents.")
                continue
            rows = build_group_rows(rebalance_date, group, ew_codes, group_to_codes)
            upsert_constituents(supabase, rows)

    print("[DONE] Group constituents updated.")


if __name__ == "__main__":
    main()
