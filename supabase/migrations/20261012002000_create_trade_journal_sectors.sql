begin;
create table public.trade_journal_sectors (
  user_id uuid not null references auth.users(id) on delete cascade,
  market text not null check (market in ('KR','US')),
  symbol text not null check (length(symbol) between 1 and 100 and symbol=btrim(symbol)),
  sector text not null check (length(sector)<=60 and sector=btrim(sector)),
  updated_at timestamptz not null default now(),
  primary key(user_id,market,symbol)
);
alter table public.trade_journal_sectors enable row level security;
revoke all on public.trade_journal_sectors from anon,authenticated;
grant select,insert,update,delete on public.trade_journal_sectors to authenticated;
grant all on public.trade_journal_sectors to service_role;
create policy owner_sector on public.trade_journal_sectors for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
notify pgrst,'reload schema';
commit;
