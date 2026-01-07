-- Add custom asset support to user_portfolio
ALTER TABLE user_portfolio
ADD COLUMN IF NOT EXISTS is_custom_asset BOOLEAN DEFAULT FALSE;

ALTER TABLE user_portfolio
ADD COLUMN IF NOT EXISTS manual_current_price NUMERIC;

COMMENT ON COLUMN user_portfolio.is_custom_asset IS 'True when the asset is not in daily_prices_v2';
COMMENT ON COLUMN user_portfolio.manual_current_price IS 'Manual current price for custom assets';
