-- trading_candidates 테이블 생성
CREATE TABLE IF NOT EXISTS trading_candidates (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL,
    company_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    trade_type TEXT,
    stop_loss NUMERIC DEFAULT 0,
    one_r NUMERIC DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, group_name, company_code)
);

-- 인덱스 생성 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_trading_candidates_user_id
ON trading_candidates(user_id);

CREATE INDEX IF NOT EXISTS idx_trading_candidates_group_name
ON trading_candidates(user_id, group_name);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_trading_candidates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_trading_candidates_updated_at ON trading_candidates;
CREATE TRIGGER trigger_update_trading_candidates_updated_at
    BEFORE UPDATE ON trading_candidates
    FOR EACH ROW
    EXECUTE FUNCTION update_trading_candidates_updated_at();

-- Row Level Security (RLS) 활성화
ALTER TABLE trading_candidates ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 사용자는 자신의 데이터만 조회 가능
CREATE POLICY "Users can view their own trading candidates"
ON trading_candidates
FOR SELECT
USING (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 데이터만 삽입 가능
CREATE POLICY "Users can insert their own trading candidates"
ON trading_candidates
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 데이터만 업데이트 가능
CREATE POLICY "Users can update their own trading candidates"
ON trading_candidates
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 데이터만 삭제 가능
CREATE POLICY "Users can delete their own trading candidates"
ON trading_candidates
FOR DELETE
USING (auth.uid() = user_id);

-- 테이블 설명 추가
COMMENT ON TABLE trading_candidates IS '사용자별 매매 후보 종목 데이터';
COMMENT ON COLUMN trading_candidates.user_id IS '사용자 ID';
COMMENT ON COLUMN trading_candidates.group_name IS '관심종목 그룹명';
COMMENT ON COLUMN trading_candidates.company_code IS '종목 코드';
COMMENT ON COLUMN trading_candidates.company_name IS '종목명';
COMMENT ON COLUMN trading_candidates.trade_type IS '매매 유형 (매수/매도 등)';
COMMENT ON COLUMN trading_candidates.stop_loss IS '손절 가격';
COMMENT ON COLUMN trading_candidates.one_r IS '1R 값';
COMMENT ON COLUMN trading_candidates.comment IS '코멘트/메모';
