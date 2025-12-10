-- 거래대금 급증 종목 추출 함수
-- 조건 1: 50일 평균 거래대금 상위 40% 이내
-- 조건 2: 20일 평균 > 50일 평균 * 1.5
create or replace function public.get_volume_momentum_rank(
  min_ratio numeric default 1.5,
  top_percent numeric default 0.4 -- 상위 40%
)
returns table (
  code text,
  avg_20d numeric,
  avg_50d numeric,
  ratio numeric
)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_date_50d date;
  v_date_20d date;
begin
  -- 1. 기준 날짜 계산 (KOSPI 기준)
  select min(d.date) into v_date_50d
  from (select date from daily_prices_v2 where code='KOSPI' order by date desc limit 50) d;
  
  select min(d.date) into v_date_20d
  from (select date from daily_prices_v2 where code='KOSPI' order by date desc limit 20) d;

  return query
  with data_50d as (
      select 
        dp.code,
        dp.date,
        dp.trading_value
      from daily_prices_v2 dp
      where dp.date >= v_date_50d
  ),
  stats as (
      select 
        d.code,
        avg(case when d.date >= v_date_20d then d.trading_value else null end) as val_20,
        avg(d.trading_value) as val_50
      from data_50d d
      group by d.code
  ),
  ranked_stats as (
      select 
        s.*,
        percent_rank() over (order by s.val_50 desc) as pr
      from stats s
      where s.val_50 > 0
  )
  select 
    rs.code,
    coalesce(rs.val_20, 0) as avg_20d,
    coalesce(rs.val_50, 0) as avg_50d,
    (coalesce(rs.val_20, 0) / nullif(rs.val_50, 0)) as ratio
  from ranked_stats rs
  where rs.pr <= top_percent  -- 상위 40% 이내 (0 ~ 0.4)
    and (coalesce(rs.val_20, 0) / rs.val_50) >= min_ratio
  order by ratio desc;
end;
$$;
