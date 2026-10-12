-- Account ledgers are separate from the existing manual portfolio.
begin;

create table public.trade_journal_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias text not null check (alias in ('namuh-general', 'namuh-isa', 'kiwoom-main')),
  label text not null,
  unique (user_id, alias),
  unique (id, user_id)
);

create table public.trade_journal_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  source text not null check (source in ('API', 'MANUAL_IMPORT')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.trade_journal_accounts(id, user_id) on delete cascade,
  unique (account_id, content_hash)
);

create table public.trade_journal_executions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  source_key text not null,
  batch_id uuid not null references public.trade_journal_batches(id),
  market text not null,
  symbol text not null,
  name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  side text not null check (side in ('BUY', 'SELL')),
  trade_date date not null,
  executed_at timestamptz not null,
  settlement_date date,
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price >= 0),
  gross_amount numeric not null check (gross_amount >= 0),
  fee numeric check (fee >= 0),
  tax numeric check (tax >= 0),
  status text not null check (status in ('PROVISIONAL', 'CONFIRMED', 'REVERSED')),
  foreign key (account_id, user_id) references public.trade_journal_accounts(id, user_id) on delete cascade,
  unique (account_id, source_key)
);

create table public.trade_journal_cash_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  source_key text not null,
  batch_id uuid not null references public.trade_journal_batches(id),
  occurred_at timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('DEPOSIT','WITHDRAWAL','SETTLEMENT','FX','DIVIDEND','INTEREST','FEE','TAX','OTHER')),
  amount numeric not null,
  description text not null,
  foreign key (account_id, user_id) references public.trade_journal_accounts(id, user_id) on delete cascade,
  unique (account_id, source_key)
);

create table public.trade_journal_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  batch_id uuid not null references public.trade_journal_batches(id),
  observed_at timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cash numeric not null,
  withdrawable numeric,
  buying_power numeric,
  -- Preserve settlement dates/amounts rather than assuming a country's settlement cycle.
  settlements jsonb not null default '[]'::jsonb,
  foreign key (account_id, user_id) references public.trade_journal_accounts(id, user_id) on delete cascade,
  unique (account_id, observed_at, currency)
);

create table public.trade_journal_notes (
  execution_id uuid primary key references public.trade_journal_executions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '' check (length(note) <= 10000),
  updated_at timestamptz not null default now()
);

create index on public.trade_journal_executions (user_id, trade_date desc, executed_at desc);
create index on public.trade_journal_cash_events (user_id, occurred_at desc);
create index on public.trade_journal_balances (user_id, observed_at desc);
create index on public.trade_journal_batches (user_id, created_at desc);

create view public.trade_journal_latest_balances with (security_invoker = true) as
select distinct on (account_id, currency) *
from public.trade_journal_balances
order by account_id, currency, observed_at desc;
revoke all on public.trade_journal_latest_balances from anon;
grant select on public.trade_journal_latest_balances to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['trade_journal_accounts','trade_journal_batches','trade_journal_executions','trade_journal_cash_events','trade_journal_balances','trade_journal_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

grant insert, update, delete on public.trade_journal_notes to authenticated;
create policy owner_notes on public.trade_journal_notes for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.trade_journal_executions e
    where e.id = execution_id and e.user_id = (select auth.uid())
  )
);

-- Only the collector service can submit a complete batch. One RPC is one transaction.
create function public.ingest_trade_journal_batch(p_user_id uuid, p_alias text, p_hash text, p_batch jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  a uuid;
  b uuid;
  r jsonb;
  labels jsonb := '{"namuh-general":"나무 일반","namuh-isa":"나무 ISA","kiwoom-main":"키움"}'::jsonb;
begin
  if not (labels ? p_alias) or p_batch->>'account_alias' <> p_alias
     or p_batch->>'source' not in ('API','MANUAL_IMPORT')
     or p_batch->'complete' is distinct from 'true'::jsonb
     or jsonb_typeof(p_batch->'executions') is distinct from 'array'
     or jsonb_typeof(p_batch->'cash_events') is distinct from 'array'
     or jsonb_typeof(p_batch->'balances') is distinct from 'array' then
    raise exception 'Invalid or incomplete journal batch';
  end if;
  insert into trade_journal_accounts(user_id, alias, label)
  values (p_user_id, p_alias, labels->>p_alias)
  on conflict (user_id, alias) do update set label = excluded.label returning id into a;
  -- Serialise overlapping imports for an account, including corrected/replayed batches.
  perform pg_advisory_xact_lock(hashtextextended(a::text, 0));
  insert into trade_journal_batches(account_id,user_id,content_hash,observed_at,source,payload)
  values (a,p_user_id,p_hash,(p_batch->>'observed_at')::timestamptz,p_batch->>'source',p_batch)
  on conflict (account_id, content_hash) do nothing returning id into b;
  if b is null then
    select id into b from trade_journal_batches where account_id=a and content_hash=p_hash;
    return b;
  end if;
  for r in select value from jsonb_array_elements(p_batch->'executions') loop
    insert into trade_journal_executions(account_id,user_id,source_key,batch_id,market,symbol,name,currency,side,trade_date,executed_at,settlement_date,quantity,price,gross_amount,fee,tax,status)
    values (a,p_user_id,r->>'source_key',b,r->>'market',r->>'symbol',r->>'name',r->>'currency',r->>'side',(r->>'trade_date')::date,(r->>'executed_at')::timestamptz,(r->>'settlement_date')::date,(r->>'quantity')::numeric,(r->>'price')::numeric,(r->>'gross_amount')::numeric,(r->>'fee')::numeric,(r->>'tax')::numeric,r->>'status')
    on conflict (account_id,source_key) do update set
      batch_id=excluded.batch_id, market=excluded.market, symbol=excluded.symbol, name=excluded.name,
      currency=excluded.currency, side=excluded.side, trade_date=excluded.trade_date,
      executed_at=excluded.executed_at, settlement_date=excluded.settlement_date, quantity=excluded.quantity,
      price=excluded.price,gross_amount=excluded.gross_amount,fee=excluded.fee,tax=excluded.tax,status=excluded.status
    -- An older replay must not overwrite a correction observed later.
    where (select observed_at from trade_journal_batches where id=trade_journal_executions.batch_id) <= (p_batch->>'observed_at')::timestamptz;
  end loop;
  for r in select value from jsonb_array_elements(p_batch->'cash_events') loop
    insert into trade_journal_cash_events(account_id,user_id,source_key,batch_id,occurred_at,currency,kind,amount,description)
    values (a,p_user_id,r->>'source_key',b,(r->>'occurred_at')::timestamptz,r->>'currency',r->>'kind',(r->>'amount')::numeric,r->>'description')
    on conflict (account_id,source_key) do update set batch_id=excluded.batch_id,occurred_at=excluded.occurred_at,currency=excluded.currency,kind=excluded.kind,amount=excluded.amount,description=excluded.description
    where (select observed_at from trade_journal_batches where id=trade_journal_cash_events.batch_id) <= (p_batch->>'observed_at')::timestamptz;
  end loop;
  for r in select value from jsonb_array_elements(p_batch->'balances') loop
    insert into trade_journal_balances(account_id,user_id,batch_id,observed_at,currency,cash,withdrawable,buying_power,settlements)
    values (a,p_user_id,b,(p_batch->>'observed_at')::timestamptz,r->>'currency',(r->>'cash')::numeric,(r->>'withdrawable')::numeric,(r->>'buying_power')::numeric,r->'settlements')
    on conflict (account_id,observed_at,currency) do update set batch_id=excluded.batch_id,cash=excluded.cash,withdrawable=excluded.withdrawable,buying_power=excluded.buying_power,settlements=excluded.settlements;
  end loop;
  return b;
end $$;
revoke all on function public.ingest_trade_journal_batch(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_trade_journal_batch(uuid,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
