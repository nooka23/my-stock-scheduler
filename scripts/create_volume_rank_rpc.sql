-- 기존 함수가 있다면 삭제 (충돌 방지)
drop function if exists public.get_volume_rank_60d;

-- 최근 60거래일 합산 거래대금 상위 종목 추출 함수
create or replace function public.get_volume_rank_60d(min_amount bigint default 0)
returns table (
  code text,
  total_value numeric
)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_start_date date;
begin
  -- 1. 최근 60거래일 중 가장 과거 날짜(시작일)를 구합니다.
  --    KOSPI 데이터를 기준으로 날짜를 계산하여 속도를 최적화합니다.
  select min(sub.date) into v_start_date
  from (
    select date
    from daily_prices_v2
    where code = 'KOSPI'
    order by date desc
    limit 60
  ) as sub;

  -- 2. 시작일 이후의 데이터를 종목별로 그룹화하여 거래대금 합계를 구합니다.
  return query
  select 
    dp.code,
    sum(dp.trading_value) as total_value
  from daily_prices_v2 dp
  where dp.date >= v_start_date
  group by dp.code
  having sum(dp.trading_value) >= min_amount
  order by total_value desc;
end;
$$;
