create or replace function public.get_weekly_rank_risers(base_date date)
returns table (
  code text,
  name text,
  current_rank int,
  prev_rank int,
  rank_diff int,
  total_value numeric
)
language plpgsql
as $$
declare
  v_prev_date date;
begin
  -- 1. 기준일(base_date)로부터 7일 전(또는 그 이전 가장 최근) 데이터가 있는 날짜 찾기
  select max(date) into v_prev_date
  from trading_value_rankings
  where date <= base_date - interval '7 days';

  if v_prev_date is null then
    return;
  end if;

  -- 2. 현재 날짜와 과거 날짜의 rank_amount_60 차이를 계산하여 상위 종목 반환
  return query
  select 
    t1.code,
    c.name,
    t1.rank_amount_60 as current_rank,
    t2.rank_amount_60 as prev_rank,
    (t1.rank_amount_60 - t2.rank_amount_60) as rank_diff,
    (t1.avg_amount_60 * 60) as total_value
  from trading_value_rankings t1
  join trading_value_rankings t2 on t1.code = t2.code and t2.date = v_prev_date
  left join companies c on t1.code = c.code
  where t1.date = base_date
  and t1.rank_amount_60 is not null
  and t2.rank_amount_60 is not null
  and (t1.rank_amount_60 - t2.rank_amount_60) > 0 -- 상승한 종목만
  order by (t1.rank_amount_60 - t2.rank_amount_60) desc, t1.avg_amount_60 desc
  limit 200;
end;
$$;
