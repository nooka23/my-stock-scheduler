create table if not exists user_portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references user_portfolio(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('SELL')),
  transaction_date date not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  realized_pnl numeric(18, 2) not null default 0,
  remaining_position_size numeric(18, 4) not null,
  entry_date date,
  trade_type text,
  company_code text not null,
  company_name text not null,
  position_type text,
  avg_price numeric(18, 4),
  stop_loss numeric(18, 4),
  initial_position_size numeric(18, 4),
  sector text,
  comment text,
  is_custom_asset boolean not null default false,
  manual_current_price numeric(18, 4),
  created_at timestamptz not null default now()
);

create index if not exists idx_user_portfolio_transactions_user_date
  on user_portfolio_transactions (user_id, transaction_date desc);

create index if not exists idx_user_portfolio_transactions_portfolio_date
  on user_portfolio_transactions (portfolio_id, transaction_date desc);

alter table user_portfolio_transactions enable row level security;

drop policy if exists "Users can view own portfolio transactions" on user_portfolio_transactions;
create policy "Users can view own portfolio transactions"
  on user_portfolio_transactions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own portfolio transactions" on user_portfolio_transactions;
create policy "Users can insert own portfolio transactions"
  on user_portfolio_transactions for insert
  with check (auth.uid() = user_id);

drop function if exists record_portfolio_sell(uuid, numeric, numeric, date);
create or replace function record_portfolio_sell(
  p_portfolio_id uuid,
  p_sell_quantity numeric,
  p_realized_pnl numeric,
  p_sell_date date
)
returns user_portfolio_transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_position user_portfolio%rowtype;
  v_new_position_size numeric;
  v_new_realized_pnl numeric;
  v_transaction user_portfolio_transactions;
begin
  if p_sell_quantity is null or p_sell_quantity <= 0 then
    raise exception 'Sell quantity must be greater than zero';
  end if;

  if p_sell_date is null then
    raise exception 'Sell date is required';
  end if;

  select *
  into v_position
  from user_portfolio
  where id = p_portfolio_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Portfolio position not found';
  end if;

  if coalesce(v_position.is_closed, false) then
    raise exception 'Portfolio position is already closed';
  end if;

  if p_sell_quantity > v_position.position_size then
    raise exception 'Sell quantity exceeds current position size';
  end if;

  v_new_position_size := v_position.position_size - p_sell_quantity;
  v_new_realized_pnl := coalesce(v_position.realized_pnl, 0) + coalesce(p_realized_pnl, 0);

  update user_portfolio
  set position_size = v_new_position_size,
      realized_pnl = v_new_realized_pnl,
      is_closed = (v_new_position_size = 0),
      close_date = case
        when v_new_position_size = 0 then p_sell_date
        else close_date
      end
  where id = v_position.id;

  insert into user_portfolio_transactions (
    user_id,
    portfolio_id,
    transaction_type,
    transaction_date,
    quantity,
    realized_pnl,
    remaining_position_size,
    entry_date,
    trade_type,
    company_code,
    company_name,
    position_type,
    avg_price,
    stop_loss,
    initial_position_size,
    sector,
    comment,
    is_custom_asset,
    manual_current_price
  ) values (
    v_position.user_id,
    v_position.id,
    'SELL',
    p_sell_date,
    p_sell_quantity,
    coalesce(p_realized_pnl, 0),
    v_new_position_size,
    v_position.entry_date,
    v_position.trade_type,
    v_position.company_code,
    v_position.company_name,
    v_position.position_type,
    v_position.avg_price,
    v_position.stop_loss,
    v_position.initial_position_size,
    v_position.sector,
    v_position.comment,
    coalesce(v_position.is_custom_asset, false),
    v_position.manual_current_price
  )
  returning * into v_transaction;

  return v_transaction;
end;
$$;

grant execute on function record_portfolio_sell(uuid, numeric, numeric, date) to authenticated;
