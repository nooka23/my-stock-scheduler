-- 50일 평균 거래대금 상위 40% 필터링된 RS 랭킹 조회 RPC 함수
create or replace function get_filtered_rs_stocks(
  p_date date,
  p_page int,
  p_limit int
)
returns table (
  code text,
  name text,
  rank_weighted int,
  rs_score numeric,
  close numeric,
  marcap numeric,
  total_count bigint
)
language plpgsql
as $$
declare
  v_offset int;
begin
  v_offset := (p_page - 1) * p_limit;

  return query
  with target_stocks as (
    -- 해당 날짜의 RS 랭킹 종목들 (보통 2000개 내외)
    select r.code, r.rank_weighted, r.score_weighted
    from rs_rankings_v2 r
    where r.date = p_date
  ),
  daily_stats as (
    -- 해당 종목들의 최근 50일+ 데이터로 평균 거래대금 계산
    -- 성능 최적화를 위해 인덱스를 잘 타도록 조건 설정
    select 
      d.code,
      avg(d.close * d.volume) as avg_amt
    from daily_prices_v2 d
    where d.code in (select t.code from target_stocks t)
    and d.date <= p_date
    and d.date > (p_date - interval '80 days') -- 휴일 포함 넉넉히
    group by d.code
    having count(*) >= 20 -- 최소 20일 데이터는 있어야 함
  ),
  ranked_stats as (
    -- 거래대금 순위(백분위) 산정
    select 
      ds.code,
      percent_rank() over (order by ds.avg_amt desc) as amt_rank_pct
    from daily_stats ds
  ),
  final_list as (
    -- 상위 40% 필터링
    select 
      ts.code,
      ts.rank_weighted,
      ts.score_weighted,
      c.name,
      c.marcap,
      -- 최신 종가는 따로 조인해야 함
      (select p.close from daily_prices_v2 p where p.code = ts.code and p.date = p_date limit 1) as close
    from target_stocks ts
    join ranked_stats rs on ts.code = rs.code
    join companies c on ts.code = c.code
    where rs.amt_rank_pct <= 0.4
  )
  select 
    f.code,
    f.name,
    f.rank_weighted,
    f.score_weighted,
    coalesce(f.close, 0) as close,
    f.marcap,
    count(*) over() as total_count
  from final_list f
  order by f.rank_weighted
  limit p_limit offset v_offset;
end;
$$;
