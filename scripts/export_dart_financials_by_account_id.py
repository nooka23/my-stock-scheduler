"""
Save DART financial values to Supabase using manual account_id priority lists.

How it works:
1. Fill ACCOUNT_ID_PRIORITY_MAP below with primary/fallback account IDs.
2. Fetch DART financial rows for each company.
3. For each target field, pick the first matching account_id in priority order.
4. Upsert the normalized result into company_financials_v2.
5. Export missing-account rows to Excel for review.
"""

from __future__ import annotations

import argparse
import io
import os
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests
from dotenv import load_dotenv
from supabase import Client, create_client

from financials_account_map import parse_amount, select_account_row_by_priority

DART_API_BASE = "https://opendart.fss.or.kr/api"
REPORT_CODE_BY_QUARTER = {
    1: "11013",
    2: "11012",
    3: "11014",
    4: "11011",
}
DEFAULT_MARKETS = ("KOSPI", "KOSDAQ")
PREFERRED_SUFFIXES = ("우", "우B", "우C", "우(전환)", "우선주")
TARGET_TABLE = "company_financials_v2"

FIELD_COLUMN_MAP: dict[str, str] = {
    "자산총계": "assets_total",
    "유동자산": "current_assets",
    "현금 및 현금성자산": "cash_and_cash_equivalents",
    "단기금융자산": "short_term_financial_assets",
    "매출채권": "trade_receivables",
    "재고자산": "inventories",
    "비유동자산": "noncurrent_assets",
    "관계기업투자": "investments_in_associates",
    "유형자산": "property_plant_and_equipment",
    "무형자산": "intangible_assets",
    "부채총계": "liabilities_total",
    "유동부채": "current_liabilities",
    "비유동부채": "noncurrent_liabilities",
    "자본총계": "equity_total",
    "매출액": "revenue",
    "매출원가": "cost_of_sales",
    "영업이익": "operating_income",
    "판매비와관리비": "selling_general_administrative_expenses",
    "세전이익": "profit_before_tax",
    "법인세비용": "income_tax_expense",
    "당기순이익": "net_income",
    "영업활동현금흐름": "operating_cash_flow",
    "투자활동현금흐름": "investing_cash_flow",
    "재무활동현금흐름": "financing_cash_flow",
    "기초현금": "cash_beginning",
    "기말현금": "cash_ending",
}

# Fill each list in priority order.
# Example:
# "자산총계": ["ifrs-full_Assets", "ifrs_Assets", "dart_TotalAssets"],
ACCOUNT_ID_PRIORITY_MAP: dict[str, list[str]] = {
    "자산총계": ["ifrs-full_Assets"],
    "유동자산": ["ifrs-full_CurrentAssets"],
    "현금 및 현금성자산": ["ifrs-full_CurrentAssets", "ifrs-full_CashEquivalents", "dart_CashAndCashEquivalentsGross"],
    "단기금융자산": ["ifrs-full_ShorttermDepositsNotClassifiedAsCashEquivalents", "ifrs-full_CurrentFinancialAssetsAtFairValueThroughProfitOrLoss", "ifrs-full_CurrentFinancialAssetsAtFairValueThroughProfitOrLossDesignatedUponInitialRecognition", "ifrs-full_CurrentFinancialAssets"],
    "매출채권": ["dart_ShortTermTradeReceivable", "ifrs-full_CurrentTradeReceivables", "ifrs-full_TradeReceivables", "ifrs-full_TradeAndOtherCurrentReceivables"],
    "재고자산": ["ifrs-full_Inventories", "ifrs-full_InventoriesTotal"],
    "비유동자산": ["ifrs-full_NoncurrentAssets"],
    "관계기업투자": ["ifrs-full_InvestmentsInAssociates", "ifrs-full_InvestmentAccountedForUsingEquityMethod", "ifrs-full_InvestmentsInSubsidiariesJointVenturesAndAssociates", "ifrs-full_InvestmentsInAssociatesAccountedForUsingEquityMethod", "ifrs-full_InvestmentsInJointVentures", "ifrs-full_InvestmentsInJointVenturesAccountedForUsingEquityMethod"],
    "유형자산": ["ifrs-full_PropertyPlantAndEquipment"],
    "무형자산": ["ifrs-full_IntangibleAssetsOtherThanGoodwill", "ifrs-full_IntangibleAssetsAndGoodwill", "dart_OtherIntangibleAssetsGross"],
    "부채총계": ["ifrs-full_Liabilities"],
    "유동부채": ["ifrs-full_CurrentLiabilities"],
    "비유동부채": ["ifrs-full_NoncurrentLiabilities"],
    "자본총계": ["ifrs-full_Equity"],
    "매출액": ["ifrs-full_Equity"],
    "매출원가": ["ifrs-full_CostOfSales"],
    "영업이익": ["dart_OperatingIncomeLoss", "ifrs-full_ProfitLossFromOperatingActivities"],
    "판매비와관리비": ["dart_TotalSellingGeneralAdministrativeExpenses", "ifrs-full_SellingGeneralAndAdministrativeExpense"],
    "세전이익": ["ifrs-full_ProfitLossBeforeTax"],
    "법인세비용": ["ifrs-full_IncomeTaxExpenseContinuingOperations"],
    "당기순이익": ["ifrs-full_ProfitLoss"],
    "영업활동현금흐름": ["ifrs-full_CashFlowsFromUsedInOperatingActivities"],
    "투자활동현금흐름": ["ifrs-full_CashFlowsFromUsedInInvestingActivities"],
    "재무활동현금흐름": ["ifrs-full_CashFlowsFromUsedInFinancingActivities"],
    "기초현금": ["ifrs-full_CashFlowsFromUsedInFinancingActivities"],
    "기말현금": ["ifrs-full_CashFlowsFromUsedInFinancingActivities"],
}


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
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY "
            "was not found in .env.local or .env."
        )

    return dart_api_key, create_client(url, key)


def get_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    response = requests.get(f"{DART_API_BASE}/{path}", params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def ensure_excel_engine() -> None:
    try:
        import openpyxl  # noqa: F401
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "openpyxl is required to write Excel files. "
            "Install it with `python3 -m pip install openpyxl`."
        ) from exc


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
    fs_div_mode: str,
) -> tuple[str | None, list[dict[str, Any]], str | None]:
    fs_div_candidates = ("CFS", "OFS") if fs_div_mode == "all" else (fs_div_mode.upper(),)

    last_error = None
    for fs_div in fs_div_candidates:
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
            return fs_div, payload.get("list", []), None
        last_error = f"{payload.get('status')} {payload.get('message')}"

    return None, [], last_error


def pick_amount_eok(row: dict[str, Any] | None) -> int | None:
    if not row:
        return None
    amount = (
        parse_amount(row.get("thstrm_amount"))
        or parse_amount(row.get("thstrm_add_amount"))
        or parse_amount(row.get("frmtrm_amount"))
    )
    if amount is None:
        return None
    return amount // 100


def validate_account_map() -> None:
    missing_fields = [field for field, account_ids in ACCOUNT_ID_PRIORITY_MAP.items() if not account_ids]
    if missing_fields:
        joined_fields = ", ".join(missing_fields)
        raise RuntimeError(
            "ACCOUNT_ID_PRIORITY_MAP is incomplete. Fill account IDs for: "
            f"{joined_fields}"
        )


def build_record(
    code: str,
    corp_code: str,
    corp_name: str,
    year: int,
    quarter: int,
    fs_div: str,
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    selected_account_ids: dict[str, str] = {}
    selected_account_names: dict[str, str] = {}
    selected_statement_names: dict[str, str] = {}
    selected_priority_indices: dict[str, int] = {}
    missing_fields: list[str] = []

    record: dict[str, Any] = {
        "company_code": code,
        "corp_code": corp_code,
        "corp_name": corp_name,
        "year": year,
        "quarter": quarter,
        "reprt_code": REPORT_CODE_BY_QUARTER[quarter],
        "fs_div": fs_div,
        "is_consolidated": fs_div == "CFS",
        "selected_account_ids": selected_account_ids,
        "selected_account_names": selected_account_names,
        "selected_statement_names": selected_statement_names,
        "selected_priority_indices": selected_priority_indices,
        "account_id_priority_map": ACCOUNT_ID_PRIORITY_MAP,
        "raw_row_count": len(rows),
        "data_source": "dart_account_id_manual",
        "raw_fetched_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    for field, column_name in FIELD_COLUMN_MAP.items():
        matched_row, used_account_id, priority_index = select_account_row_by_priority(
            rows, ACCOUNT_ID_PRIORITY_MAP[field]
        )
        record[column_name] = pick_amount_eok(matched_row)

        if matched_row and used_account_id and priority_index is not None:
            selected_account_ids[field] = used_account_id
            selected_account_names[field] = str(matched_row.get("account_nm") or "")
            selected_statement_names[field] = str(matched_row.get("sj_nm") or matched_row.get("sj_div") or "")
            selected_priority_indices[field] = priority_index
        else:
            missing_fields.append(field)

    return record, missing_fields


def upsert_record(supabase: Client, record: dict[str, Any]) -> None:
    supabase.table(TARGET_TABLE).upsert(
        record,
        on_conflict="company_code,year,quarter,data_source",
    ).execute()


def write_missing_accounts_report(
    year: int,
    quarter: int,
    missing_by_company: list[dict[str, Any]],
    error_rows: list[dict[str, Any]],
) -> str:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(current_dir, "output", "dart_missing_accounts")
    os.makedirs(output_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(
        output_dir,
        f"dart_missing_accounts_{year}Q{quarter}_{timestamp}.xlsx",
    )

    detailed_rows: list[dict[str, Any]] = []
    for company in missing_by_company:
        for field in company["missing_fields_list"]:
            detailed_rows.append(
                {
                    "code": company["code"],
                    "name": company["name"],
                    "corp_code": company.get("corp_code"),
                    "corp_name": company.get("corp_name"),
                    "year": company["year"],
                    "quarter": company["quarter"],
                    "fs_div": company.get("fs_div"),
                    "missing_field": field,
                }
            )

    summary_rows = [
        {
            "code": company["code"],
            "name": company["name"],
            "corp_code": company.get("corp_code"),
            "corp_name": company.get("corp_name"),
            "year": company["year"],
            "quarter": company["quarter"],
            "fs_div": company.get("fs_div"),
            "missing_count": len(company["missing_fields_list"]),
            "missing_fields": ", ".join(company["missing_fields_list"]),
        }
        for company in missing_by_company
    ]

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        if summary_rows:
            pd.DataFrame(summary_rows).to_excel(writer, sheet_name="missing_summary", index=False)
        else:
            pd.DataFrame({"message": ["No missing accounts."]}).to_excel(
                writer,
                sheet_name="missing_summary",
                index=False,
            )

        if detailed_rows:
            pd.DataFrame(detailed_rows).to_excel(writer, sheet_name="missing_detail", index=False)
        else:
            pd.DataFrame({"message": ["No missing account detail rows."]}).to_excel(
                writer,
                sheet_name="missing_detail",
                index=False,
            )

        if error_rows:
            pd.DataFrame(error_rows).to_excel(writer, sheet_name="errors", index=False)
        else:
            pd.DataFrame({"message": ["No errors."]}).to_excel(
                writer,
                sheet_name="errors",
                index=False,
            )

    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Save DART financials using account_id priority lists.")
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
        help="all: try CFS then OFS, cfs/ofs: fetch one only",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    validate_account_map()
    ensure_excel_engine()

    api_key, supabase = load_env()
    corp_map = get_corp_map(api_key)
    companies = get_companies(
        supabase,
        codes=args.codes,
        markets=args.markets,
        include_etf=args.include_etf,
        include_spac=args.include_spac,
        include_preferred=args.include_preferred,
    )
    if args.max_companies:
        companies = companies[: args.max_companies]

    success_count = 0
    error_rows: list[dict[str, str]] = []
    missing_by_company: list[dict[str, str]] = []
    api_call_count = 0

    for index, company in enumerate(companies, start=1):
        code = company["code"]
        name = company["name"]
        print(f"[{index}/{len(companies)}] {name}({code})", end=" ")

        corp_info = corp_map.get(code)
        if not corp_info:
            print("- corp_code 없음")
            error_rows.append(
                {"code": code, "name": name, "stage": "corp_map", "message": "missing DART corp_code mapping"}
            )
            continue

        if api_call_count >= args.api_limit:
            print("- API 제한 도달")
            error_rows.append(
                {"code": code, "name": name, "stage": "api_limit", "message": "api limit reached"}
            )
            continue

        fs_div, rows, error_message = fetch_financial_rows(
            api_key=api_key,
            corp_code=corp_info["corp_code"],
            year=args.year,
            quarter=args.quarter,
            fs_div_mode=args.fs_div_mode,
        )
        api_call_count += 2 if args.fs_div_mode == "all" and not rows else 1

        if error_message or not rows or not fs_div:
            print("- DART 데이터 없음")
            error_rows.append(
                {
                    "code": code,
                    "name": name,
                    "stage": "financial_rows",
                    "message": error_message or "no rows returned",
                }
            )
            time.sleep(args.sleep)
            continue

        try:
            record, missing_fields = build_record(
                code=code,
                corp_code=corp_info["corp_code"],
                corp_name=corp_info["corp_name"],
                year=args.year,
                quarter=args.quarter,
                fs_div=fs_div,
                rows=rows,
            )
            upsert_record(supabase, record)
            success_count += 1
            if missing_fields:
                missing_by_company.append(
                    {
                        "code": code,
                        "name": name,
                        "corp_code": corp_info["corp_code"],
                        "corp_name": corp_info["corp_name"],
                        "year": args.year,
                        "quarter": args.quarter,
                        "fs_div": fs_div,
                        "missing_fields_list": missing_fields,
                        "missing_fields": ", ".join(missing_fields),
                    }
                )
                print(f"- 저장 완료, 누락 {len(missing_fields)}개")
            else:
                print("- 저장 완료")
        except Exception as exc:
            print(f"- 저장 실패: {exc}")
            error_rows.append(
                {
                    "code": code,
                    "name": name,
                    "stage": "upsert",
                    "message": str(exc),
                }
            )

        time.sleep(args.sleep)

    report_path = write_missing_accounts_report(
        year=args.year,
        quarter=args.quarter,
        missing_by_company=missing_by_company,
        error_rows=error_rows,
    )

    print("")
    print(f"table: {TARGET_TABLE}")
    print(f"saved: {success_count}")
    print(f"missing field companies: {len(missing_by_company)}")
    print(f"errors: {len(error_rows)}")
    print(f"api calls: {api_call_count}")
    print(f"missing accounts report: {report_path}")

    if missing_by_company:
        print("companies with missing fields:")
        for row in missing_by_company[:20]:
            print(f"  {row['code']} {row['name']}: {row['missing_fields']}")

    if error_rows:
        print("errors:")
        for row in error_rows[:20]:
            print(f"  {row['code']} {row['name']} [{row['stage']}] {row['message']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
