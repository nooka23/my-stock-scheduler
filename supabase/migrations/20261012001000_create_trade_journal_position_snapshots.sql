begin;
create table public.trade_journal_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  observed_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= observed_at),
  content_hash text not null check (length(content_hash)=64),
  positions jsonb not null check (jsonb_typeof(positions)='array'),
  cash jsonb not null check (jsonb_typeof(cash)='array'),
  source text not null check (source='NAMUH_API'),
  unique(account_id,content_hash),
  foreign key(account_id,user_id) references public.trade_journal_accounts(id,user_id) on delete cascade
);
create index on public.trade_journal_position_snapshots(user_id,account_id,observed_at desc);
alter table public.trade_journal_position_snapshots enable row level security;
revoke all on public.trade_journal_position_snapshots from anon,authenticated;
grant select on public.trade_journal_position_snapshots to authenticated;
grant all on public.trade_journal_position_snapshots to service_role;
create policy owner_read on public.trade_journal_position_snapshots for select to authenticated using(user_id=(select auth.uid()));
-- Pick the latest whole snapshot: closed positions disappear, including an empty portfolio.
create view public.trade_journal_latest_position_snapshots with(security_invoker=true) as
select distinct on(account_id) * from public.trade_journal_position_snapshots
order by account_id,observed_at desc,completed_at desc,id desc;
revoke all on public.trade_journal_latest_position_snapshots from anon;
grant select on public.trade_journal_latest_position_snapshots to authenticated,service_role;
notify pgrst,'reload schema';
commit;
