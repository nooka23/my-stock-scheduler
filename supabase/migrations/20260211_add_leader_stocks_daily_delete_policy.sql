create or replace function public.delete_leader_stocks_daily_by_date(target_date date)
returns void
language plpgsql
security definer
as $$
begin
  delete from leader_stocks_daily where date = target_date;
end;
$$;
