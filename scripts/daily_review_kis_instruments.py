"""KIS codes verified with daily-chart responses; see per-record verification dates."""
EXTRA_INSTRUMENTS = [
    ('KR_INDEX_VKOSPI', 'KOSPI 200 Volatility Index (VKOSPI)', 'INDEX', 'POINT', '0503', 'U'),
    ('FX_GBPUSD', 'GBP/USD', 'FX', 'USD', 'FX@GBP', 'X'),
    ('FX_EURUSD', 'EUR/USD', 'FX', 'USD', 'FX@EUR', 'X'),
    ('FX_USDCNY', 'USD/CNY', 'FX', 'CNY', 'FX@CNY', 'X'),
    ('FX_JPYKRW', 'KRW per 1 JPY', 'FX', 'KRW', 'FX@KRWJS', 'X'),
    ('US_RATE_1Y', 'US 1Y Treasury Yield', 'RATE', 'PCT', 'Y0203', 'I'),
    ('US_RATE_30Y', 'US 30Y Treasury Yield', 'RATE', 'PCT', 'Y0201', 'I'),
    ('US_RATE_FED_FUNDS', 'US Federal Funds Rate (KIS)', 'RATE', 'PCT', 'Y0204', 'I'),
    ('US_RATE_DISCOUNT', 'US Discount Rate', 'RATE', 'PCT', 'Y0205', 'I'),
    ('US_RATE_PRIME', 'US Prime Rate', 'RATE', 'PCT', 'Y0206', 'I'),
    ('KR_RATE_1Y', 'Korea Treasury 1Y', 'RATE', 'PCT', 'Y0104', 'I'),
    ('KR_RATE_3Y', 'Korea Treasury 3Y', 'RATE', 'PCT', 'Y0101', 'I'),
    ('KR_RATE_5Y', 'Korea Treasury 5Y', 'RATE', 'PCT', 'Y0105', 'I'),
    ('KR_RATE_10Y', 'Korea Treasury 10Y', 'RATE', 'PCT', 'Y0106', 'I'),
    ('KR_RATE_20Y', 'Korea Treasury 20Y', 'RATE', 'PCT', 'Y0116', 'I'),
    ('KR_RATE_30Y', 'Korea Treasury 30Y', 'RATE', 'PCT', 'Y0117', 'I'),
]
DERIVED_SOURCE = 'KIS_DERIVED_DAILY_CROSS'


def configure(db):
    rows = [dict(internal_code=code, display_name=name, asset_class=asset,
                 currency=currency, provider='KIS', provider_symbol=symbol,
                 provider_params={'collector': 'daily_chart', 'fid_cond_mrkt_div_code': market},
                 is_enabled=True, display_order=300+i,
                 metadata={'verified_at': '2026-10-16' if code == 'KR_INDEX_VKOSPI' else '2026-10-14'})
            for i, (code, name, asset, currency, symbol, market) in enumerate(EXTRA_INSTRUMENTS)]
    rows.append(dict(internal_code='FX_CNYKRW', display_name='KRW per CNY (derived)',
                     asset_class='FX', currency='KRW', provider='CALCULATED',
                     provider_symbol='KIS_USDKRW_DIV_USDCNY', provider_params={},
                     is_enabled=True, display_order=320,
                     metadata={'formula': 'USD/KRW / USD/CNY', 'join': 'same observation date; no forward fill'}))
    db.schema('market_data').table('market_instruments').upsert(rows, on_conflict='internal_code').execute()
    print(f'Configured {len(rows)} instruments')


if __name__ == '__main__':
    import argparse
    from supabase import create_client
    from collect_us_market_data import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, require_environment
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    if not args.apply:
        p.error('Use --apply to upsert verified instrument configuration')
    require_environment()
    configure(create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY))
