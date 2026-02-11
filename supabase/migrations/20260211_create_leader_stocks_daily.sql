create table if not exists leader_stocks_daily (
  date date not null,
  code text not null,
  leader_score numeric(12, 4) not null,
  ret_1d numeric(12, 4),
  ret_rank integer,
  rank_amount_60 integer,
  rank_rs integer,
  created_at timestamptz default now(),
  primary key (date, code)
);

create index if not exists idx_leader_stocks_daily_date_score
  on leader_stocks_daily (date desc, leader_score desc);

alter table leader_stocks_daily enable row level security;

drop policy if exists "Public read access" on leader_stocks_daily;
create policy "Public read access" on leader_stocks_daily
  for select using (true);
