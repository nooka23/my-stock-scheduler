-- Separate relative-strength snapshots for the US common-stock universe.
-- This table intentionally does not participate in Korean RS calculations.

create table if not exists market_data.us_equity_rs_rankings (
  date date not null,
  ticker text not null,
  score_weighted numeric,
  rank_weighted integer,
  score_3m numeric,
  rank_3m integer,
  score_6m numeric,
  rank_6m integer,
  score_12m numeric,
  rank_12m integer,
  calculation_version text not null default 'weighted_3_6_9_12m_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (date, ticker),
  check (rank_weighted is null or rank_weighted between 1 and 99),
  check (rank_3m is null or rank_3m between 1 and 99),
  check (rank_6m is null or rank_6m between 1 and 99),
  check (rank_12m is null or rank_12m between 1 and 99)
);

comment on table market_data.us_equity_rs_rankings is
  'Daily US common-stock RS rankings. Kept separate from public.rs_rankings_v2 and Korean RS jobs.';

create index if not exists us_equity_rs_rankings_date_rank_idx
  on market_data.us_equity_rs_rankings (date desc, rank_weighted);
create index if not exists us_equity_rs_rankings_ticker_date_idx
  on market_data.us_equity_rs_rankings (ticker, date desc);

alter table market_data.us_equity_rs_rankings enable row level security;
drop policy if exists us_equity_rs_rankings_public_read
  on market_data.us_equity_rs_rankings;
create policy us_equity_rs_rankings_public_read
  on market_data.us_equity_rs_rankings for select
  to anon, authenticated using (true);

grant select on market_data.us_equity_rs_rankings to anon, authenticated;
grant all on market_data.us_equity_rs_rankings to service_role;
