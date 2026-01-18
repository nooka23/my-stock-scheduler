-- Supabase RPC 함수 생성 SQL
-- 이 파일을 Supabase SQL Editor에서 실행하세요.

CREATE OR REPLACE FUNCTION public.get_latest_prices_by_code()
RETURNS TABLE(code text, date text, close numeric)
LANGUAGE sql
AS $function$
  SELECT DISTINCT ON (code) code, date::text, close
  FROM daily_prices_v2
  ORDER BY code, date DESC;
$function$;
