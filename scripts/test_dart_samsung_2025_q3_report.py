"""
Probe what can be fetched from DART for Samsung Electronics 2025 Q3 report.

This script:
1. Loads DART_API_KEY from .env.local or .env
2. Resolves Samsung Electronics corp_code from DART corpCode.xml
3. Searches DART filings for the 2025 Q3 quarterly report
4. Fetches company metadata
5. Fetches full single-company financial statement rows
6. Prints the available fields and sample account names

No database writes are performed.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Any

import requests
from dotenv import load_dotenv
from financials_account_map import (
    DART_CORE_ACCOUNT_MAP,
    DART_EXPLORATORY_ACCOUNT_MAP,
    amount_to_eok,
    collect_account_matches,
    parse_amount,
    row_matches_keywords,
    select_preferred_account_row,
)

DART_API_BASE = "https://opendart.fss.or.kr/api"
REPORT_CODE_BY_QUARTER = {
    1: "11013",  # Q1
    2: "11012",  # H1
    3: "11014",  # Q3
    4: "11011",  # Annual
}
REPORT_NAME_BY_QUARTER = {
    1: "분기보고서",
    2: "반기보고서",
    3: "분기보고서",
    4: "사업보고서",
}
PERIOD_SUFFIX_BY_QUARTER = {
    1: "03",
    2: "06",
    3: "09",
    4: "12",
}


def load_api_key() -> str:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    env_path = os.path.join(project_root, ".env.local")
    if not os.path.exists(env_path):
        env_path = os.path.join(project_root, ".env")

    load_dotenv(dotenv_path=env_path)
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        raise RuntimeError(
            "DART_API_KEY was not found in .env.local or .env. "
            "Add DART_API_KEY=... and retry."
        )
    return api_key


def get_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(f"{DART_API_BASE}/{path}", params=params, timeout=30)
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


def get_company_info(api_key: str, corp_code: str) -> dict[str, Any]:
    return get_json(
        "company.json",
        {
            "crtfc_key": api_key,
            "corp_code": corp_code,
        },
    )


def find_target_filings(
    api_key: str,
    corp_code: str,
    year: int,
    quarter: int,
) -> list[dict[str, Any]]:
    period_suffix = PERIOD_SUFFIX_BY_QUARTER[quarter]
    report_name = REPORT_NAME_BY_QUARTER[quarter]

    payload = get_json(
        "list.json",
        {
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bgn_de": f"{year}0101",
            "end_de": f"{year}1231",
            "last_reprt_at": "Y",
            "sort": "date",
            "sort_mth": "desc",
            "page_no": 1,
            "page_count": 100,
        },
    )

    if payload.get("status") != "000":
        raise RuntimeError(
            f"list.json failed: {payload.get('status')} {payload.get('message')}"
        )

    rows = payload.get("list", [])
    target_period = f"({year}.{period_suffix})"
    return [
        row
        for row in rows
        if report_name in (row.get("report_nm") or "")
        and target_period in (row.get("report_nm") or "")
    ]


def get_financial_rows(
    api_key: str,
    corp_code: str,
    year: int,
    quarter: int,
) -> tuple[str, list[dict[str, Any]]]:
    reprt_code = REPORT_CODE_BY_QUARTER[quarter]

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
        if payload.get("status") == "000":
            return fs_div, payload.get("list", [])

    raise RuntimeError(
        "fnlttSinglAcntAll.json returned no usable data for CFS or OFS."
    )

def print_section(title: str) -> None:
    print()
    print("=" * 80)
    print(title)
    print("=" * 80)


def print_company_info(info: dict[str, Any]) -> None:
    if info.get("status") != "000":
        print(f"company.json failed: {info.get('status')} {info.get('message')}")
        return

    keys = [
        "corp_name",
        "corp_name_eng",
        "stock_name",
        "stock_code",
        "ceo_nm",
        "corp_cls",
        "jurir_no",
        "bizr_no",
        "adres",
        "hm_url",
        "ir_url",
        "phn_no",
        "induty_code",
        "est_dt",
        "acc_mt",
    ]
    for key in keys:
        value = info.get(key)
        if value:
            print(f"{key}: {value}")


def print_filing_rows(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("No matching filing rows found.")
        return

    print(f"Matched filings: {len(rows)}")
    for idx, row in enumerate(rows[:5], start=1):
        print(f"[{idx}] report_nm={row.get('report_nm')}")
        print(f"    rcept_no={row.get('rcept_no')}")
        print(f"    rcept_dt={row.get('rcept_dt')}")
        print(f"    corp_name={row.get('corp_name')}")
        print(f"    flr_nm={row.get('flr_nm')}")
        print(f"    rm={row.get('rm')}")


def print_financial_summary(
    fs_div: str,
    rows: list[dict[str, Any]],
    account_limit: int,
) -> None:
    print(f"fs_div used: {fs_div}")
    print(f"financial row count: {len(rows)}")

    if not rows:
        return

    print()
    print("available row keys:")
    for key in sorted(rows[0].keys()):
        print(f"- {key}")

    by_statement: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        statement = row.get("sj_nm") or row.get("sj_div") or "UNKNOWN"
        account_name = row.get("account_nm") or ""
        if account_name and account_name not in by_statement[statement]:
            by_statement[statement].append(account_name)

    print()
    print("statement sections and sample account names:")
    for statement, account_names in sorted(by_statement.items()):
        print(f"- {statement}: {len(account_names)} accounts")
        for account_name in account_names[:account_limit]:
            print(f"    {account_name}")


def print_key_accounts(rows: list[dict[str, Any]]) -> None:
    print("selected account candidates:")
    matched = 0

    pretty_names = {
        "revenue": "revenue",
        "op_income": "operating_income",
        "net_income": "net_income",
        "assets": "assets",
        "equity": "equity",
        "liabilities": "liabilities",
        "capital": "capital",
        "shares": "shares",
    }

    for label, keywords in DART_EXPLORATORY_ACCOUNT_MAP.items():
        for row in rows:
            account_name = row.get("account_nm") or ""
            if not row_matches_keywords(account_name, keywords):
                continue

            amount = (
                parse_amount(row.get("thstrm_amount"))
                or parse_amount(row.get("thstrm_add_amount"))
                or parse_amount(row.get("frmtrm_amount"))
            )
            matched += 1
            print(f"- {pretty_names.get(label, label)}")
            print(f"    account_nm={account_name}")
            print(f"    sj_nm={row.get('sj_nm')}")
            print(f"    thstrm_nm={row.get('thstrm_nm')}")
            print(f"    thstrm_amount={row.get('thstrm_amount')}")
            print(f"    frmtrm_amount={row.get('frmtrm_amount')}")
            if amount is not None:
                print(f"    parsed_integer={amount}")
                print(f"    parsed_eok={amount_to_eok(amount)}")
            break

    if matched == 0:
        print("- No target accounts matched.")


def print_account_map_validation(
    rows: list[dict[str, Any]],
    account_limit: int,
) -> None:
    print("shared core account_map validation:")
    for field in DART_CORE_ACCOUNT_MAP:
        matches = collect_account_matches(rows, field)

        print(f"- {field}: {len(matches)} candidate row(s)")
        if not matches:
            continue

        preferred_row = select_preferred_account_row(rows, field)
        if preferred_row:
            amount = parse_amount(preferred_row.get("thstrm_amount"))
            print("    preferred:")
            print(f"      account_nm={preferred_row.get('account_nm')}")
            print(f"      sj_nm={preferred_row.get('sj_nm')}")
            print(f"      account_id={preferred_row.get('account_id')}")
            print(f"      account_detail={preferred_row.get('account_detail')}")
            print(f"      thstrm_amount={preferred_row.get('thstrm_amount')}")
            if amount is not None:
                print(f"      thstrm_amount_eok={amount_to_eok(amount)}")

        for row in matches[:account_limit]:
            amount = parse_amount(row.get("thstrm_amount"))
            print(f"    account_nm={row.get('account_nm')}")
            print(f"    sj_nm={row.get('sj_nm')}")
            print(f"    account_id={row.get('account_id')}")
            print(f"    account_detail={row.get('account_detail')}")
            print(f"    thstrm_nm={row.get('thstrm_nm')}")
            print(f"    thstrm_amount={row.get('thstrm_amount')}")
            if amount is not None:
                print(f"    thstrm_amount_eok={amount_to_eok(amount)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Probe available DART data for Samsung Electronics 2025 Q3 quarterly report."
        )
    )
    parser.add_argument("--stock-code", default="005930", help="6-digit stock code")
    parser.add_argument("--year", type=int, default=2025, help="business year")
    parser.add_argument(
        "--quarter",
        type=int,
        choices=(1, 2, 3, 4),
        default=3,
        help="report quarter",
    )
    parser.add_argument(
        "--account-limit",
        type=int,
        default=15,
        help="sample account names to show per statement",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()

    try:
        api_key = load_api_key()
        corp_map = get_corp_map(api_key)
        corp_info = corp_map.get(args.stock_code)
        if not corp_info:
            raise RuntimeError(f"stock code {args.stock_code} was not found in corpCode.xml")

        print_section("TARGET")
        print(f"stock_code: {args.stock_code}")
        print(f"corp_name: {corp_info['corp_name']}")
        print(f"corp_code: {corp_info['corp_code']}")
        print(f"year: {args.year}")
        print(f"quarter: {args.quarter}")
        print(f"reprt_code: {REPORT_CODE_BY_QUARTER[args.quarter]}")

        print_section("COMPANY METADATA (company.json)")
        company_info = get_company_info(api_key, corp_info["corp_code"])
        print_company_info(company_info)

        print_section("MATCHING FILINGS (list.json)")
        filing_rows = find_target_filings(
            api_key,
            corp_info["corp_code"],
            args.year,
            args.quarter,
        )
        print_filing_rows(filing_rows)

        print_section("FINANCIAL STATEMENT ROWS (fnlttSinglAcntAll.json)")
        fs_div, financial_rows = get_financial_rows(
            api_key,
            corp_info["corp_code"],
            args.year,
            args.quarter,
        )
        print_financial_summary(fs_div, financial_rows, args.account_limit)

        print()
        print_key_accounts(financial_rows)

        print()
        print_account_map_validation(financial_rows, args.account_limit)

        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
