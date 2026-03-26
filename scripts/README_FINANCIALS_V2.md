# 재무 데이터 수집 시스템 v2

현재 `company_financials_v2`는 과거의 단순 분기/예측치 혼합 테이블이 아니라,
수동 `account_id` 우선순위 기반 DART 정규화 테이블로 다시 시작하는 기준 문서다.

## 개요

- 저장 테이블: `company_financials_v2`
- 데이터 소스: DART `fnlttSinglAcntAll.json`
- 선택 기준: 재무 항목별 `ACCOUNT_ID_PRIORITY_MAP`
- 저장 단위: 기업 / 연도 / 분기 / 데이터소스
- 데이터소스 값: `dart_account_id_manual`

## 실행 순서

### 1. 테이블 초기화

Supabase SQL Editor에서 아래 migration을 실행한다.

```sql
supabase/migrations/20260326_reset_company_financials_v2_for_account_id.sql
```

이 migration은 `company_financials_v2`를 `drop table ... cascade` 후 재생성한다.
즉 기존 `company_financials_v2` 데이터는 모두 삭제된다.

### 2. account_id 우선순위 입력

[export_dart_financials_by_account_id.py](/Users/myunghoon/my-stock-scheduler/scripts/export_dart_financials_by_account_id.py)
상단의 `ACCOUNT_ID_PRIORITY_MAP`에 재무 항목별 우선순위를 직접 입력한다.

### 3. 적재 실행

```bash
python3 scripts/export_dart_financials_by_account_id.py --year 2025 --quarter 3
python3 scripts/export_dart_financials_by_account_id.py --year 2025 --quarter 3 --codes 005930 000660
```

## 테이블 구조

주요 컬럼:

- 식별: `company_code`, `corp_code`, `corp_name`, `year`, `quarter`, `reprt_code`, `fs_div`
- 상태: `is_consolidated`, `data_source`, `raw_row_count`, `raw_fetched_at`
- 재무값:
  - `assets_total`
  - `current_assets`
  - `cash_and_cash_equivalents`
  - `short_term_financial_assets`
  - `trade_receivables`
  - `inventories`
  - `noncurrent_assets`
  - `investments_in_associates`
  - `property_plant_and_equipment`
  - `intangible_assets`
  - `liabilities_total`
  - `current_liabilities`
  - `noncurrent_liabilities`
  - `equity_total`
  - `revenue`
  - `cost_of_sales`
  - `operating_income`
  - `selling_general_administrative_expenses`
  - `profit_before_tax`
  - `income_tax_expense`
  - `net_income`
  - `operating_cash_flow`
  - `investing_cash_flow`
  - `financing_cash_flow`
  - `cash_beginning`
  - `cash_ending`
- 추적 정보:
  - `selected_account_ids`
  - `selected_account_names`
  - `selected_statement_names`
  - `selected_priority_indices`
  - `account_id_priority_map`

기본 키:

- `(company_code, year, quarter, data_source)`

모든 금액은 억원 단위로 저장한다.

## 확인 쿼리

```sql
select
  year,
  quarter,
  revenue,
  operating_income,
  net_income,
  assets_total,
  equity_total,
  selected_account_ids
from company_financials_v2
where company_code = '005930'
  and data_source = 'dart_account_id_manual'
order by year, quarter;
```

```sql
select
  company_code,
  year,
  quarter,
  selected_account_ids,
  selected_priority_indices
from company_financials_v2
where data_source = 'dart_account_id_manual'
order by company_code, year, quarter;
```

## 주의

- 현재 프론트엔드 페이지는 `company_financials_v2`를 사용하지 않는다.
- 과거 `company_financials_v2` 스키마를 전제로 한 스크립트들은 이 새 구조와 호환되지 않는다.
- 실제 운영 기준은 `financials_rebuild_plan.md`, `update.md`와 함께 본다.
