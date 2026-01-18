create or replace function public.get_high_return_rankings(
  start_date date,
  end_date date,
  min_return numeric default 100,
  limit_n integer default 100
)
returns table (
  code text,
  name text,
  base_date date,
  base_price numeric,
  max_price numeric,
  return_rate numeric
)
language sql
stable
as $$
  with base as (
    select
      code,
      date,
      close,
      high,
      max(high) over (
        partition by code
        order by date
        rows between 1 following and 252 following
      ) as max_high_1y
    from daily_prices_v2
    where date between start_date and end_date
      and close > 0
  ),
  scored as (
    select
      code,
      date as base_date,
      close as base_price,
      max_high_1y as max_price,
      (max_high_1y - close) / close * 100 as return_rate
    from base
    where max_high_1y is not null
  ),
  ranked as (
    select distinct on (code)
      code,
      base_date,
      base_price,
      max_price,
      return_rate
    from scored
    where return_rate >= min_return
    order by code, return_rate desc
  )
  select
    r.code,
    c.name,
    r.base_date,
    r.base_price,
    r.max_price,
    r.return_rate
  from ranked r
  join companies c on c.code = r.code
  order by r.return_rate desc
  limit limit_n;
$$;
