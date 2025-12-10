-- [정리] 사용하지 않는 컬럼 및 함수 삭제

-- 1. rs_rankings_v2 테이블에서 안 쓰는 컬럼 제거
-- (이전에 add_trading_value_column.sql로 추가했던 컬럼들)
alter table public.rs_rankings_v2
drop column if exists avg_amount_50,
drop column if exists rank_amount;

-- 2. 사용하지 않는 RPC 함수 제거
-- (이전에 create_rs_filter_rpc.sql로 생성했던 함수)
drop function if exists public.get_filtered_rs_stocks;
