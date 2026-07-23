alter table public.user_portfolio_transactions
  add column if not exists sell_event_id uuid,
  add column if not exists allocation_sequence integer,
  add column if not exists group_remaining_position_size numeric(18,4);

create index if not exists idx_user_portfolio_transactions_sell_event_id
  on public.user_portfolio_transactions (sell_event_id);

create table if not exists public.user_portfolio_group_averages (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_code text not null,
  position_type text not null,
  avg_price numeric(18,4) not null check (avg_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_code, position_type)
);

create index if not exists idx_user_portfolio_group_averages_user_id
  on public.user_portfolio_group_averages (user_id);

alter table public.user_portfolio_group_averages enable row level security;

drop policy if exists "Users can view own portfolio group averages"
  on public.user_portfolio_group_averages;
create policy "Users can view own portfolio group averages"
  on public.user_portfolio_group_averages for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own portfolio group averages"
  on public.user_portfolio_group_averages;
create policy "Users can insert own portfolio group averages"
  on public.user_portfolio_group_averages for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own portfolio group averages"
  on public.user_portfolio_group_averages;
create policy "Users can update own portfolio group averages"
  on public.user_portfolio_group_averages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own portfolio group averages"
  on public.user_portfolio_group_averages;
create policy "Users can delete own portfolio group averages"
  on public.user_portfolio_group_averages for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_portfolio_group_averages to authenticated;
grant all on public.user_portfolio_group_averages to service_role;

comment on table public.user_portfolio_group_averages is
  'Stable weighted average price for an open portfolio group. Buys recalculate it; sells preserve it.';

comment on column public.user_portfolio_group_averages.avg_price is
  'Integrated average purchase price that remains unchanged when the group is partially sold';

insert into public.user_portfolio_group_averages (
  user_id,
  company_code,
  position_type,
  avg_price
)
select
  user_id,
  company_code,
  position_type,
  sum(avg_price * position_size) / nullif(sum(position_size), 0)
from public.user_portfolio
where coalesce(is_closed, false) = false
group by user_id, company_code, position_type
having sum(position_size) > 0
on conflict (user_id, company_code, position_type) do nothing;

create or replace function public.sync_portfolio_group_avg(
  p_company_code text,
  p_position_type text
) returns numeric
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_position_size numeric := 0;
  v_cost_amount numeric := 0;
  v_avg_price numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_company_code is null or length(trim(p_company_code)) = 0 then
    raise exception 'Company code is required';
  end if;

  if p_position_type is null or length(trim(p_position_type)) = 0 then
    raise exception 'Position type is required';
  end if;

  select
    coalesce(sum(position_size), 0),
    coalesce(sum(avg_price * position_size), 0)
  into v_position_size, v_cost_amount
  from public.user_portfolio
  where user_id = v_user_id
    and company_code = p_company_code
    and position_type = p_position_type
    and coalesce(is_closed, false) = false;

  if v_position_size <= 0 then
    delete from public.user_portfolio_group_averages
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type;
    return null;
  end if;

  v_avg_price := v_cost_amount / v_position_size;

  insert into public.user_portfolio_group_averages (
    user_id,
    company_code,
    position_type,
    avg_price,
    updated_at
  ) values (
    v_user_id,
    p_company_code,
    p_position_type,
    v_avg_price,
    now()
  )
  on conflict (user_id, company_code, position_type) do update
  set avg_price = excluded.avg_price,
      updated_at = now();

  return v_avg_price;
end;
$$;

grant execute on function public.sync_portfolio_group_avg(text, text) to authenticated;
grant execute on function public.sync_portfolio_group_avg(text, text) to service_role;

create or replace function public.record_grouped_portfolio_sell(
  p_company_code text,
  p_position_type text,
  p_sell_quantity numeric,
  p_realized_pnl numeric,
  p_sell_date date
) returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_position public.user_portfolio%rowtype;
  v_user_id uuid := auth.uid();
  v_event_id uuid := gen_random_uuid();
  v_total_available numeric := 0;
  v_remaining_to_sell numeric;
  v_alloc_quantity numeric;
  v_new_position_size numeric;
  v_realized_pnl numeric := coalesce(p_realized_pnl, 0);
  v_allocated_pnl numeric;
  v_distributed_pnl numeric := 0;
  v_allocation_count integer := 0;
  v_group_remaining numeric := 0;
  v_group_avg_price numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_company_code is null or length(trim(p_company_code)) = 0 then
    raise exception 'Company code is required';
  end if;

  if p_position_type is null or length(trim(p_position_type)) = 0 then
    raise exception 'Position type is required';
  end if;

  if p_sell_quantity is null or p_sell_quantity <= 0 then
    raise exception 'Sell quantity must be greater than zero';
  end if;

  if p_sell_date is null then
    raise exception 'Sell date is required';
  end if;

  for v_position in
    select *
    from public.user_portfolio
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type
      and coalesce(is_closed, false) = false
    order by entry_date asc, created_at asc, id asc
    for update
  loop
    v_total_available := v_total_available + v_position.position_size;
  end loop;

  if v_total_available <= 0 then
    raise exception 'Portfolio position not found';
  end if;

  if p_sell_quantity > v_total_available then
    raise exception 'Sell quantity exceeds current position size';
  end if;

  select avg_price
  into v_group_avg_price
  from public.user_portfolio_group_averages
  where user_id = v_user_id
    and company_code = p_company_code
    and position_type = p_position_type
  for update;

  if v_group_avg_price is null then
    select sum(avg_price * position_size) / nullif(sum(position_size), 0)
    into v_group_avg_price
    from public.user_portfolio
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type
      and coalesce(is_closed, false) = false;

    insert into public.user_portfolio_group_averages (
      user_id,
      company_code,
      position_type,
      avg_price
    ) values (
      v_user_id,
      p_company_code,
      p_position_type,
      v_group_avg_price
    )
    on conflict (user_id, company_code, position_type) do nothing;
  end if;

  v_remaining_to_sell := p_sell_quantity;

  for v_position in
    select *
    from public.user_portfolio
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type
      and coalesce(is_closed, false) = false
    order by entry_date asc, created_at asc, id asc
    for update
  loop
    exit when v_remaining_to_sell <= 0;

    v_alloc_quantity := least(v_position.position_size, v_remaining_to_sell);
    v_new_position_size := v_position.position_size - v_alloc_quantity;
    v_allocation_count := v_allocation_count + 1;

    if v_remaining_to_sell = v_alloc_quantity then
      v_allocated_pnl := v_realized_pnl - v_distributed_pnl;
    else
      v_allocated_pnl := round(v_realized_pnl * v_alloc_quantity / p_sell_quantity, 2);
      v_distributed_pnl := v_distributed_pnl + v_allocated_pnl;
    end if;

    update public.user_portfolio
    set position_size = v_new_position_size,
        realized_pnl = coalesce(realized_pnl, 0) + v_allocated_pnl,
        is_closed = (v_new_position_size = 0),
        close_date = case
          when v_new_position_size = 0 then p_sell_date
          else close_date
        end
    where id = v_position.id;

    insert into public.user_portfolio_transactions (
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
      manual_current_price,
      sell_event_id,
      allocation_sequence
    ) values (
      v_position.user_id,
      v_position.id,
      'SELL',
      p_sell_date,
      v_alloc_quantity,
      v_allocated_pnl,
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
      v_position.manual_current_price,
      v_event_id,
      v_allocation_count
    );

    v_remaining_to_sell := v_remaining_to_sell - v_alloc_quantity;
  end loop;

  select coalesce(sum(position_size), 0)
  into v_group_remaining
  from public.user_portfolio
  where user_id = v_user_id
    and company_code = p_company_code
    and position_type = p_position_type
    and coalesce(is_closed, false) = false;

  update public.user_portfolio_transactions
  set group_remaining_position_size = v_group_remaining
  where sell_event_id = v_event_id;

  if v_group_remaining <= 0 then
    delete from public.user_portfolio_group_averages
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type;
  else
    update public.user_portfolio_group_averages
    set updated_at = now()
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type;
  end if;

  return jsonb_build_object(
    'sell_event_id', v_event_id,
    'quantity', p_sell_quantity,
    'realized_pnl', v_realized_pnl,
    'remaining_position_size', v_group_remaining,
    'allocation_count', v_allocation_count,
    'group_avg_price', v_group_avg_price
  );
end;
$$;

grant execute on function public.record_grouped_portfolio_sell(text, text, numeric, numeric, date) to authenticated;
grant execute on function public.record_grouped_portfolio_sell(text, text, numeric, numeric, date) to service_role;

create or replace function public.record_portfolio_sell(
  p_portfolio_id uuid,
  p_sell_quantity numeric,
  p_realized_pnl numeric,
  p_sell_date date
) returns public.user_portfolio_transactions
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_position public.user_portfolio%rowtype;
  v_new_position_size numeric;
  v_new_realized_pnl numeric;
  v_transaction public.user_portfolio_transactions;
  v_group_avg_price numeric;
  v_group_remaining numeric;
begin
  if p_sell_quantity is null or p_sell_quantity <= 0 then
    raise exception 'Sell quantity must be greater than zero';
  end if;

  if p_sell_date is null then
    raise exception 'Sell date is required';
  end if;

  select *
  into v_position
  from public.user_portfolio
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

  select avg_price
  into v_group_avg_price
  from public.user_portfolio_group_averages
  where user_id = v_position.user_id
    and company_code = v_position.company_code
    and position_type = v_position.position_type
  for update;

  if v_group_avg_price is null then
    select sum(avg_price * position_size) / nullif(sum(position_size), 0)
    into v_group_avg_price
    from public.user_portfolio
    where user_id = v_position.user_id
      and company_code = v_position.company_code
      and position_type = v_position.position_type
      and coalesce(is_closed, false) = false;

    insert into public.user_portfolio_group_averages (
      user_id,
      company_code,
      position_type,
      avg_price
    ) values (
      v_position.user_id,
      v_position.company_code,
      v_position.position_type,
      v_group_avg_price
    )
    on conflict (user_id, company_code, position_type) do nothing;
  end if;

  v_new_position_size := v_position.position_size - p_sell_quantity;
  v_new_realized_pnl := coalesce(v_position.realized_pnl, 0) + coalesce(p_realized_pnl, 0);

  update public.user_portfolio
  set position_size = v_new_position_size,
      realized_pnl = v_new_realized_pnl,
      is_closed = (v_new_position_size = 0),
      close_date = case
        when v_new_position_size = 0 then p_sell_date
        else close_date
      end
  where id = v_position.id;

  insert into public.user_portfolio_transactions (
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

  select coalesce(sum(position_size), 0)
  into v_group_remaining
  from public.user_portfolio
  where user_id = v_position.user_id
    and company_code = v_position.company_code
    and position_type = v_position.position_type
    and coalesce(is_closed, false) = false;

  if v_group_remaining <= 0 then
    delete from public.user_portfolio_group_averages
    where user_id = v_position.user_id
      and company_code = v_position.company_code
      and position_type = v_position.position_type;
  else
    update public.user_portfolio_group_averages
    set updated_at = now()
    where user_id = v_position.user_id
      and company_code = v_position.company_code
      and position_type = v_position.position_type;
  end if;

  return v_transaction;
end;
$$;

grant execute on function public.record_portfolio_sell(uuid, numeric, numeric, date) to authenticated;
grant execute on function public.record_portfolio_sell(uuid, numeric, numeric, date) to service_role;
