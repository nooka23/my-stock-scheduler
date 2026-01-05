-- =====================================================
-- 구성 종목 변경 이력을 추적하기 위한 DB 스키마 수정
-- =====================================================
-- 경고: 기존 데이터에 영향을 줄 수 있습니다
-- =====================================================

-- 1. company_themes에 유효기간 컬럼 추가
ALTER TABLE company_themes
ADD COLUMN IF NOT EXISTS valid_from DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS valid_to DATE DEFAULT NULL;

-- 2. company_industries에도 동일하게
ALTER TABLE company_industries
ADD COLUMN IF NOT EXISTS valid_from DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS valid_to DATE DEFAULT NULL;

-- 3. 기존 데이터는 created_at을 valid_from으로 설정
UPDATE company_themes
SET valid_from = created_at::date
WHERE valid_from IS NULL;

UPDATE company_industries
SET valid_from = created_at::date
WHERE valid_from IS NULL;

-- 4. 날짜별 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_company_themes_valid_dates
ON company_themes(theme_id, valid_from, valid_to);

CREATE INDEX IF NOT EXISTS idx_company_industries_valid_dates
ON company_industries(industry_id, valid_from, valid_to);

-- =====================================================
-- 사용 예시:
-- =====================================================
-- 특정 날짜의 테마 구성 종목 조회
-- SELECT company_code
-- FROM company_themes
-- WHERE theme_id = 1
-- AND valid_from <= '2024-06-01'
-- AND (valid_to IS NULL OR valid_to > '2024-06-01');
-- =====================================================
