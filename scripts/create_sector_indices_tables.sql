-- 업종 지수 테이블 생성
CREATE TABLE IF NOT EXISTS sector_indices (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sector_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 업종별 종목 테이블 생성
CREATE TABLE IF NOT EXISTS sector_stocks (
  id BIGSERIAL PRIMARY KEY,
  sector_id BIGINT NOT NULL REFERENCES sector_indices(id) ON DELETE CASCADE,
  company_code VARCHAR(10) NOT NULL,
  company_name VARCHAR(100) NOT NULL,
  marcap BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sector_indices_user_id ON sector_indices(user_id);
CREATE INDEX IF NOT EXISTS idx_sector_stocks_sector_id ON sector_stocks(sector_id);
CREATE INDEX IF NOT EXISTS idx_sector_stocks_company_code ON sector_stocks(company_code);

-- RLS (Row Level Security) 활성화
ALTER TABLE sector_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_stocks ENABLE ROW LEVEL SECURITY;

-- RLS 정책 생성 - sector_indices
CREATE POLICY "Users can view their own sector indices"
  ON sector_indices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sector indices"
  ON sector_indices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sector indices"
  ON sector_indices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sector indices"
  ON sector_indices FOR DELETE
  USING (auth.uid() = user_id);

-- RLS 정책 생성 - sector_stocks
CREATE POLICY "Users can view sector stocks they own"
  ON sector_stocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sector_indices
      WHERE sector_indices.id = sector_stocks.sector_id
      AND sector_indices.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert sector stocks they own"
  ON sector_stocks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sector_indices
      WHERE sector_indices.id = sector_stocks.sector_id
      AND sector_indices.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update sector stocks they own"
  ON sector_stocks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sector_indices
      WHERE sector_indices.id = sector_stocks.sector_id
      AND sector_indices.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete sector stocks they own"
  ON sector_stocks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sector_indices
      WHERE sector_indices.id = sector_stocks.sector_id
      AND sector_indices.user_id = auth.uid()
    )
  );

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER update_sector_indices_updated_at
  BEFORE UPDATE ON sector_indices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
