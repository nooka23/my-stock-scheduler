begin;
alter table market_data.market_instruments drop constraint if exists market_instruments_asset_class_check;
alter table market_data.market_instruments add constraint market_instruments_asset_class_check check(asset_class in ('INDEX','EQUITY','RATE','FX','COMMODITY','FUTURE','CRYPTO'));
insert into market_data.market_instruments(internal_code,display_name,asset_class,exchange,currency,provider,provider_symbol,provider_params,is_enabled,metadata)
values ('CRYPTO_BTCUSD','Bitcoin / US Dollar (Coinbase)','CRYPTO','COINBASE','USD','COINBASE','BTC-USD',
 '{"granularity":86400,"timezone":"UTC","collector":"coinbase_daily"}',true,
 '{"display_scope":"owner_only","license_note":"Coinbase Market Data Terms require written consent for external display","day_boundary":"UTC 00:00; KST 09:00"}')
on conflict(internal_code) do update set provider=excluded.provider,provider_symbol=excluded.provider_symbol,provider_params=excluded.provider_params,asset_class=excluded.asset_class,exchange=excluded.exchange,currency=excluded.currency,is_enabled=excluded.is_enabled,metadata=market_data.market_instruments.metadata || excluded.metadata;
commit;
