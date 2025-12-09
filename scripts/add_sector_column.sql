-- companies 테이블에 업종(sector) 컬럼 추가
alter table public.companies 
add column if not exists sector text;

-- 설명: FinanceDataReader 등에서 가져온 업종 정보를 저장할 컬럼입니다.
