-- 1. trading_value_rankings 테이블에 60일 평균 및 순위 컬럼 추가
alter table public.trading_value_rankings
add column if not exists avg_amount_60 numeric,
add column if not exists rank_amount_60 integer;

-- 2. 뷰(View) 업데이트
-- 기존 뷰를 삭제하고 새로 생성 (컬럼 추가 반영)
create or replace view public.rs_rankings_with_volume as
select 
  r.date,
  r.code,
  r.score_weighted,
  r.rank_weighted,
  r.score_3m,
  r.rank_3m,
  r.score_6m,
  r.rank_6m,
  r.score_12m,
  r.rank_12m,
  t.avg_amount_50,
  t.rank_amount,     -- 50일 거래대금 순위 (기존 유지)
  t.avg_amount_60,   -- 60일 평균 거래대금 (신규)
  t.rank_amount_60   -- 60일 거래대금 순위 (신규)
from rs_rankings_v2 r
left join trading_value_rankings t on r.date = t.date and r.code = t.code;
