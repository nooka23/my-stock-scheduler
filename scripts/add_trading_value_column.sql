-- rs_rankings_v2 테이블에 거래대금 관련 컬럼 추가
-- 50일 평균 거래대금 (avg_amount_50)
-- 거래대금 순위 (rank_amount, 0~99점)

alter table public.rs_rankings_v2
add column if not exists avg_amount_50 numeric,
add column if not exists rank_amount integer;
