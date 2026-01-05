-- =====================================================
-- 테마/업종별 거래대금 지표 테이블 생성
-- =====================================================
--
-- 목적: 업종/테마별 자금 흐름 파악
-- - 거래대금 비중: 시장 내 해당 업종/테마의 거래대금 비중
-- - 거래대금 가중 수익률: 거래가 활발한 종목의 방향성 반영
-- - 거래대금 급증 비율: 테마 과열/관심도 판단
--

-- 1. 테마 거래대금 지표 테이블
CREATE TABLE IF NOT EXISTS theme_trading_metrics (
  id SERIAL PRIMARY KEY,
  theme_id INTEGER NOT NULL,
  date DATE NOT NULL,

  -- 거래대금 관련 지표
  total_trading_value NUMERIC(20, 2),           -- 테마 총 거래대금 (원)
  market_trading_value NUMERIC(20, 2),          -- 전체 시장 거래대금 (원)
  trading_value_ratio NUMERIC(8, 4),            -- 거래대금 비중 (%)

  -- 거래대금 가중 수익률
  weighted_return NUMERIC(8, 4),                -- 거래대금 가중 수익률 (%)

  -- 거래대금 급증 지표
  avg_surge_ratio NUMERIC(8, 4),                -- 평균 급증 비율 (배수)
  surge_count INTEGER DEFAULT 0,                 -- 급증 종목 수 (2배 이상)
  total_stock_count INTEGER DEFAULT 0,           -- 전체 종목 수

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(theme_id, date),
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

-- 2. 업종 거래대금 지표 테이블
CREATE TABLE IF NOT EXISTS industry_trading_metrics (
  id SERIAL PRIMARY KEY,
  industry_id INTEGER NOT NULL,
  date DATE NOT NULL,

  -- 거래대금 관련 지표
  total_trading_value NUMERIC(20, 2),           -- 업종 총 거래대금 (원)
  market_trading_value NUMERIC(20, 2),          -- 전체 시장 거래대금 (원)
  trading_value_ratio NUMERIC(8, 4),            -- 거래대금 비중 (%)

  -- 거래대금 가중 수익률
  weighted_return NUMERIC(8, 4),                -- 거래대금 가중 수익률 (%)

  -- 거래대금 급증 지표
  avg_surge_ratio NUMERIC(8, 4),                -- 평균 급증 비율 (배수)
  surge_count INTEGER DEFAULT 0,                 -- 급증 종목 수 (2배 이상)
  total_stock_count INTEGER DEFAULT 0,           -- 전체 종목 수

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(industry_id, date),
  FOREIGN KEY (industry_id) REFERENCES industries(id) ON DELETE CASCADE
);

-- =====================================================
-- 인덱스 생성 (성능 최적화)
-- =====================================================

-- 날짜별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_date ON theme_trading_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_date ON industry_trading_metrics(date DESC);

-- 테마/업종별 시계열 조회 최적화
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_theme_date ON theme_trading_metrics(theme_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_industry_date ON industry_trading_metrics(industry_id, date DESC);

-- 거래대금 비중으로 정렬
CREATE INDEX IF NOT EXISTS idx_theme_trading_metrics_ratio ON theme_trading_metrics(trading_value_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_industry_trading_metrics_ratio ON industry_trading_metrics(trading_value_ratio DESC);

-- =====================================================
-- RLS (Row Level Security) 설정
-- =====================================================

ALTER TABLE theme_trading_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON theme_trading_metrics;
CREATE POLICY "Public read access" ON theme_trading_metrics FOR SELECT USING (true);

ALTER TABLE industry_trading_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON industry_trading_metrics;
CREATE POLICY "Public read access" ON industry_trading_metrics FOR SELECT USING (true);

-- =====================================================
-- 유용한 뷰 생성
-- =====================================================

-- 테마 지표 + 테마 정보 조인 뷰
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

-- 업종 지표 + 업종 정보 조인 뷰
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
-- 유용한 쿼리 예시
-- =====================================================

-- 최근 거래일 거래대금 비중 TOP 10 테마
-- SELECT * FROM v_theme_trading_metrics
-- WHERE date = (SELECT MAX(date) FROM theme_trading_metrics)
-- ORDER BY trading_value_ratio DESC
-- LIMIT 10;

-- 특정 테마의 최근 30일 거래대금 추이
-- SELECT date, trading_value_ratio, weighted_return, surge_count
-- FROM theme_trading_metrics
-- WHERE theme_id = 1
-- AND date >= CURRENT_DATE - INTERVAL '30 days'
-- ORDER BY date DESC;

-- 거래대금 급증 중인 테마 (급증 종목 비율 50% 이상)
-- SELECT *
-- FROM v_theme_trading_metrics
-- WHERE date = (SELECT MAX(date) FROM theme_trading_metrics)
-- AND total_stock_count > 0
-- AND (surge_count::float / total_stock_count::float) >= 0.5
-- ORDER BY surge_count DESC;

-- 자금 유입 중인 테마 (거래대금 비중↑ + 가중 수익률↑)
-- SELECT t1.theme_name,
--        t1.trading_value_ratio as current_ratio,
--        t2.trading_value_ratio as prev_ratio,
--        t1.weighted_return
-- FROM v_theme_trading_metrics t1
-- JOIN v_theme_trading_metrics t2 ON t1.theme_id = t2.theme_id
-- WHERE t1.date = (SELECT MAX(date) FROM theme_trading_metrics)
-- AND t2.date = (SELECT MAX(date) FROM theme_trading_metrics WHERE date < t1.date)
-- AND t1.trading_value_ratio > t2.trading_value_ratio
-- AND t1.weighted_return > 0
-- ORDER BY (t1.trading_value_ratio - t2.trading_value_ratio) DESC
-- LIMIT 10;
