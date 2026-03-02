update daily_prices_v2
set market_cap = null
where market_cap is not null;
