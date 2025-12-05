-- 1. 주가 데이터 통합 테이블 (v2)
create table if not exists public.daily_prices_v2 (
  code text not null, -- 종목코드
  date date not null, -- 날짜 (date 타입 사용)
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric, -- 거래량
  change numeric, -- 등락률 (검증용)
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- 복합 기본키 (종목+날짜는 유니크)
  primary key (code, date)
);

-- 조회 속도를 위한 인덱스
create index if not exists idx_daily_prices_v2_date on public.daily_prices_v2 (date desc);
create index if not exists idx_daily_prices_v2_code_date on public.daily_prices_v2 (code, date desc);

-- 2. RS 랭킹 테이블 (v2) - 다중 RS 지표 저장
-- 기존 테이블이 있다면 삭제 후 재생성 (컬럼 변경)
drop table if exists public.rs_rankings_v2;

create table public.rs_rankings_v2 (
  date date not null,
  code text not null,
  
  -- 1. 가중 RS (기존 방식)
  score_weighted numeric,
  rank_weighted integer,
  
  -- 2. 3개월 RS
  score_3m numeric,
  rank_3m integer,
  
  -- 3. 6개월 RS
  score_6m numeric,
  rank_6m integer,
  
  -- 4. 12개월 RS
  score_12m numeric,
  rank_12m integer,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,

  primary key (date, code)
);

create index if not exists idx_rs_rankings_v2_date on public.rs_rankings_v2 (date desc);

-- RLS 설정 (일단 읽기 허용)
alter table public.daily_prices_v2 enable row level security;
drop policy if exists "Public read access" on public.daily_prices_v2;
create policy "Public read access" on public.daily_prices_v2 for select using (true);

alter table public.rs_rankings_v2 enable row level security;
drop policy if exists "Public read access" on public.rs_rankings_v2;
create policy "Public read access" on public.rs_rankings_v2 for select using (true);