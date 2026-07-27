-- Portfolio 화면용 최신가 + ATR(20) 배치 조회.
-- 클라이언트의 종목별 순차 ATR 조회를 하나의 RPC로 대체한다.
create or replace function public.get_portfolio_market_snapshot(p_codes text[])
returns table (
  code text,
  price_date date,
  current_price numeric,
  atr20 numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested_codes as (
    select distinct code
    from unnest(coalesce(p_codes, array[]::text[])) as requested(code)
    where code is not null
      and code <> ''
  ),
  latest_21 as (
    select
      requested_codes.code,
      history.date,
      history.high,
      history.low,
      history.close
    from requested_codes
    cross join lateral (
      select date, high, low, close
      from public.daily_prices_v2
      where daily_prices_v2.code = requested_codes.code
      order by date desc
      limit 21
    ) as history
  ),
  sequenced_history as (
    select
      code,
      date,
      high,
      low,
      close,
      lag(close) over (
        partition by code
        order by date
      ) as previous_close
    from latest_21
  ),
  atr_by_code as (
    select
      code,
      case
        when count(previous_close) = 20 then avg(
          greatest(
            high - low,
            abs(high - previous_close),
            abs(low - previous_close)
          )
        )
        else null
      end as atr20
    from sequenced_history
    group by code
  ),
  latest_history as (
    select distinct on (code) code, date, close
    from latest_21
    order by code, date desc
  )
  select
    requested_codes.code,
    coalesce(latest_prices.date, latest_history.date) as price_date,
    coalesce(latest_prices.close, latest_history.close) as current_price,
    atr_by_code.atr20
  from requested_codes
  left join public.latest_prices using (code)
  left join latest_history using (code)
  left join atr_by_code using (code);
$$;

grant execute on function public.get_portfolio_market_snapshot(text[]) to authenticated;
grant execute on function public.get_portfolio_market_snapshot(text[]) to service_role;

-- 현재 포지션과 청산 이력의 필터 + 정렬을 하나의 인덱스로 처리한다.
create index if not exists idx_user_portfolio_active_user_entry_date
  on public.user_portfolio (user_id, entry_date desc)
  where is_closed is false;

create index if not exists idx_user_portfolio_user_closed_date
  on public.user_portfolio (user_id, close_date desc)
  where is_closed is true;

create index if not exists idx_user_portfolio_transactions_user_date_created
  on public.user_portfolio_transactions (user_id, transaction_date desc, created_at desc);
