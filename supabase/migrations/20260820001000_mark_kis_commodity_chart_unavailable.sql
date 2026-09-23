-- The KIS daily chart API returned successful responses with no output2 rows
-- for both spot and futures master candidates on 2026-08-20. Do not enable a
-- commodity block until another licensed provider has been selected and tested.

update market_data.market_instruments
set
  is_enabled = false,
  metadata = (metadata - 'requires_provider_symbol_verification') || jsonb_build_object(
    'collection_status', 'requires_secondary_provider',
    'verification_note', 'KIS daily chart API returned no rows for official spot and futures master candidates on 2026-08-20.',
    'verified_at', '2026-08-20'
  ),
  updated_at = now()
where internal_code in ('COMMODITY_WTI', 'COMMODITY_GOLD', 'COMMODITY_COPPER');
