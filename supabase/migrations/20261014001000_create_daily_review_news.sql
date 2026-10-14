begin;
create table if not exists market_data.daily_review_news_runs (
 run_id text primary key, review_date date not null, collected_at timestamptz not null,
 window_start timestamptz not null, window_end timestamptz not null,
 collection_status text not null, review_status text not null default 'PENDING',
 candidate_count integer not null, input_sha256 text not null,
 coverage jsonb not null, events jsonb not null default '[]',
 audit jsonb not null default '{}', reviewed_at timestamptz,
 check (review_status in ('PENDING','REVIEWED'))
);
create index if not exists daily_review_news_date_idx on market_data.daily_review_news_runs(review_date,collected_at desc);
alter table market_data.daily_review_news_runs enable row level security;
grant all on market_data.daily_review_news_runs to service_role;
notify pgrst,'reload schema';
commit;
