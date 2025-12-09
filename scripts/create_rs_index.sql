-- rs_rankings_v2 테이블의 조회 성능 향상을 위한 인덱스 생성
create index if not exists idx_rs_rankings_v2_code_date 
on public.rs_rankings_v2 (code, date desc);

-- daily_prices_v2 테이블도 마찬가지로 인덱스가 필요할 수 있음
create index if not exists idx_daily_prices_v2_code_date 
on public.daily_prices_v2 (code, date desc);
