-- Configure only the KIS codes verified against the 2026-08-20 KIS overseas
-- index master and the live daily chart API. Unverified instruments remain
-- disabled; the morning brief must show them as missing, not as stale data.

update market_data.market_instruments
set
  provider_symbol = case internal_code
    when 'US_INDEX_SP500' then 'SPX'
    when 'US_INDEX_NASDAQ' then 'COMP'
    when 'US_INDEX_DOW' then '.DJI'
    when 'US_INDEX_SOX' then 'SOX'
    when 'US_INDEX_VIX' then 'VIX'
    when 'US_RATE_10Y' then 'Y0202'
    when 'FX_USDKRW' then 'FX@KRW'
    when 'FX_USDJPY' then 'FX@JPY'
  end,
  provider_params = jsonb_build_object(
    'collector', 'daily_chart',
    'fid_cond_mrkt_div_code', case internal_code
      when 'US_RATE_10Y' then 'I'
      when 'FX_USDKRW' then 'X'
      when 'FX_USDJPY' then 'X'
      else 'N'
    end
  ),
  is_enabled = true,
  metadata = (metadata - 'requires_provider_symbol_verification') || jsonb_build_object(
    'kis_master_verified_at', '2026-08-20',
    'kis_live_api_verified_at', '2026-08-20'
  ),
  updated_at = now()
where internal_code in (
  'US_INDEX_SP500',
  'US_INDEX_NASDAQ',
  'US_INDEX_DOW',
  'US_INDEX_SOX',
  'US_INDEX_VIX',
  'US_RATE_10Y',
  'FX_USDKRW',
  'FX_USDJPY'
);

-- KIS's current overseas index master does not contain these exact series.
-- Keep them explicitly disabled until a live provider is selected and tested.
update market_data.market_instruments
set
  is_enabled = false,
  metadata = (metadata - 'requires_provider_symbol_verification') || jsonb_build_object(
    'collection_status', 'requires_secondary_provider',
    'verification_note', case internal_code
      when 'US_INDEX_RUSSELL2000' then 'No Russell 2000 series in the KIS overseas index master as of 2026-08-20.'
      when 'US_RATE_2Y' then 'KIS overseas bond master provides US 1Y, 10Y, and 30Y; not US 2Y as of 2026-08-20.'
      when 'FX_DXY' then 'No US Dollar Index series in the KIS overseas index or FX master as of 2026-08-20.'
      when 'COMMODITY_WTI' then 'KIS commodity chart code requires separate live API verification.'
      when 'COMMODITY_GOLD' then 'KIS commodity chart code requires separate live API verification.'
      when 'COMMODITY_COPPER' then 'KIS commodity chart code requires separate live API verification.'
    end,
    'verified_at', '2026-08-20'
  ),
  updated_at = now()
where internal_code in (
  'US_INDEX_RUSSELL2000',
  'US_RATE_2Y',
  'FX_DXY',
  'COMMODITY_WTI',
  'COMMODITY_GOLD',
  'COMMODITY_COPPER'
);
