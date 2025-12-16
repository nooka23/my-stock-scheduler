-- company_financials_v2 테이블의 모든 데이터 삭제
-- 주의: 이 작업은 되돌릴 수 없습니다!

DELETE FROM company_financials_v2;

-- 삭제된 행 수 확인
SELECT COUNT(*) as deleted_count FROM company_financials_v2;

-- 결과가 0이면 성공
