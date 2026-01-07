-- Add shares_outstanding to user_custom_financials for per-share calculations
ALTER TABLE user_custom_financials
ADD COLUMN IF NOT EXISTS shares_outstanding BIGINT;

COMMENT ON COLUMN user_custom_financials.shares_outstanding IS '발행주식수 (주)';
