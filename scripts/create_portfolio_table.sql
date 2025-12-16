-- 포트폴리오 관리 테이블 생성
CREATE TABLE IF NOT EXISTS user_portfolio (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    entry_date DATE NOT NULL,
    trade_type TEXT NOT NULL, -- 매매 방식
    company_code TEXT NOT NULL,
    company_name TEXT NOT NULL,
    position_type TEXT NOT NULL, -- 롱/숏
    position_size INTEGER NOT NULL, -- 현재 포지션 규모
    avg_price DECIMAL(12, 2) NOT NULL, -- 포지션 평균 가격
    stop_loss DECIMAL(12, 2) NOT NULL, -- 손절가격
    initial_position_size INTEGER NOT NULL, -- 최초 포지션 규모 (R 계산용)
    realized_pnl DECIMAL(15, 2) DEFAULT 0, -- 실현 손익
    sector TEXT, -- 업종
    comment TEXT, -- 코멘트
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_portfolio_user_id ON user_portfolio(user_id);
CREATE INDEX IF NOT EXISTS idx_user_portfolio_company_code ON user_portfolio(company_code);
CREATE INDEX IF NOT EXISTS idx_user_portfolio_entry_date ON user_portfolio(entry_date DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE user_portfolio ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 사용자는 자신의 포트폴리오만 조회 가능
CREATE POLICY "Users can view own portfolio"
    ON user_portfolio FOR SELECT
    USING (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 포트폴리오만 삽입 가능
CREATE POLICY "Users can insert own portfolio"
    ON user_portfolio FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 포트폴리오만 수정 가능
CREATE POLICY "Users can update own portfolio"
    ON user_portfolio FOR UPDATE
    USING (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 포트폴리오만 삭제 가능
CREATE POLICY "Users can delete own portfolio"
    ON user_portfolio FOR DELETE
    USING (auth.uid() = user_id);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
CREATE TRIGGER update_user_portfolio_updated_at
    BEFORE UPDATE ON user_portfolio
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
