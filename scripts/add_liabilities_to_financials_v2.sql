-- 1. liabilities(부채총계) 컬럼 추가
ALTER TABLE company_financials_v2 
ADD COLUMN IF NOT EXISTS liabilities bigint;

-- 2. 기존 데이터에 대해 자산 - 자본으로 부채총계 값 채우기
UPDATE company_financials_v2
SET liabilities = assets - equity
WHERE liabilities IS NULL 
  AND assets IS NOT NULL 
  AND equity IS NOT NULL;

-- 3. 확인 (상위 10개)
SELECT company_code, year, quarter, assets, equity, liabilities 
FROM company_financials_v2 
LIMIT 10;
