alter table daily_prices_v2
  add column if not exists market_cap numeric(20, 2);

comment on column daily_prices_v2.market_cap is
  'Market capitalization snapshot captured when the daily price row is inserted';
