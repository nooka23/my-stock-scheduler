alter table public.companies
  add column if not exists security_type text not null default 'UNKNOWN',
  add column if not exists is_rs_eligible boolean not null default false;

comment on column public.companies.security_type is
  'KIS master classification: COMMON, PREFERRED, ETP, SPAC, INDEX, or UNKNOWN';

comment on column public.companies.is_rs_eligible is
  'True only for ordinary shares eligible for relative-strength calculations';

create index if not exists idx_companies_rs_eligible
  on public.companies (code)
  where is_rs_eligible = true;
