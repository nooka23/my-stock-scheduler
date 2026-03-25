"""
Export all available DART account IDs per company (no numeric amounts).

This script:
1. Loads DART + Supabase env from .env.local or .env
2. Loads companies from Supabase
3. Calls fnlttSinglAcntAll.json (CFS/OFS configurable)
4. Collects account_id/account_nm/sj_nm metadata only
5. Writes Excel workbook for system design

No database writes are performed.
"""

from __future__ import annotations

import argparse
import io
import os
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv
from supabase import Client, create_client

DART_API_BASE = "https://opendart.fss.or.kr/api"
REPORT_CODE_BY_QUARTER = {
    1: "11013",
    2: "11012",
    3: "11014",
    4: "11011",
}
DEFAULT_MARKETS = ("KOSPI", "KOSDAQ")
PREFERRED_SUFFIXES = ("우", "우B", "우C", "우(전환)", "우선주")


def load_env() -> tuple[str, Client]:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    env_path = os.path.join(project_root, ".env.local")
    if not os.path.exists(env_path):
        env_path = os.path.join(project_root, ".env")

    load_dotenv(dotenv_path=env_path)

    dart_api_key = os.environ.get("DART_API_KEY")
    if not dart_api_key:
        raise RuntimeError("DART_API_KEY was not found in .env.local or .env.")

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Supabase env was not found in .env.local or .env.")

    return dart_api_key, create_client(url, key)


def ensure_excel_engine() -> None:
    try:
        import openpyxl  # noqa: F401
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "openpyxl is required to write Excel files. "
            "Install it with `python3 -m pip install openpyxl`."
        ) from exc


def get_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(f"{DART_API_BASE}/{path}", params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def get_corp_map(api_key: str) -> dict[str, dict[str, str]]:
    response = requests.get(
        f"{DART_API_BASE}/corpCode.xml",
        params={"crtfc_key": api_key},
        timeout=60,
    )
    response.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        xml_content = archive.read("CORPCODE.xml")

    root = ET.fromstring(xml_content)
    mapping: dict[str, dict[str, str]] = {}
    for item in root.findall("list"):
        stock_code = (item.findtext("stock_code") or "").strip()
        if not stock_code:
            continue
        mapping[stock_code] = {
            "corp_code": (item.findtext("corp_code") or "").strip(),
            "corp_name": (item.findtext("corp_name") or "").strip(),
        }
    return mapping


def is_preferred_name(name: str) -> bool:
    return (name or "").strip().endswith(PREFERRED_SUFFIXES)


def should_exclude_name(
    name: str,
    include_etf: bool,
    include_spac: bool,
    include_preferred: bool,
) -> bool:
    upper_name = (name or "").upper()
    if not include_etf and ("ETF" in upper_name or "ETN" in upper_name):
        return True
    if not include_spac and "스팩" in (name or ""):
        return True
    if not include_preferred and is_preferred_name(name or ""):
        return True
    return False


def get_companies(
    supabase: Client,
    codes: list[str] | None,
    markets: list[str],
    include_etf: bool,
    include_spac: bool,
    include_preferred: bool,
) -> list[dict[str, str]]:
    query = supabase.table("companies").select("code, name, market").order("code")
    if codes:
        query = query.in_("code", codes)
    elif markets:
        query = query.in_("market", markets)

    rows = query.execute().data or []
    if codes:
        return rows

    filtered = []
    for row in rows:
        if should_exclude_name(
            row.get("name") or "",
            include_etf=include_etf,
            include_spac=include_spac,
            include_preferred=include_preferred,
        ):
            continue
        filtered.append(row)
    return filtered


def fetch_financial_rows(
    api_key: str,
    corp_code: str,
    year: int,
    quarter: int,
    fs_div: str,
) -> tuple[list[dict[str, Any]], str | None]:
    payload = get_json(
        "fnlttSinglAcntAll.json",
        {
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": REPORT_CODE_BY_QUARTER[quarter],
            "fs_div": fs_div,
        },
    )
    if payload.get("status") == "000":
        return payload.get("list", []), None

    return [], f"{payload.get('status')} {payload.get('message')}"


def unique_account_rows(
    code: str,
    name: str,
    corp_code: str,
    corp_name: str,
    year: int,
    quarter: int,
    fs_div: str,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        account_id = (row.get("account_id") or "").strip()
        if not account_id:
            continue
        account_nm = (row.get("account_nm") or "").strip()
        sj_nm = (row.get("sj_nm") or "").strip()
        account_detail = (row.get("account_detail") or "").strip()
        currency = (row.get("currency") or "").strip()
        key = (account_id, account_nm, sj_nm, account_detail, currency)
        if key in unique:
            continue
        unique[key] = {
            "code": code,
            "name": name,
            "corp_code": corp_code,
            "corp_name": corp_name,
            "year": year,
            "quarter": quarter,
            "fs_div": fs_div,
            "account_id": account_id,
            "account_nm": account_nm,
            "sj_nm": sj_nm,
            "account_detail": account_detail,
            "currency": currency,
        }
    return list(unique.values())


def write_sheet_or_message(
    writer: pd.ExcelWriter,
    sheet_name: str,
    rows: list[dict[str, Any]],
    empty_message: str,
) -> None:
    if rows:
        pd.DataFrame(rows).to_excel(writer, sheet_name=sheet_name, index=False)
    else:
        pd.DataFrame({"message": [empty_message]}).to_excel(writer, sheet_name=sheet_name, index=False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export DART account IDs for all companies.")
    parser.add_argument("--year", type=int, default=2025, help="business year")
    parser.add_argument("--quarter", type=int, choices=(1, 2, 3, 4), default=3, help="report quarter")
    parser.add_argument("--api-limit", type=int, default=9500, help="max API calls")
    parser.add_argument("--sleep", type=float, default=0.2, help="sleep seconds between API calls")
    parser.add_argument("--max-companies", type=int, default=None, help="optional cap for quick run")
    parser.add_argument("--codes", nargs="*", default=None, help="optional explicit stock codes")
    parser.add_argument(
        "--markets",
        nargs="*",
        default=list(DEFAULT_MARKETS),
        help="markets to include when --codes is not set",
    )
    parser.add_argument("--include-etf", action="store_true", help="include ETF/ETN names")
    parser.add_argument("--include-spac", action="store_true", help="include SPAC names")
    parser.add_argument("--include-preferred", action="store_true", help="include preferred-share names")
    parser.add_argument(
        "--fs-div-mode",
        choices=("all", "cfs", "ofs"),
        default="all",
        help="all: fetch both CFS and OFS, cfs/ofs: fetch one only",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    ensure_excel_engine()

    api_key, supabase = load_env()
    corp_map = get_corp_map(api_key)
    companies = get_companies(
        supabase,
        args.codes,
        args.markets,
        args.include_etf,
        args.include_spac,
        args.include_preferred,
    )
    if args.max_companies:
        companies = companies[: args.max_companies]

    if args.fs_div_mode == "all":
        fs_div_targets = ["CFS", "OFS"]
    elif args.fs_div_mode == "cfs":
        fs_div_targets = ["CFS"]
    else:
        fs_div_targets = ["OFS"]

    print(f"Target companies: {len(companies)}")
    print(f"Year/Quarter: {args.year} Q{args.quarter}")
    print(f"FS mode: {args.fs_div_mode}")
    print(f"API limit: {args.api_limit}")

    account_rows: list[dict[str, Any]] = []
    no_mapping: list[dict[str, Any]] = []
    no_data: list[dict[str, Any]] = []
    api_errors: list[dict[str, Any]] = []
    api_calls = 0
    api_limit_reached = False

    for index, company in enumerate(companies, start=1):
        code = company["code"]
        name = company["name"]
        print(f"[{index}/{len(companies)}] {name}({code})", end=" ")

        corp_info = corp_map.get(code)
        if not corp_info:
            print("-> no DART mapping")
            no_mapping.append({"code": code, "name": name})
            continue

        collected_this_company: list[dict[str, Any]] = []
        company_errors: list[str] = []

        for fs_div in fs_div_targets:
            if api_calls >= args.api_limit:
                api_limit_reached = True
                break
            api_calls += 1
            try:
                rows, err = fetch_financial_rows(
                    api_key,
                    corp_info["corp_code"],
                    args.year,
                    args.quarter,
                    fs_div,
                )
                if rows:
                    collected_this_company.extend(
                        unique_account_rows(
                            code=code,
                            name=name,
                            corp_code=corp_info["corp_code"],
                            corp_name=corp_info["corp_name"],
                            year=args.year,
                            quarter=args.quarter,
                            fs_div=fs_div,
                            rows=rows,
                        )
                    )
                elif err:
                    company_errors.append(f"{fs_div}: {err}")
            except Exception as exc:
                company_errors.append(f"{fs_div}: {exc}")

            time.sleep(args.sleep)

        if api_limit_reached:
            print("-> stopped by API limit")
            no_data.append(
                {
                    "code": code,
                    "name": name,
                    "reason": "API limit reached before full fs_div fetch",
                }
            )
            for remaining in companies[index:]:
                no_data.append(
                    {
                        "code": remaining["code"],
                        "name": remaining["name"],
                        "reason": "API limit reached before request",
                    }
                )
            break

        if collected_this_company:
            account_rows.extend(collected_this_company)
            unique_ids = len({row["account_id"] for row in collected_this_company})
            print(f"-> ids={unique_ids}")
        else:
            if company_errors:
                print("-> no data/error")
                api_errors.append(
                    {
                        "code": code,
                        "name": name,
                        "corp_code": corp_info["corp_code"],
                        "error": " | ".join(company_errors),
                    }
                )
            else:
                print("-> no data")
                no_data.append(
                    {
                        "code": code,
                        "name": name,
                        "corp_code": corp_info["corp_code"],
                        "reason": "No rows for target fs_div",
                    }
                )

    if account_rows:
        df_all = pd.DataFrame(account_rows)
        df_all = df_all.drop_duplicates(
            subset=[
                "code",
                "name",
                "corp_code",
                "corp_name",
                "year",
                "quarter",
                "fs_div",
                "account_id",
                "account_nm",
                "sj_nm",
                "account_detail",
                "currency",
            ]
        )
        account_rows = df_all.to_dict("records")

        company_summary = (
            df_all.groupby(["code", "name"], as_index=False)
            .agg(
                account_id_count=("account_id", "nunique"),
                fs_div_count=("fs_div", "nunique"),
            )
            .sort_values(["account_id_count", "code"], ascending=[False, True])
            .to_dict("records")
        )

        account_summary = (
            df_all.groupby(["account_id", "account_nm", "sj_nm"], as_index=False)
            .agg(
                company_count=("code", "nunique"),
                occurrence_count=("code", "size"),
            )
            .sort_values(["company_count", "occurrence_count", "account_id"], ascending=[False, False, True])
            .to_dict("records")
        )
    else:
        company_summary = []
        account_summary = []

    output_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "output",
        "dart_account_ids",
    )
    os.makedirs(output_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    excel_path = os.path.join(
        output_dir,
        f"dart_account_ids_{args.year}Q{args.quarter}_{timestamp}.xlsx",
    )

    summary_rows = [
        {"item": "target_companies", "value": len(companies)},
        {"item": "exported_account_rows", "value": len(account_rows)},
        {"item": "unique_account_ids", "value": len({r['account_id'] for r in account_rows}) if account_rows else 0},
        {"item": "no_dart_mapping", "value": len(no_mapping)},
        {"item": "no_data", "value": len(no_data)},
        {"item": "api_errors", "value": len(api_errors)},
        {"item": "api_calls", "value": api_calls},
        {"item": "api_limit_reached", "value": "yes" if api_limit_reached else "no"},
        {"item": "year", "value": args.year},
        {"item": "quarter", "value": args.quarter},
        {"item": "fs_div_mode", "value": args.fs_div_mode},
    ]

    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        pd.DataFrame(summary_rows).to_excel(writer, sheet_name="요약", index=False)
        write_sheet_or_message(writer, "계정ID_원본", account_rows, "No account IDs")
        write_sheet_or_message(writer, "계정ID_종목요약", company_summary, "No account IDs")
        write_sheet_or_message(writer, "계정ID_전체요약", account_summary, "No account IDs")
        write_sheet_or_message(writer, "DART매핑없음", no_mapping, "All companies mapped")
        write_sheet_or_message(writer, "데이터없음", no_data, "No empty-data companies")
        write_sheet_or_message(writer, "API오류", api_errors, "No API errors")

    print()
    print("=" * 80)
    print("Done")
    print(f"Excel: {excel_path}")
    print(f"Account rows: {len(account_rows)}")
    print(f"Unique account IDs: {len({r['account_id'] for r in account_rows}) if account_rows else 0}")
    print(f"No mapping: {len(no_mapping)}")
    print(f"No data: {len(no_data)}")
    print(f"API errors: {len(api_errors)}")
    print(f"API calls: {api_calls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
