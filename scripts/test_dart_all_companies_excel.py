"""
Export all-company DART financial account matching results to Excel.

This script:
1. Loads DART_API_KEY and Supabase env from .env.local or .env
2. Downloads the DART corpCode mapping
3. Fetches fnlttSinglAcntAll.json for each company for a target year/quarter
4. Evaluates shared account-map matches for each company
5. Writes an Excel workbook for manual review

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

from financials_account_map import (
    DART_CORE_ACCOUNT_MAP,
    amount_to_eok,
    collect_account_matches,
    parse_amount,
    select_preferred_account_row,
)

DART_API_BASE = "https://opendart.fss.or.kr/api"
REPORT_CODE_BY_QUARTER = {
    1: "11013",
    2: "11012",
    3: "11014",
    4: "11011",
}

DEFAULT_MARKETS = ("KOSPI", "KOSDAQ")
EXCLUDE_NAME_PATTERNS = ("ETF", "ETN", "스팩")
PREFERRED_SUFFIXES = ("우", "우B", "우C", "우(전환)", "우선주")


def load_env() -> tuple[str, Client]:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    env_path = os.path.join(project_root, ".env.local")
    if not os.path.exists(env_path):
        env_path = os.path.join(project_root, ".env")

    load_dotenv(dotenv_path=env_path)

    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        raise RuntimeError("DART_API_KEY was not found in .env.local or .env.")

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Supabase env was not found in .env.local or .env.")

    return api_key, create_client(url, key)


def ensure_excel_engine() -> None:
    try:
        import openpyxl  # noqa: F401
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "openpyxl is required to write Excel files. "
            "Install it with `python3 -m pip install openpyxl` "
            "or `python3 -m pip install -r scripts/requirements.txt`."
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
    normalized = name.strip()
    return normalized.endswith(PREFERRED_SUFFIXES)


def should_exclude_name(
    name: str,
    include_etf: bool,
    include_spac: bool,
    include_preferred: bool,
) -> bool:
    upper_name = name.upper()

    if not include_etf and ("ETF" in upper_name or "ETN" in upper_name):
        return True

    if not include_spac and "스팩" in name:
        return True

    if not include_preferred and is_preferred_name(name):
        return True

    return False


def get_companies(
    supabase: Client,
    target_codes: list[str] | None,
    markets: list[str],
    include_etf: bool,
    include_spac: bool,
    include_preferred: bool,
) -> list[dict[str, str]]:
    query = supabase.table("companies").select("code, name, market").order("code")
    if target_codes:
        query = query.in_("code", target_codes)
    elif markets:
        query = query.in_("market", markets)
    response = query.execute()
    rows = response.data or []

    if target_codes:
        return rows

    filtered = []
    for row in rows:
        name = row.get("name") or ""
        if should_exclude_name(name, include_etf, include_spac, include_preferred):
            continue
        filtered.append(row)

    return filtered


def get_financial_rows(
    api_key: str,
    corp_code: str,
    year: int,
    quarter: int,
) -> tuple[str | None, list[dict[str, Any]], str | None]:
    reprt_code = REPORT_CODE_BY_QUARTER[quarter]

    last_status = None
    last_message = None

    for fs_div in ("CFS", "OFS"):
        payload = get_json(
            "fnlttSinglAcntAll.json",
            {
                "crtfc_key": api_key,
                "corp_code": corp_code,
                "bsns_year": str(year),
                "reprt_code": reprt_code,
                "fs_div": fs_div,
            },
        )

        status = payload.get("status")
        last_status = status
        last_message = payload.get("message")
        if status == "000":
            return fs_div, payload.get("list", []), None

    if last_status and last_message:
        return None, [], f"{last_status} {last_message}"
    return None, [], "unknown DART response"


def pick_amount(row: dict[str, Any] | None) -> int | None:
    if not row:
        return None
    return (
        parse_amount(row.get("thstrm_amount"))
        or parse_amount(row.get("thstrm_add_amount"))
        or parse_amount(row.get("frmtrm_amount"))
    )


def build_company_result(
    code: str,
    name: str,
    year: int,
    quarter: int,
    corp_code: str,
    corp_name: str,
    fs_div: str,
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    summary: dict[str, Any] = {
        "code": code,
        "name": name,
        "year": year,
        "quarter": quarter,
        "corp_code": corp_code,
        "corp_name": corp_name,
        "fs_div": fs_div,
        "row_count": len(rows),
    }
    selected_rows: list[dict[str, Any]] = []
    candidate_rows: list[dict[str, Any]] = []
    missing_fields: list[str] = []

    for field in DART_CORE_ACCOUNT_MAP:
        matches = collect_account_matches(rows, field)
        preferred_row = select_preferred_account_row(rows, field)
        amount = pick_amount(preferred_row)

        summary[f"{field}_candidate_count"] = len(matches)
        summary[f"{field}_account_nm"] = preferred_row.get("account_nm") if preferred_row else None
        summary[f"{field}_sj_nm"] = preferred_row.get("sj_nm") if preferred_row else None
        summary[f"{field}_account_id"] = preferred_row.get("account_id") if preferred_row else None
        summary[f"{field}_amount"] = amount
        summary[f"{field}_amount_eok"] = amount_to_eok(amount)

        if preferred_row:
            selected_rows.append(
                {
                    "code": code,
                    "name": name,
                    "year": year,
                    "quarter": quarter,
                    "field": field,
                    "corp_code": corp_code,
                    "corp_name": corp_name,
                    "fs_div": fs_div,
                    "candidate_count": len(matches),
                    "account_nm": preferred_row.get("account_nm"),
                    "sj_nm": preferred_row.get("sj_nm"),
                    "sj_div": preferred_row.get("sj_div"),
                    "account_id": preferred_row.get("account_id"),
                    "account_detail": preferred_row.get("account_detail"),
                    "thstrm_nm": preferred_row.get("thstrm_nm"),
                    "thstrm_amount": preferred_row.get("thstrm_amount"),
                    "thstrm_add_amount": preferred_row.get("thstrm_add_amount"),
                    "frmtrm_amount": preferred_row.get("frmtrm_amount"),
                    "parsed_amount": amount,
                    "parsed_amount_eok": amount_to_eok(amount),
                }
            )
        else:
            missing_fields.append(field)

        for index, row in enumerate(matches, start=1):
            match_amount = pick_amount(row)
            candidate_rows.append(
                {
                    "code": code,
                    "name": name,
                    "year": year,
                    "quarter": quarter,
                    "field": field,
                    "candidate_rank": index,
                    "is_preferred": row is preferred_row,
                    "corp_code": corp_code,
                    "corp_name": corp_name,
                    "fs_div": fs_div,
                    "account_nm": row.get("account_nm"),
                    "sj_nm": row.get("sj_nm"),
                    "sj_div": row.get("sj_div"),
                    "account_id": row.get("account_id"),
                    "account_detail": row.get("account_detail"),
                    "thstrm_nm": row.get("thstrm_nm"),
                    "thstrm_amount": row.get("thstrm_amount"),
                    "thstrm_add_amount": row.get("thstrm_add_amount"),
                    "frmtrm_amount": row.get("frmtrm_amount"),
                    "parsed_amount": match_amount,
                    "parsed_amount_eok": amount_to_eok(match_amount),
                }
            )

    summary["missing_fields"] = ", ".join(missing_fields)
    summary["missing_field_count"] = len(missing_fields)
    return summary, selected_rows, candidate_rows


def write_sheet_or_message(
    writer: pd.ExcelWriter,
    sheet_name: str,
    rows: list[dict[str, Any]],
    empty_message: str,
) -> None:
    if rows:
        pd.DataFrame(rows).to_excel(writer, sheet_name=sheet_name, index=False)
    else:
        pd.DataFrame({"message": [empty_message]}).to_excel(
            writer,
            sheet_name=sheet_name,
            index=False,
        )


def build_account_id_catalog(
    candidate_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not candidate_rows:
        return [], []

    df = pd.DataFrame(candidate_rows)
    df = df[df["account_id"].notna() & (df["account_id"].astype(str).str.strip() != "")]
    if df.empty:
        return [], []

    by_company = (
        df.groupby(
            ["code", "name", "field", "account_id", "account_nm", "sj_nm"],
            dropna=False,
            as_index=False,
        )
        .size()
        .rename(columns={"size": "row_count"})
        .sort_values(["code", "field", "account_id", "row_count"], ascending=[True, True, True, False])
    )

    by_account = (
        df.groupby(["account_id", "account_nm", "sj_nm"], dropna=False, as_index=False)
        .agg(
            company_count=("code", "nunique"),
            row_count=("code", "size"),
        )
        .sort_values(["company_count", "row_count", "account_id"], ascending=[False, False, True])
    )

    return by_company.to_dict("records"), by_account.to_dict("records")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate DART account-map results for all companies and export Excel."
    )
    parser.add_argument("--year", type=int, default=2025, help="business year")
    parser.add_argument(
        "--quarter",
        type=int,
        choices=(1, 2, 3, 4),
        default=3,
        help="report quarter",
    )
    parser.add_argument(
        "--api-limit",
        type=int,
        default=9500,
        help="max DART API calls for company financial fetches",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        help="sleep seconds between company requests",
    )
    parser.add_argument(
        "--max-companies",
        type=int,
        default=None,
        help="optional cap for local dry runs",
    )
    parser.add_argument(
        "--codes",
        nargs="*",
        default=None,
        help="optional explicit stock codes",
    )
    parser.add_argument(
        "--markets",
        nargs="*",
        default=list(DEFAULT_MARKETS),
        help="markets to include when --codes is not set (default: KOSPI KOSDAQ)",
    )
    parser.add_argument(
        "--include-etf",
        action="store_true",
        help="include ETF/ETN names in the target set",
    )
    parser.add_argument(
        "--include-spac",
        action="store_true",
        help="include SPAC names in the target set",
    )
    parser.add_argument(
        "--include-preferred",
        action="store_true",
        help="include preferred-share names in the target set",
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

    print(f"Target companies: {len(companies)}")
    print(f"Year/Quarter: {args.year} Q{args.quarter}")
    print(f"API limit: {args.api_limit}")
    if args.codes:
        print(f"Codes override: {', '.join(args.codes)}")
    else:
        print(f"Markets: {', '.join(args.markets)}")
        print(
            "Name filters: "
            f"ETF/ETN={'include' if args.include_etf else 'exclude'}, "
            f"SPAC={'include' if args.include_spac else 'exclude'}, "
            f"Preferred={'include' if args.include_preferred else 'exclude'}"
        )

    company_results: list[dict[str, Any]] = []
    selected_rows: list[dict[str, Any]] = []
    candidate_rows: list[dict[str, Any]] = []
    no_dart_mapping: list[dict[str, Any]] = []
    no_data: list[dict[str, Any]] = []
    api_errors: list[dict[str, Any]] = []
    api_call_count = 0
    api_limit_reached = False

    for index, company in enumerate(companies, start=1):
        code = company["code"]
        name = company["name"]
        print(f"[{index}/{len(companies)}] {name}({code})", end=" ")

        corp_info = corp_map.get(code)
        if not corp_info:
            print("-> no DART mapping")
            no_dart_mapping.append({"code": code, "name": name})
            continue

        if api_call_count >= args.api_limit:
            print("-> stopped by API limit")
            api_limit_reached = True
            no_data.append(
                {
                    "code": code,
                    "name": name,
                    "reason": "API limit reached before request",
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

        try:
            api_call_count += 1
            fs_div, rows, error_message = get_financial_rows(
                api_key,
                corp_info["corp_code"],
                args.year,
                args.quarter,
            )
        except Exception as exc:
            print(f"-> request error: {exc}")
            api_errors.append(
                {
                    "code": code,
                    "name": name,
                    "corp_code": corp_info["corp_code"],
                    "error": str(exc),
                }
            )
            time.sleep(args.sleep)
            continue

        if not rows:
            print("-> no data")
            no_data.append(
                {
                    "code": code,
                    "name": name,
                    "corp_code": corp_info["corp_code"],
                    "reason": error_message or "No rows returned",
                }
            )
            time.sleep(args.sleep)
            continue

        summary, selected, candidates = build_company_result(
            code=code,
            name=name,
            year=args.year,
            quarter=args.quarter,
            corp_code=corp_info["corp_code"],
            corp_name=corp_info["corp_name"],
            fs_div=fs_div or "",
            rows=rows,
        )

        company_results.append(summary)
        selected_rows.extend(selected)
        candidate_rows.extend(candidates)
        print(
            "-> ok "
            f"(rows={summary['row_count']}, missing={summary['missing_field_count']})"
        )

        time.sleep(args.sleep)

    output_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "output",
        "dart_account_validation",
    )
    os.makedirs(output_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    excel_path = os.path.join(
        output_dir,
        f"dart_account_validation_{args.year}Q{args.quarter}_{timestamp}.xlsx",
    )

    summary_rows = [
        {"item": "target_companies", "value": len(companies)},
        {"item": "processed_companies", "value": len(company_results)},
        {"item": "no_dart_mapping", "value": len(no_dart_mapping)},
        {"item": "no_data", "value": len(no_data)},
        {"item": "api_errors", "value": len(api_errors)},
        {"item": "selected_rows", "value": len(selected_rows)},
        {"item": "candidate_rows", "value": len(candidate_rows)},
        {"item": "api_call_count", "value": api_call_count},
        {"item": "api_limit_reached", "value": "yes" if api_limit_reached else "no"},
        {"item": "year", "value": args.year},
        {"item": "quarter", "value": args.quarter},
    ]

    account_id_by_company, account_id_global = build_account_id_catalog(candidate_rows)

    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        pd.DataFrame(summary_rows).to_excel(writer, sheet_name="요약", index=False)
        write_sheet_or_message(writer, "종목별결과", company_results, "No processed companies")
        write_sheet_or_message(writer, "선택row", selected_rows, "No selected rows")
        write_sheet_or_message(writer, "후보row", candidate_rows, "No candidate rows")
        write_sheet_or_message(
            writer,
            "계정ID_종목별",
            account_id_by_company,
            "No account_id rows",
        )
        write_sheet_or_message(
            writer,
            "계정ID_전체",
            account_id_global,
            "No account_id rows",
        )
        write_sheet_or_message(
            writer,
            "DART매핑없음",
            no_dart_mapping,
            "All companies were mapped to DART",
        )
        write_sheet_or_message(writer, "데이터없음", no_data, "All companies returned data")
        write_sheet_or_message(writer, "API오류", api_errors, "No API errors")

    print()
    print("=" * 80)
    print("Done")
    print(f"Excel: {excel_path}")
    print(f"Processed companies: {len(company_results)}")
    print(f"No mapping: {len(no_dart_mapping)}")
    print(f"No data: {len(no_data)}")
    print(f"API errors: {len(api_errors)}")
    print(f"API calls: {api_call_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
