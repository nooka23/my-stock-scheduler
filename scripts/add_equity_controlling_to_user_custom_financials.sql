-- Add equity_controlling to user_custom_financials for PBR input
ALTER TABLE user_custom_financials
ADD COLUMN IF NOT EXISTS equity_controlling NUMERIC;

COMMENT ON COLUMN user_custom_financials.equity_controlling IS '지배지분 자본총계 (원 단위)';
