create table if not exists public.market_breadth_daily (
  date date primary key,
  universe_size integer not null,
  wma150_eligible_count integer not null,
  above_wma150_count integer not null,
  above_wma150_ratio numeric(7, 4) not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint market_breadth_daily_universe_size_check
    check (universe_size >= 0 and universe_size <= 400),
  constraint market_breadth_daily_eligible_count_check
    check (wma150_eligible_count >= 0 and wma150_eligible_count <= universe_size),
  constraint market_breadth_daily_above_count_check
    check (above_wma150_count >= 0 and above_wma150_count <= wma150_eligible_count),
  constraint market_breadth_daily_ratio_check
    check (above_wma150_ratio >= 0 and above_wma150_ratio <= 1)
);

comment on table public.market_breadth_daily is
  'Daily breadth of the contemporaneous top 400 RS stocks above their 150-day weighted moving average.';

comment on column public.market_breadth_daily.universe_size is
  'Number of contemporaneous RS leaders selected for the date; normally 400.';

comment on column public.market_breadth_daily.wma150_eligible_count is
  'Selected RS leaders with 150 valid daily closes and a close on the measurement date.';

comment on column public.market_breadth_daily.above_wma150_count is
  'WMA150-eligible RS leaders whose close is strictly greater than WMA150.';

comment on column public.market_breadth_daily.above_wma150_ratio is
  'above_wma150_count divided by wma150_eligible_count.';

create index if not exists idx_market_breadth_daily_date_desc
  on public.market_breadth_daily (date desc);

create or replace function public.refresh_market_breadth_daily(
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'p_start_date and p_end_date are required';
  end if;

  if p_start_date > p_end_date then
    raise exception 'p_start_date must be on or before p_end_date';
  end if;

  with ranked_rs as (
    select
      r.date,
      r.code,
      row_number() over (
        partition by r.date
        order by
          r.rank_weighted desc nulls last,
          r.score_weighted desc nulls last,
          r.code asc
      ) as rs_position
    from public.rs_rankings_v2 r
    where r.date between p_start_date and p_end_date
      and r.code not in ('KOSPI', 'KOSDAQ', 'KS11', 'KQ11')
  ),
  top_rs as (
    select date, code
    from ranked_rs
    where rs_position <= 400
  ),
  target_codes as (
    select distinct code
    from top_rs
  ),
  price_ranked as (
    select
      p.code,
      p.date,
      p.close,
      row_number() over (
        partition by p.code
        order by p.date asc
      ) as price_position
    from public.daily_prices_v2 p
    join target_codes c on c.code = p.code
    where p.date >= (p_start_date - interval '400 days')::date
      and p.date <= p_end_date
      and p.close is not null
  ),
  price_wma as (
    select
      code,
      date,
      close,
      count(*) over price_window as close_count,
      (
        sum(close * price_position) over price_window
        - (price_position - 150) * sum(close) over price_window
      ) / 11325.0 as wma150
    from price_ranked
    window price_window as (
      partition by code
      order by date asc
      rows between 149 preceding and current row
    )
  ),
  daily_counts as (
    select
      rs.date,
      count(*)::integer as universe_size,
      count(*) filter (where price.close_count = 150)::integer as wma150_eligible_count,
      count(*) filter (
        where price.close_count = 150
          and price.close > price.wma150
      )::integer as above_wma150_count
    from top_rs rs
    left join price_wma price
      on price.code = rs.code
      and price.date = rs.date
    group by rs.date
  )
  insert into public.market_breadth_daily (
    date,
    universe_size,
    wma150_eligible_count,
    above_wma150_count,
    above_wma150_ratio,
    updated_at
  )
  select
    date,
    universe_size,
    wma150_eligible_count,
    above_wma150_count,
    case
      when wma150_eligible_count = 0 then 0
      else round(above_wma150_count::numeric / wma150_eligible_count, 4)
    end,
    timezone('utc', now())
  from daily_counts
  on conflict (date) do update
    set universe_size = excluded.universe_size,
        wma150_eligible_count = excluded.wma150_eligible_count,
        above_wma150_count = excluded.above_wma150_count,
        above_wma150_ratio = excluded.above_wma150_ratio,
        updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.refresh_market_breadth_daily(date, date) from public;
grant execute on function public.refresh_market_breadth_daily(date, date) to service_role;

alter table public.market_breadth_daily enable row level security;

create policy "Public read access for market breadth"
  on public.market_breadth_daily
  for select
  to anon, authenticated
  using (true);

grant select on table public.market_breadth_daily to anon, authenticated;
grant all on table public.market_breadth_daily to service_role;
