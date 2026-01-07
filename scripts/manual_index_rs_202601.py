import os
import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import xml.etree.ElementTree as ET
from supabase import create_client, Client
from dotenv import load_dotenv
from pykrx.website.naver.core import Sise as NaverSise

load_dotenv(".env.local")

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("ERROR: missing Supabase env vars.")
    raise SystemExit(1)

supabase: Client = create_client(url, key)

TARGET_DATES = ["2026-01-05", "2026-01-06"]
INDEX_CODES = ["KOSPI", "KOSDAQ"]


def get_index_ohlcv_from_naver(symbol, start_date, end_date):
    start_dt = pd.to_datetime(start_date)
    end_dt = pd.to_datetime(end_date)
    elapsed = (datetime.now() - start_dt).days + 5

    xml = NaverSise().fetch(symbol, max(elapsed, 30))

    rows = []
    try:
        for node in ET.fromstring(xml).iter("item"):
            parts = node.get("data", "").split("|")
            if len(parts) < 6:
                continue
            date_str, open_v, high_v, low_v, close_v, volume_v = parts[:6]
            rows.append([date_str, open_v, high_v, low_v, close_v, volume_v])
    except ET.ParseError:
        return pd.DataFrame()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df = df.set_index("date")
    df = df.astype(
        {
            "open": float,
            "high": float,
            "low": float,
            "close": float,
            "volume": float,
        }
    )
    return df.loc[(start_dt <= df.index) & (df.index <= end_dt)]


def upsert_index_prices():
    rows = []
    start_date = min(TARGET_DATES)
    end_date = max(TARGET_DATES)

    for code in INDEX_CODES:
        df = get_index_ohlcv_from_naver(code, start_date, end_date)
        if df.empty:
            print(f"ERROR: no NAVER data for {code}")
            raise SystemExit(1)

        for date_str in TARGET_DATES:
            dt = pd.to_datetime(date_str)
            if dt not in df.index:
                print(f"ERROR: missing {code} data for {date_str}")
                raise SystemExit(1)
            row = df.loc[dt]
            rows.append(
                {
                    "code": code,
                    "date": date_str,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["volume"]),
                    "trading_value": 0,
                    "change": 0,
                }
            )

    for i in range(0, len(rows), 1000):
        chunk = rows[i : i + 1000]
        supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()


def fetch_prices(start_date, end_date):
    all_rows = []
    chunk_offset = 0
    chunk_limit = 10000

    while True:
        res = (
            supabase.table("daily_prices_v2")
            .select("code, date, close")
            .gte("date", start_date)
            .lte("date", end_date)
            .order("date")
            .order("code")
            .range(chunk_offset, chunk_offset + chunk_limit - 1)
            .execute()
        )

        if not res.data:
            break

        all_rows.extend(res.data)

        if len(res.data) < chunk_limit:
            break

        chunk_offset += chunk_limit
        print(f"  loaded {len(all_rows)} rows...", end="\r")

    print(f"\nloaded {len(all_rows)} rows")
    return all_rows


def calc_rs_for_date(target_date):
    fetch_start = (
        datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=400)
    ).strftime("%Y-%m-%d")

    rows = fetch_prices(fetch_start, target_date)
    if not rows:
        print(f"ERROR: no price data for {target_date}")
        return

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["close"] = df["close"].astype(float)
    df = df.sort_values(["code", "date"])

    P3 = 63
    P6 = 126
    P9 = 189
    P12 = 252

    df["ret_3m"] = df.groupby("code")["close"].pct_change(P3)
    df["ret_6m"] = df.groupby("code")["close"].pct_change(P6)
    df["ret_12m"] = df.groupby("code")["close"].pct_change(P12)

    grp = df.groupby("code")["close"]
    s_now = df["close"]
    s_3m = grp.shift(P3).replace(0, np.nan)
    s_6m = grp.shift(P6).replace(0, np.nan)
    s_9m = grp.shift(P9).replace(0, np.nan)
    s_12m = grp.shift(P12).replace(0, np.nan)

    r1 = (s_now - s_3m) / s_3m
    r2 = (s_3m - s_6m) / s_6m
    r3 = (s_6m - s_9m) / s_9m
    r4 = (s_9m - s_12m) / s_12m

    df["score_weighted"] = (0.4 * r1) + (0.2 * r2) + (0.2 * r3) + (0.2 * r4)

    df_today = df[df["date"] == target_date].copy()
    if df_today.empty:
        print(f"ERROR: no rows for {target_date}")
        return

    def rank_series(series):
        return (
            series.rank(pct=True)
            .mul(99)
            .fillna(0)
            .round()
            .astype(int)
            .clip(1, 99)
        )

    df_today["rank_weighted"] = rank_series(df_today["score_weighted"])
    df_today["rank_3m"] = rank_series(df_today["ret_3m"])
    df_today["rank_6m"] = rank_series(df_today["ret_6m"])
    df_today["rank_12m"] = rank_series(df_today["ret_12m"])

    df_today = df_today.fillna(0)

    upload_list = []
    for _, row in df_today.iterrows():
        upload_list.append(
            {
                "date": row["date"].strftime("%Y-%m-%d"),
                "code": row["code"],
                "score_weighted": row["score_weighted"],
                "rank_weighted": int(row["rank_weighted"]),
                "score_3m": row["ret_3m"],
                "rank_3m": int(row["rank_3m"]),
                "score_6m": row["ret_6m"],
                "rank_6m": int(row["rank_6m"]),
                "score_12m": row["ret_12m"],
                "rank_12m": int(row["rank_12m"]),
            }
        )

    chunk_size = 2000
    total_chunks = len(upload_list) // chunk_size + 1
    for i in range(0, len(upload_list), chunk_size):
        chunk = upload_list[i : i + chunk_size]
        try:
            supabase.table("rs_rankings_v2").upsert(chunk, on_conflict="date, code").execute()
            print(f"  [{i // chunk_size + 1}/{total_chunks}] upsert done")
        except Exception as e:
            print(f"  ERROR: upsert failed: {e}")
            time.sleep(1)


if __name__ == "__main__":
    upsert_index_prices()
    for target in TARGET_DATES:
        print(f"\nCalculating RS for {target}")
        calc_rs_for_date(target)
