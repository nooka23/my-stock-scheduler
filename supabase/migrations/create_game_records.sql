-- 게임 기록 테이블 생성
CREATE TABLE IF NOT EXISTS game_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_code VARCHAR(20) NOT NULL,
  company_name VARCHAR(100) NOT NULL,
  cutoff_date DATE NOT NULL,
  user_answer BOOLEAN NOT NULL,
  correct_answer BOOLEAN NOT NULL,
  price_change DECIMAL(10, 2) NOT NULL,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_game_records_user_id ON game_records(user_id);
CREATE INDEX IF NOT EXISTS idx_game_records_created_at ON game_records(created_at);
CREATE INDEX IF NOT EXISTS idx_game_records_user_date ON game_records(user_id, created_at);

-- RLS (Row Level Security) 활성화
ALTER TABLE game_records ENABLE ROW LEVEL SECURITY;

-- 정책: 사용자는 자신의 기록만 조회 가능
CREATE POLICY "Users can view own game records"
  ON game_records FOR SELECT
  USING (auth.uid() = user_id);

-- 정책: 사용자는 자신의 기록만 삽입 가능
CREATE POLICY "Users can insert own game records"
  ON game_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 정책: 사용자는 자신의 기록만 삭제 가능
CREATE POLICY "Users can delete own game records"
  ON game_records FOR DELETE
  USING (auth.uid() = user_id);
