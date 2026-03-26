drop table if exists company_financials_v2 cascade;

create table company_financials_v2 (
  company_code text not null,
  corp_code text not null,
  corp_name text,
  year integer not null,
  quarter integer not null,
  reprt_code text not null,
  fs_div text not null,
  is_consolidated boolean not null default false,
  assets_total bigint,
  current_assets bigint,
  cash_and_cash_equivalents bigint,
  short_term_financial_assets bigint,
  trade_receivables bigint,
  inventories bigint,
  noncurrent_assets bigint,
  investments_in_associates bigint,
  property_plant_and_equipment bigint,
  intangible_assets bigint,
  liabilities_total bigint,
  current_liabilities bigint,
  noncurrent_liabilities bigint,
  equity_total bigint,
  revenue bigint,
  cost_of_sales bigint,
  operating_income bigint,
  selling_general_administrative_expenses bigint,
  profit_before_tax bigint,
  income_tax_expense bigint,
  net_income bigint,
  operating_cash_flow bigint,
  investing_cash_flow bigint,
  financing_cash_flow bigint,
  cash_beginning bigint,
  cash_ending bigint,
  selected_account_ids jsonb not null default '{}'::jsonb,
  selected_account_names jsonb not null default '{}'::jsonb,
  selected_statement_names jsonb not null default '{}'::jsonb,
  selected_priority_indices jsonb not null default '{}'::jsonb,
  account_id_priority_map jsonb not null default '{}'::jsonb,
  raw_row_count integer not null default 0,
  data_source text not null default 'dart_account_id_manual',
  raw_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_code, year, quarter, data_source)
);

create index idx_company_financials_v2_period
  on company_financials_v2 (year desc, quarter desc, fs_div);

create index idx_company_financials_v2_corp_code
  on company_financials_v2 (corp_code);

alter table company_financials_v2 enable row level security;

comment on table company_financials_v2 is
  'Reset v2 financial facts table rebuilt for manual DART account_id priority normalization.';
