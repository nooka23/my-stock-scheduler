-- company_financials_v2 테이블 생성
-- 실제 재무 데이터(DART 분기별)와 예측치(네이버 연간)를 분리하여 저장

CREATE TABLE IF NOT EXISTS company_financials_v2 (
    company_code TEXT NOT NULL,
    year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,          -- 분기 (1, 2, 3, 4) / 연간 예측치는 0

    -- 재무 데이터 (단위: 원)
    revenue BIGINT,                    -- 매출액
    op_income BIGINT,                  -- 영업이익
    net_income BIGINT,                 -- 당기순이익
    assets BIGINT,                     -- 자산총계
    equity BIGINT,                     -- 자본총계
    shares_outstanding BIGINT,         -- 발행주식수

    -- 주가 지표
    eps NUMERIC,                       -- EPS (주당순이익)
    per NUMERIC,                       -- PER (주가수익비율)
    bps NUMERIC,                       -- BPS (주당순자산가치)
    pbr NUMERIC,                       -- PBR (주가순자산비율)
    div_yield NUMERIC,                 -- 현금배당수익률

    -- 데이터 출처 구분
    data_source TEXT NOT NULL,         -- 'dart' (실제 발표 데이터) 또는 'forecast' (예측치)
    is_consolidated BOOLEAN DEFAULT true,  -- 연결재무제표 여부 (개별/연결 구분)

    -- 메타 정보
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (company_code, year, quarter, data_source)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_financials_v2_company_code
ON company_financials_v2(company_code);

CREATE INDEX IF NOT EXISTS idx_financials_v2_year
ON company_financials_v2(year);

CREATE INDEX IF NOT EXISTS idx_financials_v2_data_source
ON company_financials_v2(data_source);

CREATE INDEX IF NOT EXISTS idx_financials_v2_company_year
ON company_financials_v2(company_code, year);

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_financials_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_financials_v2_updated_at ON company_financials_v2;
CREATE TRIGGER trigger_update_financials_v2_updated_at
    BEFORE UPDATE ON company_financials_v2
    FOR EACH ROW
    EXECUTE FUNCTION update_financials_v2_updated_at();

-- 테이블 설명
COMMENT ON TABLE company_financials_v2 IS '기업 재무 데이터 (분기별 실적 및 연간 예측치)';
COMMENT ON COLUMN company_financials_v2.company_code IS '종목 코드';
COMMENT ON COLUMN company_financials_v2.year IS '회계 연도';
COMMENT ON COLUMN company_financials_v2.quarter IS '분기 (1~4: 분기별, 0: 연간 예측치)';
COMMENT ON COLUMN company_financials_v2.revenue IS '매출액 (원)';
COMMENT ON COLUMN company_financials_v2.op_income IS '영업이익 (원)';
COMMENT ON COLUMN company_financials_v2.net_income IS '당기순이익 (원)';
COMMENT ON COLUMN company_financials_v2.assets IS '자산총계 (원)';
COMMENT ON COLUMN company_financials_v2.equity IS '자본총계 (원)';
COMMENT ON COLUMN company_financials_v2.shares_outstanding IS '발행주식수';
COMMENT ON COLUMN company_financials_v2.data_source IS '데이터 출처: dart(실제) / forecast(예측)';
COMMENT ON COLUMN company_financials_v2.is_consolidated IS '연결재무제표 여부';
