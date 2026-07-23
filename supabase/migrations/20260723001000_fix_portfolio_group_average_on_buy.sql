drop function if exists public.sync_portfolio_group_avg(text, text);

create or replace function public.sync_portfolio_group_avg(
  p_company_code text,
  p_position_type text,
  p_added_quantity numeric,
  p_added_avg_price numeric
) returns numeric
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_position_size numeric := 0;
  v_cost_amount numeric := 0;
  v_previous_position_size numeric := 0;
  v_existing_avg_price numeric;
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

  select avg_price
  into v_existing_avg_price
  from public.user_portfolio_group_averages
  where user_id = v_user_id
    and company_code = p_company_code
    and position_type = p_position_type;

  v_previous_position_size := v_position_size - coalesce(p_added_quantity, 0);

  if v_existing_avg_price is not null
     and p_added_quantity is not null
     and p_added_quantity > 0
     and p_added_avg_price is not null
     and v_previous_position_size >= 0 then
    v_avg_price := (
      v_existing_avg_price * v_previous_position_size
      + p_added_avg_price * p_added_quantity
    ) / v_position_size;
  else
    v_avg_price := v_cost_amount / v_position_size;
  end if;

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

grant execute on function public.sync_portfolio_group_avg(text, text, numeric, numeric) to authenticated;
grant execute on function public.sync_portfolio_group_avg(text, text, numeric, numeric) to service_role;

create or replace function public.sync_portfolio_group_avg(
  p_company_code text,
  p_position_type text
) returns numeric
language sql
security invoker
set search_path to 'public'
as $$
  select public.sync_portfolio_group_avg($1, $2, null, null);
$$;

grant execute on function public.sync_portfolio_group_avg(text, text) to authenticated;
grant execute on function public.sync_portfolio_group_avg(text, text) to service_role;
