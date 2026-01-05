-- =====================================================
-- 오류 수정: 업종/테마 지수 테이블 강제 재생성
-- =====================================================
-- Supabase SQL Editor에서 실행
-- =====================================================

-- 1. 기존 테이블 삭제 (있다면)
DROP TABLE IF EXISTS theme_trading_metrics CASCADE;
DROP TABLE IF EXISTS industry_trading_metrics CASCADE;
DROP TABLE IF EXISTS theme_indices CASCADE;
DROP TABLE IF EXISTS industry_indices CASCADE;

-- 2. 테마 등가중 지수 테이블
CREATE TABLE theme_indices (
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

-- 3. 업종 등가중 지수 테이블
CREATE TABLE industry_indices (
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

-- 4. 테마 거래대금 지표 테이블
CREATE TABLE theme_trading_metrics (
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

-- 5. 업종 거래대금 지표 테이블
CREATE TABLE industry_trading_metrics (
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

-- 인덱스 생성
CREATE INDEX idx_theme_indices_date ON theme_indices(date DESC);
CREATE INDEX idx_industry_indices_date ON industry_indices(date DESC);
CREATE INDEX idx_theme_indices_theme_date ON theme_indices(theme_id, date DESC);
CREATE INDEX idx_industry_indices_industry_date ON industry_indices(industry_id, date DESC);

CREATE INDEX idx_theme_trading_metrics_date ON theme_trading_metrics(date DESC);
CREATE INDEX idx_industry_trading_metrics_date ON industry_trading_metrics(date DESC);
CREATE INDEX idx_theme_trading_metrics_theme_date ON theme_trading_metrics(theme_id, date DESC);
CREATE INDEX idx_industry_trading_metrics_industry_date ON industry_trading_metrics(industry_id, date DESC);

-- RLS 활성화
ALTER TABLE theme_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_trading_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_trading_metrics ENABLE ROW LEVEL SECURITY;

-- Public 읽기 권한
DROP POLICY IF EXISTS "Public read access" ON theme_indices;
CREATE POLICY "Public read access" ON theme_indices FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read access" ON industry_indices;
CREATE POLICY "Public read access" ON industry_indices FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read access" ON theme_trading_metrics;
CREATE POLICY "Public read access" ON theme_trading_metrics FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read access" ON industry_trading_metrics;
CREATE POLICY "Public read access" ON industry_trading_metrics FOR SELECT USING (true);

-- 완료 확인
SELECT 'Tables created successfully!' as status;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE '%indices' OR table_name LIKE '%trading_metrics'
ORDER BY table_name;
