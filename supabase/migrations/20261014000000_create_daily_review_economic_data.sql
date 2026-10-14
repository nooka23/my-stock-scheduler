begin;
create table if not exists market_data.economic_series (
 code text primary key, name text not null, "group" text not null,
 frequency text not null, unit text not null, transform text not null default 'level',
 last_checked_at timestamptz, last_changed_at timestamptz, last_error text,
 latest_observation_date date, source text not null default 'FRED',
 source_url text not null
);
create table if not exists market_data.economic_observations (
 series_code text references market_data.economic_series(code), observation_date date,
 value numeric not null, first_seen_at timestamptz not null, last_seen_at timestamptz not null,
 primary key (series_code,observation_date)
);
create table if not exists market_data.economic_changes (
 id bigint generated always as identity primary key,
 series_code text references market_data.economic_series(code), observation_date date not null,
 old_value numeric, new_value numeric not null, detected_at timestamptz not null,
 review_date date not null, kind text not null check(kind in ('new','revision'))
);
create index if not exists economic_changes_review_idx on market_data.economic_changes(review_date);
alter table market_data.economic_series enable row level security;
alter table market_data.economic_observations enable row level security;
alter table market_data.economic_changes enable row level security;
grant all on market_data.economic_series, market_data.economic_observations, market_data.economic_changes to service_role;
grant usage,select on sequence market_data.economic_changes_id_seq to service_role;
notify pgrst,'reload schema';
commit;
begin;
create or replace function market_data.save_economic_series(p_series jsonb,p_rows jsonb,p_changes jsonb,p_checked_at timestamptz,p_latest date)
returns void language plpgsql set search_path = '' as $$
begin
 insert into market_data.economic_series(code,name,"group",frequency,unit,transform,source_url)
 values(p_series->>'code',p_series->>'name',p_series->>'group',p_series->>'frequency',p_series->>'unit',p_series->>'transform',p_series->>'source_url')
 on conflict(code) do update set name=excluded.name,"group"=excluded."group",frequency=excluded.frequency,unit=excluded.unit,transform=excluded.transform,source_url=excluded.source_url;
 insert into market_data.economic_observations(series_code,observation_date,value,first_seen_at,last_seen_at)
 select series_code,observation_date,value,first_seen_at,last_seen_at
 from jsonb_to_recordset(p_rows) as x(series_code text,observation_date date,value numeric,first_seen_at timestamptz,last_seen_at timestamptz)
 on conflict(series_code,observation_date) do update set value=excluded.value,last_seen_at=excluded.last_seen_at;
 insert into market_data.economic_changes(series_code,observation_date,old_value,new_value,detected_at,review_date,kind)
 select series_code,observation_date,old_value,new_value,detected_at,review_date,kind
 from jsonb_to_recordset(p_changes) as x(series_code text,observation_date date,old_value numeric,new_value numeric,detected_at timestamptz,review_date date,kind text);
 update market_data.economic_series set last_checked_at=p_checked_at,latest_observation_date=p_latest,last_error=null,
 last_changed_at=case when jsonb_array_length(p_changes)>0 then p_checked_at else last_changed_at end
 where code=p_series->>'code';
end;
$$;
revoke all on function market_data.save_economic_series(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated;
grant execute on function market_data.save_economic_series(jsonb,jsonb,jsonb,timestamptz,date) to service_role;
notify pgrst,'reload schema';
commit;
