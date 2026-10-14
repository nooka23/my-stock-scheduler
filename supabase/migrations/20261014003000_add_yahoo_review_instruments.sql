begin;
insert into market_data.market_instruments(internal_code,display_name,asset_class,exchange,currency,provider,provider_symbol,provider_params,is_enabled,metadata)
values
('YAHOO_GOLD_FUTURE','Gold futures (Yahoo GC=F)','FUTURE','COMEX','USD','YAHOO','GC=F','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only","contract_note":"Yahoo vendor-linked futures history; rollover methodology not guaranteed"}'),
('YAHOO_COPPER_FUTURE','Copper futures (Yahoo HG=F)','FUTURE','COMEX','USD','YAHOO','HG=F','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only","contract_note":"Yahoo vendor-linked futures history; rollover methodology not guaranteed"}'),
('YAHOO_DXY','US Dollar Index (Yahoo)','INDEX','ICE','USD','YAHOO','DX-Y.NYB','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only"}'),
('YAHOO_RUSSELL2000','Russell 2000 (Yahoo)','INDEX','INDEX','USD','YAHOO','^RUT','{"collector":"yahoo_review_daily","interval":"1d"}',true,'{"display_scope":"owner_only"}')
on conflict(internal_code) do update set display_name=excluded.display_name,provider=excluded.provider,provider_symbol=excluded.provider_symbol,provider_params=excluded.provider_params,is_enabled=excluded.is_enabled,metadata=market_data.market_instruments.metadata || excluded.metadata;
commit;
