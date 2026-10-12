begin;
create table public.trade_journal_display_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 usd_krw numeric(12,4) not null check(usd_krw>0 and usd_krw<=100000),
 updated_at timestamptz not null default now()
);
alter table public.trade_journal_display_settings enable row level security;
revoke all on public.trade_journal_display_settings from anon,authenticated;
grant select,insert,update on public.trade_journal_display_settings to authenticated;
grant all on public.trade_journal_display_settings to service_role;
create policy owner_settings on public.trade_journal_display_settings for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
notify pgrst,'reload schema';
commit;
