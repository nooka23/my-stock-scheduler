create or replace view public.recent_listing_returns
with (security_invoker = true) as
with latest_market as (
  select max(date) as date
  from public.daily_prices_v2
  where code in ('KOSPI', 'KOSDAQ', 'KS11', 'KQ11')
), eligible_prices as (
  select
    c.code,
    c.name,
    c.marcap,
    first_price.date as listing_date,
    first_price.close as listing_close,
    latest_price.date as latest_date,
    latest_price.close as latest_close
  from public.companies c
  cross join latest_market market
  cross join lateral (
    select p.date, p.close
    from public.daily_prices_v2 p
    where p.code = c.code
      and p.close is not null
      and p.close > 0
    order by p.date asc
    limit 1
  ) first_price
  cross join lateral (
    select p.date, p.close
    from public.daily_prices_v2 p
    where p.code = c.code
      and p.date <= market.date
      and p.close is not null
      and p.close > 0
    order by p.date desc
    limit 1
  ) latest_price
  where c.is_rs_eligible = true
    and first_price.date > market.date - interval '1 year'
)
select
  code,
  name,
  marcap,
  listing_date,
  listing_close,
  latest_date,
  latest_close,
  round(((latest_close - listing_close) / listing_close * 100)::numeric, 2) as return_since_listing,
  (latest_date - listing_date) as listed_days
from eligible_prices;

comment on view public.recent_listing_returns is
  'RS 및 차트 검토 종목 수 제한과 무관한 상장 1년 이내 보통주의 상장 후 수익률';

grant select on public.recent_listing_returns to anon, authenticated, service_role;
