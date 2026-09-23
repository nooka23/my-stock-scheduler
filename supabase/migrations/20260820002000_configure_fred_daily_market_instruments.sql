-- FRED supplies the two KIS-unavailable daily series below without changing
-- their market meaning: US 2Y Treasury constant-maturity yield and WTI spot.
-- Gold remains disabled because the formerly available FRED LBMA gold series
-- is no longer a current, live series; it must get its own verified provider.

update market_data.market_instruments
set
  provider = 'FRED',
  provider_symbol = case internal_code
    when 'US_RATE_2Y' then 'DGS2'
    when 'COMMODITY_WTI' then 'DCOILWTICO'
  end,
  provider_params = case internal_code
    when 'US_RATE_2Y' then jsonb_build_object(
      'collector', 'fred_graph_csv',
      'series_id', 'DGS2',
      'frequency', 'daily',
      'unit', 'percent',
      'source_url', 'https://fred.stlouisfed.org/series/DGS2'
    )
    when 'COMMODITY_WTI' then jsonb_build_object(
      'collector', 'fred_graph_csv',
      'series_id', 'DCOILWTICO',
      'frequency', 'daily',
      'unit', 'usd_per_barrel',
      'series_kind', 'spot',
      'source_url', 'https://fred.stlouisfed.org/series/DCOILWTICO'
    )
  end,
  display_name = case internal_code
    when 'US_RATE_2Y' then 'US 2Y Treasury Yield'
    when 'COMMODITY_WTI' then 'WTI Crude Oil (Cushing spot)'
  end,
  exchange = case internal_code
    when 'US_RATE_2Y' then 'OTC'
    when 'COMMODITY_WTI' then 'CUSHING'
  end,
  currency = case internal_code
    when 'US_RATE_2Y' then 'PCT'
    when 'COMMODITY_WTI' then 'USD'
  end,
  is_enabled = true,
  metadata = (
    metadata
      - 'requires_provider_symbol_verification'
      - 'collection_status'
      - 'verification_note'
      - 'verified_at'
  ) || jsonb_build_object(
    'collection_status', 'verified_secondary_provider',
    'provider_verification_note', 'FRED daily series verified on 2026-08-20.',
    'verified_at', '2026-08-20'
  ),
  updated_at = now()
where internal_code in ('US_RATE_2Y', 'COMMODITY_WTI');

-- The value is a yield, not a dollar amount. Keep this display metadata
-- consistent for the KIS-fed US 10Y series as well.
update market_data.market_instruments
set
  currency = 'PCT',
  metadata = metadata || jsonb_build_object('unit', 'percent'),
  updated_at = now()
where internal_code = 'US_RATE_10Y';
