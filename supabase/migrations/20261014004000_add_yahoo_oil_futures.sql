begin;
insert into market_data.market_instruments(internal_code,display_name,asset_class,exchange,currency,provider,provider_symbol,provider_params,is_enabled,metadata)
values
('YAHOO_WTI_FUTURE','WTI crude futures (Yahoo CL=F)','FUTURE','NYMEX','USD','YAHOO','CL=F','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only","contract_note":"Yahoo vendor-linked futures history; rollover methodology not guaranteed"}'),
('YAHOO_BRENT_FUTURE','Brent Last Day Financial futures (Yahoo BZ=F)','FUTURE','NYMEX','USD','YAHOO','BZ=F','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only","contract_note":"NYMEX Brent Last Day Financial; not ICE Brent futures. Yahoo-linked contract history"}')
on conflict(internal_code) do update set display_name=excluded.display_name,provider=excluded.provider,provider_symbol=excluded.provider_symbol,provider_params=excluded.provider_params,is_enabled=excluded.is_enabled,metadata=market_data.market_instruments.metadata || excluded.metadata;
commit;
