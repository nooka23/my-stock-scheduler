-- ========================================
-- 배치 조회를 위한 RPC 함수 생성
-- ========================================
-- 이 함수는 모든 종목의 최신 가격 데이터를 한 번에 조회합니다.
-- update_today_v2.py의 성능 최적화를 위해 필요합니다.

CREATE OR REPLACE FUNCTION get_latest_prices_by_code()
RETURNS TABLE (
    code TEXT,
    date DATE,
    close NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (dp.code)
        dp.code,
        dp.date,
        dp.close
    FROM daily_prices_v2 dp
    ORDER BY dp.code, dp.date DESC;
END;
$$ LANGUAGE plpgsql;

-- 함수 설명
COMMENT ON FUNCTION get_latest_prices_by_code() IS '모든 종목의 최신 가격 데이터를 한 번에 조회하는 함수 (성능 최적화용)';
