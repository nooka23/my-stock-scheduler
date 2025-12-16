-- user_portfolio 테이블에 청산 관련 필드 추가

-- 청산 여부 플래그
ALTER TABLE user_portfolio
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE;

-- 청산 날짜
ALTER TABLE user_portfolio
ADD COLUMN IF NOT EXISTS close_date DATE;

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_portfolio_is_closed ON user_portfolio(is_closed);
