drop policy if exists "Public read access" on company_financials_v2;
create policy "Public read access" on company_financials_v2
  for select using (true);
