-- =====================================================
-- 테마/업종별 등가중 지수 테이블 생성
-- =====================================================

-- 1. 테마 등가중 지수 테이블
CREATE TABLE IF NOT EXISTS theme_indices (
  id SERIAL PRIMARY KEY,
  theme_id INTEGER NOT NULL,
  date DATE NOT NULL,
  index_value NUMERIC(12, 4) NOT NULL,        -- 지수 값 (100 기준)
  daily_return NUMERIC(8, 4),                 -- 일일 수익률 (%)
  stock_count INTEGER,                         -- 구성 종목 수
  avg_close NUMERIC(12, 2),                   -- 평균 종가 (참고용)
  total_market_cap NUMERIC(20, 2),            -- 총 시가총액 (참고용)
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(theme_id, date),
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- 2. 업종 등가중 지수 테이블
CREATE TABLE IF NOT EXISTS industry_indices (
  id SERIAL PRIMARY KEY,
  industry_id INTEGER NOT NULL,
  date DATE NOT NULL,
  index_value NUMERIC(12, 4) NOT NULL,        -- 지수 값 (100 기준)
  daily_return NUMERIC(8, 4),                 -- 일일 수익률 (%)
  stock_count INTEGER,                         -- 구성 종목 수
  avg_close NUMERIC(12, 2),                   -- 평균 종가 (참고용)
  total_market_cap NUMERIC(20, 2),            -- 총 시가총액 (참고용)
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(industry_id, date),
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);

-- =====================================================
-- 인덱스 생성 (성능 최적화)
-- =====================================================

-- 날짜별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_theme_indices_date ON theme_indices(date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_indices_date ON industry_indices(date DESC);

-- 테마/업종별 시계열 조회 최적화
CREATE INDEX IF NOT EXISTS idx_theme_indices_theme_date ON theme_indices(theme_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_indices_industry_date ON industry_indices(industry_id, date DESC);

-- 지수 값 범위 검색 최적화
CREATE INDEX IF NOT EXISTS idx_theme_indices_value ON theme_indices(index_value);
CREATE INDEX IF NOT EXISTS idx_industry_indices_value ON industry_indices(index_value);

-- =====================================================
-- RLS (Row Level Security) 설정
-- =====================================================

ALTER TABLE theme_indices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON theme_indices;
CREATE POLICY "Public read access" ON theme_indices FOR SELECT USING (true);

ALTER TABLE industry_indices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON industry_indices;
CREATE POLICY "Public read access" ON industry_indices FOR SELECT USING (true);

-- =====================================================
-- 유용한 뷰 생성
-- =====================================================

-- 테마 지수 + 테마 정보 조인 뷰
CREATE OR REPLACE VIEW v_theme_indices AS
SELECT
  ti.date,
  t.id as theme_id,
  t.code as theme_code,
  t.name as theme_name,
  ti.index_value,
  ti.daily_return,
  ti.stock_count,
  ti.avg_close,
  ti.total_market_cap
FROM theme_indices ti
JOIN themes t ON ti.theme_id = t.id
ORDER BY ti.date DESC, ti.index_value DESC;

-- 업종 지수 + 업종 정보 조인 뷰
CREATE OR REPLACE VIEW v_industry_indices AS
SELECT
  ii.date,
  i.id as industry_id,
  i.code as industry_code,
  i.name as industry_name,
  ii.index_value,
  ii.daily_return,
  ii.stock_count,
  ii.avg_close,
  ii.total_market_cap
FROM industry_indices ii
JOIN industries i ON ii.industry_id = i.id
ORDER BY ii.date DESC, ii.index_value DESC;

-- =====================================================
-- 유용한 쿼리 함수
-- =====================================================

-- 특정 기간 테마 지수 수익률 계산 함수
CREATE OR REPLACE FUNCTION get_theme_index_return(
  p_theme_id INTEGER,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_start_value NUMERIC;
  v_end_value NUMERIC;
BEGIN
  -- 시작일 지수
  SELECT index_value INTO v_start_value
  FROM theme_indices
  WHERE theme_id = p_theme_id AND date = p_start_date;

  -- 종료일 지수
  SELECT index_value INTO v_end_value
  FROM theme_indices
  WHERE theme_id = p_theme_id AND date = p_end_date;

  -- 수익률 계산
  IF v_start_value IS NULL OR v_end_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN ((v_end_value - v_start_value) / v_start_value * 100);
END;
$$ LANGUAGE plpgsql;

-- 특정 기간 업종 지수 수익률 계산 함수
CREATE OR REPLACE FUNCTION get_industry_index_return(
  p_industry_id INTEGER,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_start_value NUMERIC;
  v_end_value NUMERIC;
BEGIN
  SELECT index_value INTO v_start_value
  FROM industry_indices
  WHERE industry_id = p_industry_id AND date = p_start_date;

  SELECT index_value INTO v_end_value
  FROM industry_indices
  WHERE industry_id = p_industry_id AND date = p_end_date;

  IF v_start_value IS NULL OR v_end_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN ((v_end_value - v_start_value) / v_start_value * 100);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 참고: 유용한 쿼리 예시
-- =====================================================

-- 최근 거래일 테마별 수익률 TOP 10
-- SELECT * FROM v_theme_indices
-- WHERE date = (SELECT MAX(date) FROM theme_indices)
-- ORDER BY daily_return DESC NULLS LAST
-- LIMIT 10;

-- 특정 테마의 최근 30일 지수 추이
-- SELECT date, index_value, daily_return
-- FROM theme_indices
-- WHERE theme_id = 1
-- AND date >= CURRENT_DATE - INTERVAL '30 days'
-- ORDER BY date DESC;

-- 1개월 수익률 TOP 테마
-- SELECT
--   t.name,
--   get_theme_index_return(t.id, CURRENT_DATE - 30, CURRENT_DATE) as return_1m
-- FROM themes t
-- ORDER BY return_1m DESC NULLS LAST
-- LIMIT 10;
