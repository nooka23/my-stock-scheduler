create or replace function public.get_fresh_demand_candidates(
  p_target_date date default null,
  p_limit integer default 120
)
returns table (
  target_date date,
  code text,
  name text,
  close numeric,
  market_cap numeric,
  rs_rating integer,
  rs_change_3d integer,
  ret_1d numeric,
  ret_3d numeric,
  relative_volume_20 numeric,
  trading_value numeric,
  distance_to_high_20 numeric,
  is_breakout_20 boolean,
  signal_stage text,
  signal_score numeric
)
language sql
stable
set search_path = public
as $$
  with target as (
    select coalesce(
      p_target_date,
      least(
        (select max(d.date) from public.daily_prices_v2 d),
        (select max(r.date) from public.rs_rankings_v2 r)
      )
    ) as target_date
  ),
  price_metrics as (
    select
      d.code,
      d.date,
      d.close,
      d.high,
      d.volume,
      d.trading_value,
      d.market_cap,
      lag(d.close, 1) over (partition by d.code order by d.date) as prev_close,
      lag(d.close, 3) over (partition by d.code order by d.date) as close_3d,
      avg(d.volume) over (
        partition by d.code order by d.date rows between 20 preceding and 1 preceding
      ) as avg_volume_20,
      max(d.high) over (
        partition by d.code order by d.date rows between 20 preceding and 1 preceding
      ) as high_20
    from public.daily_prices_v2 d
    cross join target t
    where d.date between (t.target_date - interval '100 days')::date and t.target_date
  ),
  rs_metrics as (
    select
      r.code,
      r.date,
      r.rank_weighted,
      lag(r.rank_weighted, 3) over (partition by r.code order by r.date) as rs_3d
    from public.rs_rankings_v2 r
    cross join target t
    where r.date between (t.target_date - interval '30 days')::date and t.target_date
  ),
  latest as (
    select
      t.target_date,
      p.code,
      p.close,
      coalesce(p.market_cap, c.marcap) as market_cap,
      p.trading_value,
      r.rank_weighted as rs_rating,
      coalesce(r.rank_weighted - r.rs_3d, 0) as rs_change_3d,
      100 * (p.close / nullif(p.prev_close, 0) - 1) as ret_1d,
      100 * (p.close / nullif(p.close_3d, 0) - 1) as ret_3d,
      p.volume / nullif(p.avg_volume_20, 0) as relative_volume_20,
      100 * (p.close / nullif(p.high_20, 0) - 1) as distance_to_high_20,
      p.close >= p.high_20 as is_breakout_20,
      c.name
    from price_metrics p
    join target t on p.date = t.target_date
    join public.companies c on c.code = p.code
    left join rs_metrics r on r.code = p.code and r.date = p.date
    where r.rank_weighted is not null
  ),
  screened as (
    select
      l.*,
      case
        when l.trading_value >= 1000000000
          and l.relative_volume_20 >= 2
          and (l.ret_1d >= 8 or l.is_breakout_20)
          then '확인'
        else '탐색'
      end as signal_stage,
      (
        least(greatest(l.ret_1d, 0), 30) * 1.2
        + least(greatest(l.ret_3d, 0), 50) * 0.5
        + least(greatest(l.relative_volume_20, 0), 10) * 4
        + least(greatest(l.rs_change_3d, 0), 30) * 0.4
        + case when l.is_breakout_20 then 10 else 0 end
        + case when l.trading_value >= 1000000000 then 8 else 0 end
      ) as signal_score
    from latest l
    where
      (
        l.ret_1d >= 8
        and l.relative_volume_20 >= 1.8
        and l.trading_value >= 100000000
      )
      or (
        l.ret_3d >= 12
        and l.relative_volume_20 >= 1.3
        and l.trading_value >= 100000000
      )
      or (
        l.is_breakout_20
        and l.ret_1d >= 3
        and l.relative_volume_20 >= 1.5
        and l.trading_value >= 500000000
      )
  )
  select
    s.target_date,
    s.code,
    s.name,
    s.close,
    s.market_cap,
    s.rs_rating,
    s.rs_change_3d,
    round(s.ret_1d, 2),
    round(s.ret_3d, 2),
    round(s.relative_volume_20, 2),
    s.trading_value,
    round(s.distance_to_high_20, 2),
    s.is_breakout_20,
    s.signal_stage,
    round(s.signal_score, 2)
  from screened s
  order by
    case when s.signal_stage = '확인' then 0 else 1 end,
    s.signal_score desc,
    s.trading_value desc
  limit least(greatest(coalesce(p_limit, 120), 1), 300);
$$;

comment on function public.get_fresh_demand_candidates(date, integer) is
  'Finds low-latency demand signals from one/three-day returns, relative volume, trading value, breakout status, and short RS acceleration.';

grant execute on function public.get_fresh_demand_candidates(date, integer) to anon, authenticated, service_role;


create or replace function public.get_theme_relay_candidates(
  p_target_date date default null,
  p_limit integer default 120
)
returns table (
  target_date date,
  theme_name text,
  theme_ret_1d numeric,
  theme_ret_5d numeric,
  theme_rank_1d bigint,
  theme_rank_5d bigint,
  leader_code text,
  leader_name text,
  leader_ret_5d numeric,
  code text,
  name text,
  close numeric,
  market_cap numeric,
  rs_rating integer,
  rank_amount_60 integer,
  ret_1d numeric,
  ret_5d numeric,
  relative_volume_20 numeric,
  trading_value numeric,
  distance_to_high_20 numeric,
  distance_to_ma_20 numeric,
  relay_score numeric
)
language sql
stable
set search_path = public
as $$
  with target as (
    select coalesce(
      p_target_date,
      least(
        (select max(d.date) from public.daily_prices_v2 d),
        (select max(r.date) from public.rs_rankings_v2 r),
        (select max(e.date) from public.equal_weight_indices e where e.index_type = 'theme')
      )
    ) as target_date
  ),
  theme_series as (
    select
      e.index_code,
      e.date,
      e.index_value,
      100 * (
        e.index_value
        / nullif(lag(e.index_value, 1) over (partition by e.index_code order by e.date), 0)
        - 1
      ) as ret_1d,
      100 * (
        e.index_value
        / nullif(lag(e.index_value, 5) over (partition by e.index_code order by e.date), 0)
        - 1
      ) as ret_5d
    from public.equal_weight_indices e
    cross join target t
    where e.index_type = 'theme'
      and e.date between (t.target_date - interval '30 days')::date and t.target_date
  ),
  theme_ranked as (
    select
      s.*,
      row_number() over (partition by s.date order by s.ret_1d desc nulls last) as rank_1d,
      row_number() over (partition by s.date order by s.ret_5d desc nulls last) as rank_5d
    from theme_series s
  ),
  hot_themes as (
    select
      tr.index_code,
      th.id as theme_id,
      th.name as theme_name,
      tr.ret_1d as theme_ret_1d,
      tr.ret_5d as theme_ret_5d,
      tr.rank_1d as theme_rank_1d,
      tr.rank_5d as theme_rank_5d
    from theme_ranked tr
    join target t on tr.date = t.target_date
    join public.themes th on th.code = tr.index_code
    where tr.rank_1d <= 30 or tr.rank_5d <= 15
  ),
  price_metrics as (
    select
      d.code,
      d.date,
      d.close,
      d.high,
      d.volume,
      d.trading_value,
      d.market_cap,
      lag(d.close, 1) over (partition by d.code order by d.date) as prev_close,
      lag(d.close, 5) over (partition by d.code order by d.date) as close_5d,
      avg(d.volume) over (
        partition by d.code order by d.date rows between 20 preceding and 1 preceding
      ) as avg_volume_20,
      avg(d.trading_value) over (
        partition by d.code order by d.date rows between 20 preceding and 1 preceding
      ) as avg_value_20,
      avg(d.close) over (
        partition by d.code order by d.date rows between 19 preceding and current row
      ) as ma_20,
      max(d.high) over (
        partition by d.code order by d.date rows between 20 preceding and 1 preceding
      ) as high_20
    from public.daily_prices_v2 d
    cross join target t
    where d.date between (t.target_date - interval '100 days')::date and t.target_date
  ),
  member_latest as (
    select
      p.*,
      100 * (p.close / nullif(p.prev_close, 0) - 1) as ret_1d,
      100 * (p.close / nullif(p.close_5d, 0) - 1) as ret_5d,
      p.volume / nullif(p.avg_volume_20, 0) as relative_volume_20,
      100 * (p.close / nullif(p.high_20, 0) - 1) as distance_to_high_20,
      100 * (p.close / nullif(p.ma_20, 0) - 1) as distance_to_ma_20
    from price_metrics p
    join target t on p.date = t.target_date
  ),
  theme_members as (
    select
      t.target_date,
      h.theme_id,
      h.theme_name,
      h.theme_ret_1d,
      h.theme_ret_5d,
      h.theme_rank_1d,
      h.theme_rank_5d,
      ct.company_code,
      c.name,
      m.close,
      coalesce(m.market_cap, c.marcap) as market_cap,
      r.rank_weighted as rs_rating,
      tvr.rank_amount_60,
      m.ret_1d,
      m.ret_5d,
      m.relative_volume_20,
      m.trading_value,
      m.avg_value_20,
      m.distance_to_high_20,
      m.distance_to_ma_20,
      row_number() over (
        partition by h.theme_id
        order by m.ret_5d desc nulls last, m.trading_value desc nulls last
      ) as leader_order
    from hot_themes h
    cross join target t
    join public.company_themes ct on ct.theme_id = h.theme_id
    join member_latest m on m.code = ct.company_code
    join public.companies c on c.code = m.code
    left join public.rs_rankings_v2 r on r.code = m.code and r.date = t.target_date
    left join public.trading_value_rankings tvr on tvr.code = m.code and tvr.date = t.target_date
  ),
  leaders as (
    select
      tm.theme_id,
      tm.company_code as leader_code,
      tm.name as leader_name,
      tm.ret_5d as leader_ret_5d
    from theme_members tm
    where tm.leader_order = 1
  ),
  candidates as (
    select
      tm.*,
      l.leader_code,
      l.leader_name,
      l.leader_ret_5d,
      (
        greatest(31 - tm.theme_rank_1d, 0) * 0.5
        + greatest(16 - tm.theme_rank_5d, 0) * 1.2
        + least(greatest(l.leader_ret_5d, 0), 50) * 0.4
        + least(greatest(tm.ret_5d, 0), 30) * 0.5
        + greatest(10 - abs(tm.distance_to_high_20), 0) * 1.2
        + coalesce(tm.rs_rating, 0) * 0.1
      ) as relay_score
    from theme_members tm
    join leaders l on l.theme_id = tm.theme_id
    where tm.company_code <> l.leader_code
      and tm.rs_rating between 50 and 85
      and tm.ret_5d >= 0
      and tm.distance_to_high_20 between -10 and 3
      and tm.distance_to_ma_20 between -5 and 15
      and (tm.trading_value >= 300000000 or tm.avg_value_20 >= 300000000)
      and l.leader_ret_5d >= 10
  ),
  deduplicated as (
    select
      c.*,
      row_number() over (
        partition by c.company_code
        order by c.relay_score desc, c.theme_rank_5d, c.theme_rank_1d
      ) as stock_pick
    from candidates c
  )
  select
    d.target_date,
    d.theme_name,
    round(d.theme_ret_1d, 2),
    round(d.theme_ret_5d, 2),
    d.theme_rank_1d,
    d.theme_rank_5d,
    d.leader_code,
    d.leader_name,
    round(d.leader_ret_5d, 2),
    d.company_code,
    d.name,
    d.close,
    d.market_cap,
    d.rs_rating,
    d.rank_amount_60,
    round(d.ret_1d, 2),
    round(d.ret_5d, 2),
    round(d.relative_volume_20, 2),
    d.trading_value,
    round(d.distance_to_high_20, 2),
    round(d.distance_to_ma_20, 2),
    round(d.relay_score, 2)
  from deduplicated d
  where d.stock_pick = 1
  order by d.relay_score desc, d.theme_rank_5d, d.theme_rank_1d
  limit least(greatest(coalesce(p_limit, 120), 1), 300);
$$;

comment on function public.get_theme_relay_candidates(date, integer) is
  'Finds near-pivot laggards in themes with top-ranked one/five-day momentum and a confirmed five-day leader.';

grant execute on function public.get_theme_relay_candidates(date, integer) to anon, authenticated, service_role;
