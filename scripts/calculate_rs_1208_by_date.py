import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from datetime import datetime, timedelta
import argparse

load_dotenv(".env.local")

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("환경변수 오류")
    exit()

supabase: Client = create_client(url, key)

parser = argparse.ArgumentParser(description="Calculate V2 daily RS rankings for a target date.")
parser.add_argument("--target-date", required=True, help="Target date in YYYY-MM-DD format")
args = parser.parse_args()

TARGET_DATE = args.target_date

print(f"V2 데일리 RS 랭킹 계산 시작 (Target Date: {TARGET_DATE})")

# 12개월 RS 계산을 위해 252거래일 이상 필요 -> 안전하게 400일 로딩
FETCH_START_DATE = (
    datetime.strptime(TARGET_DATE, "%Y-%m-%d") - timedelta(days=400)
).strftime("%Y-%m-%d")

print(f"1. 주가 데이터 로딩 중 ({FETCH_START_DATE} ~ {TARGET_DATE})...")

try:
    all_rows = []

    curr = datetime.strptime(FETCH_START_DATE, "%Y-%m-%d")
    end = datetime.strptime(TARGET_DATE, "%Y-%m-%d")

    while curr <= end:
        target_day = curr.strftime("%Y-%m-%d")
        day_offset = 0

        while True:
            res = (
                supabase.table("daily_prices_v2")
                .select("code, date, close")
                .eq("date", target_day)
                .range(day_offset, day_offset + 999)
                .execute()
            )

            if not res.data:
                break

            all_rows.extend(res.data)

            if len(res.data) < 1000:
                break

            day_offset += 1000

        print(f"   {target_day}: 누적 {len(all_rows)}건 로드 중...", end="\r")
        curr += timedelta(days=1)

    print(f"\n로드 완료: {len(all_rows)}건")

    if not all_rows:
        print("데이터가 없습니다. daily_prices_v2 테이블을 확인하세요.")
        exit()

    df = pd.DataFrame(all_rows)
    df["date"] = pd.to_datetime(df["date"])
    df["close"] = df["close"].astype(float)

except Exception as e:
    print(f"\n데이터 로드 실패: {e}")
    exit()

print("2. 종목별 수익률/가중점수 계산 중...")

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

target_datetime = pd.to_datetime(TARGET_DATE)
df_today = df[df["date"] == target_datetime].copy()

print(f"   대상 일자 데이터 건수: {len(df_today)}건")

if df_today.empty:
    print(f"{TARGET_DATE} 일자에 해당하는 데이터가 없습니다.")
    exit()

print("3. 랭킹(1~99) 계산 중...")

def calc_rank_single_day(series):
    return (
        (series.rank(pct=True) * 99)
        .fillna(0)
        .round()
        .astype(int)
        .clip(1, 99)
    )

df_today["rank_weighted"] = calc_rank_single_day(df_today["score_weighted"])
df_today["rank_3m"] = calc_rank_single_day(df_today["ret_3m"])
df_today["rank_6m"] = calc_rank_single_day(df_today["ret_6m"])
df_today["rank_12m"] = calc_rank_single_day(df_today["ret_12m"])

print("4. DB 업로드 시작...")

df_today = df_today.fillna(0)
df_today = df_today.drop_duplicates(subset=["code"], keep="first")

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
        supabase.table("rs_rankings_v2").upsert(
            chunk, on_conflict="date, code"
        ).execute()
        print(f"   [{i // chunk_size + 1}/{total_chunks}] 업로드 완료")
    except Exception as e:
        print(f"   업로드 실패: {e}")
        time.sleep(1)

print("\n당일 RS 계산 및 업로드 완료!")
