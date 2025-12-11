-- user_custom_financials 테이블에 revenue 컬럼 추가
alter table public.user_custom_financials add column if not exists revenue numeric default 0;
