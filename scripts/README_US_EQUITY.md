# US common-stock daily data

The US collector is separate from the Korean `public.daily_prices_v2` and
does not feed the Korean RS jobs.

## Data source

`collect_us_equity_massive.py` uses Massive's reference ticker API to build an
active universe of US-listed common stocks (`type=CS`) on NASDAQ, NYSE, and
NYSE American. The daily grouped aggregate endpoint then supplies OHLCV for
all US stocks for a requested trading date. ETFs and OTC symbols are excluded
by the universe filter.

## Initial load and daily schedule

Run the initial one-year load manually:

```bash
python scripts/collect_us_equity_massive.py --lookback-days 365
```

The GitHub Actions workflow runs at 06:10 KST and uses a three-day lookback
to cover weekends, holidays, and late corrections. It can also be dispatched
manually with `lookback_days=365` when a one-year reload is needed.

Required secrets are `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `MASSIVE_API_KEY`.

The collector defaults to a 12.5-second request interval so the free
five-requests-per-minute plan can be used safely. If the account has a higher
limit, set `MASSIVE_API_MIN_INTERVAL_SECONDS` in `.env.local` to a lower value.

`trading_value` is stored as the estimated `close * volume`. `market_cap` is
nullable because the grouped daily endpoint does not provide a per-ticker
market-cap snapshot; it can be added later as a separate reference-data job.
