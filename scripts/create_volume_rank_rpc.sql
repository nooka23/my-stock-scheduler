-- 최근 60거래일 합산 거래대금 상위 종목 추출 함수
-- 사용법: select * from get_volume_rank_60d(2000000000000); -- 2조원 이상

create or replace function public.get_volume_rank_60d(min_amount bigint default 2000000000000)
returns table (
  code text,
  total_value numeric
)
language plpgsql
as $$
declare
  start_date date;
begin
  -- 1. 최근 60거래일 중 가장 과거 날짜(시작일)를 구합니다.
  --    (거래일이 60일 미만인 경우 있는 만큼만 계산됨)
  select min(d.date) into start_date
  from (
    select distinct date
    from daily_prices_v2
    order by date desc
    limit 60
  ) as d;

  -- 2. 시작일 이후의 데이터를 종목별로 그룹화하여 거래대금 합계를 구하고, 
  --    기준금액(min_amount) 이상인 것만 내림차순으로 반환합니다.
  return query
  select 
    dp.code,
    sum(dp.trading_value) as total_value
  from daily_prices_v2 dp
  where dp.date >= start_date
  group by dp.code
  having sum(dp.trading_value) >= min_amount
  order by total_value desc;
end;
$$;
