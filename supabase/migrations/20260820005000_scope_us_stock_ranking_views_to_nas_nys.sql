-- AMEX ranking leaders are mainly ETFs. Preserve all raw exchange snapshots
-- for audit, but restrict the shared US-stock briefing views to NASDAQ/NYSE.

create or replace view market_data.v_us_top_market_cap
with (security_invoker = true) as
with latest_attempt as (
  select id, status, started_at, completed_at
  from market_data.data_ingestion_runs
  where pipeline_key = 'us_equity_rankings'
    and source = 'KIS_OVERSEAS_RANKING'
  order by started_at desc
  limit 1
)
select
  r.brief_date,
  r.session,
  r.observed_at,
  r.exchange,
  r.rank,
  r.symbol,
  r.display_name,
  r.price,
  r.change_value,
  r.change_pct,
  r.volume,
  r.trading_value,
  r.shares_outstanding,
  r.market_cap_raw,
  r.market_cap_unit,
  r.currency,
  r.source,
  a.status as run_status,
  a.started_at as run_started_at,
  a.completed_at as run_completed_at,
  case when a.status = 'SUCCEEDED' then 'fresh' else 'partial' end as quality_status
from latest_attempt a
join market_data.us_equity_rankings r on r.run_id = a.id
where a.status in ('SUCCEEDED', 'PARTIAL')
  and r.ranking_type = 'MARKET_CAP'
  and r.exchange in ('NAS', 'NYS')
  and r.rank <= 20
order by r.exchange, r.rank;

comment on view market_data.v_us_top_market_cap is
  'Top 20 KIS market-cap ranks per NASDAQ/NYSE exchange from the latest successful or partial attempt. Market-cap values are KIS tomv values, verified as USD for US endpoints.';

create or replace view market_data.v_us_featured_candidates
with (security_invoker = true) as
with latest_attempt as (
  select id, status, started_at, completed_at
  from market_data.data_ingestion_runs
  where pipeline_key = 'us_equity_rankings'
    and source = 'KIS_OVERSEAS_RANKING'
  order by started_at desc
  limit 1
), current_rankings as (
  select r.*, a.status, a.started_at, a.completed_at
  from latest_attempt a
  join market_data.us_equity_rankings r on r.run_id = a.id
  where a.status in ('SUCCEEDED', 'PARTIAL')
    and r.exchange in ('NAS', 'NYS')
    and r.ranking_type in (
      'UPDOWN_GAINER', 'UPDOWN_LOSER', 'TRADE_VOLUME', 'TRADE_VALUE'
    )
    and r.rank <= 20
)
select
  brief_date,
  session,
  observed_at,
  exchange,
  symbol,
  max(display_name) as display_name,
  array_agg(ranking_type order by ranking_type, rank) as candidate_signals,
  jsonb_agg(
    jsonb_build_object(
      'ranking_type', ranking_type,
      'rank', rank,
      'price', price,
      'change_value', change_value,
      'change_pct', change_pct,
      'volume', volume,
      'trading_value', trading_value,
      'average_volume', average_volume,
      'average_trading_value', average_trading_value,
      'currency', currency,
      'source', source
    ) order by ranking_type, rank
  ) as signal_details,
  max(status) as run_status,
  max(started_at) as run_started_at,
  max(completed_at) as run_completed_at,
  case when max(status) = 'SUCCEEDED' then 'fresh' else 'partial' end as quality_status
from current_rankings
group by brief_date, session, observed_at, exchange, symbol;

comment on view market_data.v_us_featured_candidates is
  'Source-ranked NASDAQ/NYSE featured-stock candidates. This is a transparent union of top-20 gainers, losers, volume ranks, and value ranks; it is not a trading recommendation.';
