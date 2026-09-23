-- The KIS US market-cap response (tomv) was cross-checked on 2026-08-20:
-- tomv = last (USD) * shar for NVDA, confirming the returned unit is USD.

update market_data.us_equity_rankings
set market_cap_unit = 'USD'
where source = 'KIS_OVERSEAS_RANKING'
  and ranking_type = 'MARKET_CAP'
  and currency = 'USD'
  and market_cap_raw is not null;

comment on column market_data.us_equity_rankings.market_cap_raw is
  'KIS tomv field in the source market currency. For US ranking endpoints it was verified as USD on 2026-08-20 by equality with last * shar.';

comment on view market_data.v_us_top_market_cap is
  'Top 20 KIS market-cap ranks per US exchange from the latest successful or partial attempt. Market-cap values are KIS tomv values, verified as USD for US endpoints.';
