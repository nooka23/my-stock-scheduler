-- =====================================================
-- 업종/테마 지수 분석 페이지용 통합 테이블 생성 스크립트
-- =====================================================
-- 실행 순서:
-- 1. 이 파일 전체를 복사
-- 2. Supabase Dashboard → SQL Editor → New Query
-- 3. 붙여넣기 후 Run
-- =====================================================

-- =====================================================
-- PART 1: 등가중 지수 테이블 (기존)
-- =====================================================

-- 1. 테마 등가중 지수 테이블
CREATE TABLE IF NOT EXISTS theme_indices (
  id SERIAL PRIMARY KEY,
  theme_id INTEGER NOT NULL,
  date DATE NOT NULL,
  index_value NUMERIC(12, 4) NOT NULL,
  daily_return NUMERIC(8, 4),
  stock_count INTEGER,
  avg_close NUMERIC(12, 2),
  total_market_cap NUMERIC(20, 2),
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(theme_id, date),
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- 2. 업종 등가중 지수 테이블
CREATE TABLE IF NOT EXISTS industry_indices (
  id SERIAL PRIMARY KEY,
  industry_id INTEGER NOT NULL,
  date DATE NOT NULL,
  index_value NUMERIC(12, 4) NOT NULL,
  daily_return NUMERIC(8, 4),
  stock_count INTEGER,
  avg_close NUMERIC(12, 2),
  total_market_cap NUMERIC(20, 2),
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(industry_id, date),
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);

-- 등가중 지수 인덱스
CREATE INDEX IF NOT EXISTS idx_theme_indices_date ON theme_indices(date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_indices_date ON industry_indices(date DESC);
CREATE INDEX IF NOT EXISTS idx_theme_indices_theme_date ON theme_indices(theme_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_indices_industry_date ON industry_indices(industry_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_theme_indices_value ON theme_indices(index_value);
CREATE INDEX IF NOT EXISTS idx_industry_indices_value ON industry_indices(index_value);

-- 등가중 지수 RLS
ALTER TABLE theme_indices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON theme_indices;
CREATE POLICY "Public read access" ON theme_indices FOR SELECT USING (true);

ALTER TABLE industry_indices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON industry_indices;
CREATE POLICY "Public read access" ON industry_indices FOR SELECT USING (true);

-- =====================================================
-- PART 2: 거래대금 지표 테이블 (신규)
-- =====================================================

-- 3. 테마 거래대금 지표 테이블
CREATE TABLE IF NOT EXISTS theme_trading_metrics (
  id SERIAL PRIMARY KEY,
  theme_id INTEGER NOT NULL,
  date DATE NOT NULL,

  total_trading_value NUMERIC(20, 2),
  market_trading_value NUMERIC(20, 2),
  trading_value_ratio NUMERIC(8, 4),
  weighted_return NUMERIC(8, 4),
  avg_surge_ratio NUMERIC(8, 4),
  surge_count INTEGER DEFAULT 0,
  total_stock_count INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(theme_id, date),
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- 4. 업종 거래대금 지표 테이블
CREATE TABLE IF NOT EXISTS industry_trading_metrics (
  id SERIAL PRIMARY KEY,
  industry_id INTEGER NOT NULL,
  date DATE NOT NULL,

  total_trading_value NUMERIC(20, 2),
  market_trading_value NUMERIC(20, 2),
  trading_value_ratio NUMERIC(8, 4),
  weighted_return NUMERIC(8, 4),
  avg_surge_ratio NUMERIC(8, 4),
  surge_count INTEGER DEFAULT 0,
  total_stock_count INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(industry_id, date),
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);

-- 거래대금 지표 인덱스
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_date ON theme_trading_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_date ON industry_trading_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_theme_date ON theme_trading_metrics(theme_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_industry_date ON industry_trading_metrics(industry_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_ratio ON theme_trading_metrics(trading_value_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_ratio ON industry_trading_metrics(trading_value_ratio DESC);

-- 거래대금 지표 RLS
ALTER TABLE theme_trading_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON theme_trading_metrics;
CREATE POLICY "Public read access" ON theme_trading_metrics FOR SELECT USING (true);

ALTER TABLE industry_trading_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON industry_trading_metrics;
CREATE POLICY "Public read access" ON industry_trading_metrics FOR SELECT USING (true);

-- =====================================================
-- PART 3: 유용한 뷰 생성
-- =====================================================

-- 테마 지수 뷰
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

-- 업종 지수 뷰
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

-- 테마 거래대금 지표 뷰
CREATE OR REPLACE VIEW v_theme_trading_metrics AS
SELECT
  tm.date,
  t.id as theme_id,
  t.code as theme_code,
  t.name as theme_name,
  tm.total_trading_value,
  tm.market_trading_value,
  tm.trading_value_ratio,
  tm.weighted_return,
  tm.avg_surge_ratio,
  tm.surge_count,
  tm.total_stock_count
FROM theme_trading_metrics tm
JOIN themes t ON tm.theme_id = t.id
ORDER BY tm.date DESC, tm.trading_value_ratio DESC;

-- 업종 거래대금 지표 뷰
CREATE OR REPLACE VIEW v_industry_trading_metrics AS
SELECT
  im.date,
  i.id as industry_id,
  i.code as industry_code,
  i.name as industry_name,
  im.total_trading_value,
  im.market_trading_value,
  im.trading_value_ratio,
  im.weighted_return,
  im.avg_surge_ratio,
  im.surge_count,
  im.total_stock_count
FROM industry_trading_metrics im
JOIN industries i ON im.industry_id = i.id
ORDER BY im.date DESC, im.trading_value_ratio DESC;

-- =====================================================
-- 완료!
-- =====================================================
-- 다음 단계:
-- 1. Python 스크립트 실행: scripts/calculate_equal_weight_indices.py
-- 2. Python 스크립트 실행: scripts/calculate_trading_metrics.py
-- 3. 페이지 접속: http://localhost:3000/discovery/sector-index
-- =====================================================
