alter table leader_stocks_daily
  add column if not exists trading_value numeric(20, 2);
