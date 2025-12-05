-- companies 테이블에 시가총액 컬럼 추가
alter table public.companies add column if not exists marcap numeric;
