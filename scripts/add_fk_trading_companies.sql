-- trading_value_rankings와 companies 테이블 간의 외래키 관계 설정
alter table public.trading_value_rankings
add constraint fk_trading_value_rankings_companies
foreign key (code)
references public.companies (code)
on delete cascade;
