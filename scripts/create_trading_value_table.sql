-- 1. 거래대금 랭킹 테이블 생성
create table if not exists public.trading_value_rankings (
  date date not null,
  code text not null,
  avg_amount_50 numeric, -- 50일 평균 거래대금
  rank_amount integer,   -- 순위 (0~99)
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  primary key (date, code)
);

create index if not exists idx_trading_value_rankings_date on public.trading_value_rankings (date desc);

-- RLS 설정
alter table public.trading_value_rankings enable row level security;
drop policy if exists "Public read access" on public.trading_value_rankings;
create policy "Public read access" on public.trading_value_rankings for select using (true);


-- 2. 뷰 생성 (RS 랭킹 + 거래대금 랭킹 조인)
-- 프론트엔드에서 편하게 조회하기 위해 View를 만듭니다.
create or replace view public.rs_rankings_with_volume as
select 
  r.date,
  r.code,
  r.score_weighted,
  r.rank_weighted,
  r.score_3m,
  r.rank_3m,
  r.score_6m,
  r.rank_6m,
  r.score_12m,
  r.rank_12m,
  t.avg_amount_50,
  t.rank_amount
from rs_rankings_v2 r
left join trading_value_rankings t on r.date = t.date and r.code = t.code;
