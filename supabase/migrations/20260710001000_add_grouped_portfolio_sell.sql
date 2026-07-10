alter table public.user_portfolio_transactions
  add column if not exists sell_event_id uuid,
  add column if not exists allocation_sequence integer,
  add column if not exists group_remaining_position_size numeric(18,4);

create index if not exists idx_user_portfolio_transactions_sell_event_id
  on public.user_portfolio_transactions (sell_event_id);

comment on column public.user_portfolio_transactions.sell_event_id is
  'Shared identifier for one user-entered sell event that may be allocated across multiple portfolio lots';

comment on column public.user_portfolio_transactions.group_remaining_position_size is
  'Remaining open quantity for the same company and position type after the sell event completes';

create or replace function public.record_grouped_portfolio_sell(
  p_company_code text,
  p_position_type text,
  p_sell_quantity numeric,
  p_realized_pnl numeric,
  p_sell_date date
) returns jsonb
language plpgsql
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

  select coalesce(sum(position_size), 0)
  into v_total_available
  from (
    select position_size
    from public.user_portfolio
    where user_id = v_user_id
      and company_code = p_company_code
      and position_type = p_position_type
      and coalesce(is_closed, false) = false
    for update
  ) locked_positions;

  if v_total_available <= 0 then
    raise exception 'Portfolio position not found';
  end if;

  if p_sell_quantity > v_total_available then
    raise exception 'Sell quantity exceeds current position size';
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

  return jsonb_build_object(
    'sell_event_id', v_event_id,
    'quantity', p_sell_quantity,
    'realized_pnl', v_realized_pnl,
    'remaining_position_size', v_group_remaining,
    'allocation_count', v_allocation_count
  );
end;
$$;

grant execute on function public.record_grouped_portfolio_sell(text, text, numeric, numeric, date) to authenticated;
grant execute on function public.record_grouped_portfolio_sell(text, text, numeric, numeric, date) to service_role;
