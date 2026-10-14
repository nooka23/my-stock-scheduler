begin;
insert into market_data.market_instruments(internal_code,display_name,asset_class,exchange,currency,provider,provider_symbol,provider_params,is_enabled,metadata)
values
('OPINET_DUBAI_SPOT','Dubai spot assessment (Opinet)','COMMODITY','SINGAPORE','USD','OPINET','Dubai','{"collector":"opinet_crude_daily","frequency":"daily"}',true,'{"display_scope":"owner_only","price_type":"Singapore Dubai spot estimated assessment","unit":"USD/bbl"}'),
('OPINET_BRENT_FUTURE','ICE Brent futures published price (Opinet)','FUTURE','ICE','USD','OPINET','Brent','{"collector":"opinet_crude_daily","frequency":"daily"}',true,'{"display_scope":"owner_only","price_type":"ICE Brent futures published price; contract methodology not reconstructed","unit":"USD/bbl"}'),
('OPINET_WTI_FUTURE','NYMEX WTI futures published price (Opinet)','FUTURE','NYMEX','USD','OPINET','WTI','{"collector":"opinet_crude_daily","frequency":"daily"}',true,'{"display_scope":"owner_only","price_type":"NYMEX WTI futures published price; contract methodology not reconstructed","unit":"USD/bbl"}')
on conflict(internal_code) do update set display_name=excluded.display_name,provider=excluded.provider,provider_symbol=excluded.provider_symbol,provider_params=excluded.provider_params,is_enabled=excluded.is_enabled,metadata=market_data.market_instruments.metadata || excluded.metadata;
commit;
