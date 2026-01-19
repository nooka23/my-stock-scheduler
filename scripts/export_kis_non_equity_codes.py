import os
import sys
import csv
from datetime import datetime

import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.append(SCRIPT_DIR)

import kis_master_loader  # noqa: E402


def flag_value(value):
    if pd.isna(value):
        return False
    text = str(value).strip().upper()
    if text in {"", "0", "N", "NO", "F", "FALSE"}:
        return False
    return True


def extract_flags(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["is_etp"] = df["ETP"].apply(flag_value) if "ETP" in df.columns else False
    df["is_spac"] = df["SPAC"].apply(flag_value) if "SPAC" in df.columns else False
    df["is_preferred"] = (
        df["Preferred"].apply(flag_value) if "Preferred" in df.columns else False
    )
    return df


def build_code_list(df: pd.DataFrame) -> list[dict]:
    df = extract_flags(df)
    df = df[(df["ShortCode"].str.len() == 6)]
    flagged = df[df["is_etp"] | df["is_spac"] | df["is_preferred"]]

    rows = []
    for _, row in flagged.iterrows():
        rows.append(
            {
                "code": str(row["ShortCode"]),
                "name": row.get("Name", ""),
                "market": row.get("Market", ""),
                "is_etp": bool(row.get("is_etp", False)),
                "is_spac": bool(row.get("is_spac", False)),
                "is_preferred": bool(row.get("is_preferred", False)),
            }
        )
    return rows


def write_csv(path: str, rows: list[dict]) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["code", "name", "market", "is_etp", "is_spac", "is_preferred"]
        )
        writer.writeheader()
        writer.writerows(rows)


def write_sql(path: str, rows: list[dict]) -> None:
    if not rows:
        return
    codes = sorted({row["code"] for row in rows})
    quoted = ",\n  ".join([f"'{code}'" for code in codes])
    sql = (
        "SELECT c.code, c.name, c.market\n"
        "FROM companies c\n"
        "WHERE c.code IN (\n"
        f"  {quoted}\n"
        ");\n\n"
        "DELETE FROM daily_prices_v2\n"
        "WHERE code IN (\n"
        f"  {quoted}\n"
        ");\n\n"
        "DELETE FROM rs_rankings_v2\n"
        "WHERE code IN (\n"
        f"  {quoted}\n"
        ");\n\n"
        "DELETE FROM companies\n"
        "WHERE code IN (\n"
        f"  {quoted}\n"
        ");\n"
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(sql)


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = os.path.join("scripts", "output", "kis_non_equity_codes")
    os.makedirs(output_dir, exist_ok=True)

    print("Downloading KIS master files...")
    kospi_df = kis_master_loader.download_and_parse_kospi_master(os.getcwd())
    if not kospi_df.empty:
        kospi_df["Market"] = "KOSPI"

    kosdaq_df = kis_master_loader.download_and_parse_kosdaq_master(os.getcwd())
    if not kosdaq_df.empty:
        kosdaq_df["Market"] = "KOSDAQ"

    full_df = pd.concat([kospi_df, kosdaq_df], ignore_index=True)
    if full_df.empty:
        print("ERROR: No data from KIS master files.")
        return

    rows = build_code_list(full_df)
    print(f"Flagged rows: {len(rows)}")

    csv_path = os.path.join(output_dir, f"kis_non_equity_codes_{timestamp}.csv")
    sql_path = os.path.join(output_dir, f"kis_non_equity_codes_{timestamp}.sql")
    write_csv(csv_path, rows)
    write_sql(sql_path, rows)

    print(f"Saved CSV: {csv_path}")
    print(f"Saved SQL: {sql_path}")


if __name__ == "__main__":
    main()
