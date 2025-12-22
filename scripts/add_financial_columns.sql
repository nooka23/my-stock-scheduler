-- =====================================================
-- company_financials 테이블에 컬럼 추가
-- =====================================================

-- 자본총계(지배) 컬럼 추가
ALTER TABLE company_financials
ADD COLUMN IF NOT EXISTS equity_controlling BIGINT;

-- 부채총계 컬럼 추가
ALTER TABLE company_financials
ADD COLUMN IF NOT EXISTS liabilities BIGINT;

-- 컬럼 추가 확인
COMMENT ON COLUMN company_financials.equity_controlling IS '자본총계(지배) - 지배기업 소유주 지분';
COMMENT ON COLUMN company_financials.liabilities IS '부채총계';
