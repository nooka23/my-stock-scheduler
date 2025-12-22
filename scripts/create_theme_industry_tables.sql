-- =====================================================
-- 테마/업종 관련 테이블 생성 스크립트
-- =====================================================

-- 1. 테마 테이블
CREATE TABLE IF NOT EXISTS themes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,  -- 테마 고유 코드 (네이버 금융의 no)
  name TEXT NOT NULL,          -- 테마 이름
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. 업종 테이블
CREATE TABLE IF NOT EXISTS industries (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,  -- 업종 고유 코드 (네이버 금융의 no)
  name TEXT NOT NULL,          -- 업종 이름
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. 종목-테마 매핑 테이블
CREATE TABLE IF NOT EXISTS company_themes (
  id SERIAL PRIMARY KEY,
  company_code TEXT NOT NULL,  -- companies 테이블의 code 참조
  theme_id INTEGER NOT NULL,   -- themes 테이블의 id 참조
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_code, theme_id),
  FOREIGN KEY (company_code) REFERENCES companies(code) ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- 4. 종목-업종 매핑 테이블
CREATE TABLE IF NOT EXISTS company_industries (
  id SERIAL PRIMARY KEY,
  company_code TEXT NOT NULL,     -- companies 테이블의 code 참조
  industry_id INTEGER NOT NULL,   -- industries 테이블의 id 참조
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_code, industry_id),
  FOREIGN KEY (company_code) REFERENCES companies(code) ON DELETE CASCADE,
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);

-- =====================================================
-- 인덱스 생성 (성능 최적화)
-- =====================================================

-- 테마 코드로 빠른 조회
CREATE INDEX IF NOT EXISTS idx_themes_code ON themes(code);

-- 업종 코드로 빠른 조회
CREATE INDEX IF NOT EXISTS idx_industries_code ON industries(code);

-- 종목 코드로 테마 조회
CREATE INDEX IF NOT EXISTS idx_company_themes_company_code ON company_themes(company_code);

-- 테마로 종목 조회
CREATE INDEX IF NOT EXISTS idx_company_themes_theme_id ON company_themes(theme_id);

-- 종목 코드로 업종 조회
CREATE INDEX IF NOT EXISTS idx_company_industries_company_code ON company_industries(company_code);

-- 업종으로 종목 조회
CREATE INDEX IF NOT EXISTS idx_company_industries_industry_id ON company_industries(industry_id);

-- =====================================================
-- 업데이트 시간 자동 갱신 트리거
-- =====================================================

-- 업데이트 시간 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 테마 테이블 트리거
DROP TRIGGER IF EXISTS update_themes_updated_at ON themes;
CREATE TRIGGER update_themes_updated_at
    BEFORE UPDATE ON themes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 업종 테이블 트리거
DROP TRIGGER IF EXISTS update_industries_updated_at ON industries;
CREATE TRIGGER update_industries_updated_at
    BEFORE UPDATE ON industries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 참고: 유용한 쿼리 예시
-- =====================================================

-- 특정 종목의 모든 테마 조회
-- SELECT t.* FROM themes t
-- JOIN company_themes ct ON t.id = ct.theme_id
-- WHERE ct.company_code = '005930';

-- 특정 테마에 속한 모든 종목 조회
-- SELECT c.* FROM companies c
-- JOIN company_themes ct ON c.code = ct.company_code
-- JOIN themes t ON ct.theme_id = t.id
-- WHERE t.code = '584';

-- 특정 종목의 모든 업종 조회
-- SELECT i.* FROM industries i
-- JOIN company_industries ci ON i.id = ci.industry_id
-- WHERE ci.company_code = '005930';

-- 종목이 가장 많은 테마 TOP 10
-- SELECT t.name, COUNT(ct.company_code) as company_count
-- FROM themes t
-- LEFT JOIN company_themes ct ON t.id = ct.theme_id
-- GROUP BY t.id, t.name
-- ORDER BY company_count DESC
-- LIMIT 10;
