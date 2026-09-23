# US common-stock daily data

The US collector is separate from the Korean `public.daily_prices_v2` and
does not feed the Korean RS jobs.

## Data source

The universe is still built from the reference data in
`collect_us_equity_massive.py`: US-listed common stocks (`type=CS`) on NASDAQ,
NYSE, and NYSE American. ETFs and OTC symbols are excluded by the universe
filter. Daily OHLCV is collected by `collect_us_equity_kis.py` through KIS and
stored in the separate `market_data.us_daily_prices` table with source
`KIS_OVERSEAS_DAILYPRICE`.

## Initial load and daily schedule

Run the two-year KIS backfill manually:

```bash
python scripts/collect_us_equity_kis.py --lookback-days 730
```

The local LaunchAgent starts Tuesday-Saturday at 06:10 KST (the Mac must use
Asia/Seoul time) and runs `collect_us_equity_kis.py`. It uses the previous
Korean calendar date as the requested session date. This is 10 minutes after
the US close during standard time and about 70 minutes after the close during
US daylight time, making it the safest single fixed KST time year-round.
KIS returns the latest available rows when the requested date is a US holiday.
The historical US equity rows are now KIS-only. The Massive collector remains
available for a separately requested repair or universe refresh, but its old
rows are not kept in `us_daily_prices`.

After the KIS collection succeeds, the same close-based RS formula used by the
Korean chart is calculated separately by `calculate_us_rs.py` and written to
`market_data.us_equity_rs_rankings`. It is not included in Korean RS analysis.
The scheduled job therefore updates both US prices and US RS in sequence.

Required secrets are `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `KIS_APP_KEY`, and `KIS_APP_SECRET`.

The KIS token is cached at
`~/Library/Application Support/my-stock-scheduler/kis-token.json` with a file
lock and atomic writes. The US 06:10 process and Korean 15:35 process share
this cache, so the Korean job reuses the morning token while it remains valid.
Set `KIS_TOKEN_CACHE_PATH` only if a different local cache location is needed.

The manual Massive collector defaults to a 12.5-second request interval so the free
five-requests-per-minute plan can be used safely. If the account has a higher
limit, set `MASSIVE_API_MIN_INTERVAL_SECONDS` in `.env.local` to a lower value.

Massive `trading_value` is estimated as `close * volume`; KIS uses `tamt`.
`market_cap` is
nullable because the grouped daily endpoint does not provide a per-ticker
market-cap snapshot; it can be added later as a separate reference-data job.
