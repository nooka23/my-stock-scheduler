# Financials Rebuild Plan

이 문서는 이 프로젝트의 재무 데이터 재설계에 대한 **기준 문서이자 handoff 문서**다.  
재무 관련 작업을 시작할 때는 `guide.md`보다 이 문서를 먼저 읽는다.

문서 위치와 역할:

- `financials_rebuild_plan.md`
  - 현재 재무 재설계 작업에서만 한시적으로 쓰는 기준 문서
  - 재무 구조가 완성되면 핵심 내용은 `guide.md`로 옮기고 이 문서는 제거한다
- `update.md`
  - 재무 작업 포함, 진행 중인 프로젝트의 실제 진행 사항과 변동사항을 계속 기록하는 문서
  - 앞으로 재무 관련 변경사항이나 진행상황은 이 문서에도 함께 남긴다
- `guide.md`
  - 저장소 전체의 장기 운영 기준 문서
  - 완성되고 검증된 재무 구조만 최종 반영한다

## 1. 현재 결론

- 기존 `company_financials`를 계속 확장하지 않는다.
- `company_financials_v2`도 최종 구조라고 가정하지 않는다.
- 새 재무 시스템은 **DART-first**로 다시 만든다.
- 구조는 **raw -> normalized -> serving** 3단계로 분리한다.
- 기존 대량 수집 스크립트들은 참고용이다. 특히 `scripts/update_financials_2025q3_only.py`는 미래 메인 파이프라인의 기반이 아니다.

## 2. 이 프로젝트에서 재무가 놓인 위치

이 저장소는 전체적으로 `Next.js + Supabase + Python 배치` 구조다.  
주식 데이터의 핵심은 `daily_prices_v2` 중심 파이프라인이지만, 재무 데이터는 아직 정식 구조가 정리되지 않았다.

현재 재무 관련 현실은 아래와 같다.

- 사용자 화면 `/chart`는 아직 `company_financials`를 읽는다.
- 기존 DART/forecast 시도는 `company_financials_v2`를 사용한다.
- 즉, **현재 화면 source of truth**와 **재무 수집 실험 구조**가 분리되어 있다.

관련 파일:

- [src/app/chart/page.tsx](/Users/myunghoon/my-stock-scheduler/src/app/chart/page.tsx)
- [scripts/update_financials.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials.py)
- [scripts/update_financials_dart.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_dart.py)
- [scripts/update_financials_dart_smart.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_dart_smart.py)
- [scripts/update_financials_2025q2.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q2.py)
- [scripts/update_financials_2025q3_only.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q3_only.py)
- [scripts/README_FINANCIALS_V2.md](/Users/myunghoon/my-stock-scheduler/scripts/README_FINANCIALS_V2.md)

## 3. 왜 새로 만들어야 하는가

기존 구조를 그대로 연장하지 않기로 한 이유는 명확하다.

1. `company_financials`와 `company_financials_v2`가 동시에 존재해 source of truth가 분리되어 있다.
2. 기존 배치들은 raw DART 원문을 보존하지 않고, 몇 개 숫자만 납작하게 저장한다.
3. 문자열 매칭 중심이라 계정 오매핑 가능성이 크다.
4. 추적성이 약하다. 어떤 공시의 어떤 row가 어떤 값으로 채택됐는지 남기지 않는다.
5. 재실행/부분 재처리/정정공시 반영 구조가 약하다.
6. 일부 배치 스크립트는 DB 쓰기에 `anon key`를 사용해 운영 기준으로 적절하지 않다.

## 4. 기존 파일 평가

### 4-1. 계속 유지하지만 레거시로 보는 것

- `company_financials`
  - 현재 `/chart`가 읽는 레거시 데이터 소스

### 4-2. 참고용 시도였지만 최종 구조로 보지 않는 것

- `company_financials_v2`
  - DART + forecast 실험용 구조

### 4-3. 참고용 스크립트

- [scripts/update_financials_2025q2.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q2.py)
  - 2025년 2분기 일괄 수집 배치
- [scripts/update_financials_2025q3_only.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q3_only.py)
  - 2025년 3분기 일괄 수집 배치
- [scripts/update_financials_dart_smart.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_dart_smart.py)
  - DART 기반 경량 파서
- [scripts/update_financials_dart.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_dart.py)
  - 기본형 DART 수집기

### 4-4. 이번에 추가된 재설계 준비 파일

- [scripts/financials_account_map.py](/Users/myunghoon/my-stock-scheduler/scripts/financials_account_map.py)
  - 현재 공통 문자열 기반 계정 매핑 사전
- [scripts/test_dart_samsung_2025_q3_report.py](/Users/myunghoon/my-stock-scheduler/scripts/test_dart_samsung_2025_q3_report.py)
  - 삼성전자 2025년 3분기 공시 기준 DART 응답 탐색 및 `account_map` 검증 도구

## 5. `update_financials_2025q3_only.py`에 대한 최종 판단

이 파일은 useful하다. 하지만 reference일 뿐이다.

가져갈 것:

- 종목 반복 수집 흐름
- DART `corp_code` 매핑 처리
- 계정 후보 사전의 축적된 경험
- 분기별 공시 수집 경험

가져가지 않을 것:

- 이 파일의 전체 구조를 새 메인 파이프라인의 뼈대로 쓰는 것
- `company_financials_v2`를 최종 저장소로 가정하는 것
- 문자열 첫 매칭만으로 최종 정규화를 끝내는 것

핵심 한계:

- 특정 시점(`2025 Q3`)에 강하게 고정됨
- raw / normalized / serving 분리 없음
- 원문 추적 정보 부족
- 오매핑 가능성 높음
- 운영용 재처리 설계 약함

## 6. 새 구조의 목표

### 6-1. Raw ingestion

목표:

- DART 응답 원문을 가능한 한 손실 없이 저장

최소 보존 필드 후보:

- `corp_code`
- `stock_code`
- `corp_name`
- `rcept_no`
- `bsns_year`
- `reprt_code`
- `fs_div`
- `sj_div`
- `sj_nm`
- `account_id`
- `account_nm`
- `account_detail`
- `thstrm_nm`
- `thstrm_amount`
- `frmtrm_nm`
- `frmtrm_amount`
- `currency`
- `raw_fetched_at`

원칙:

- 원문 단위를 유지한다.
- 여기서 억원 변환 같은 서비스용 가공을 하지 않는다.

### 6-2. Normalized facts

목표:

- 앱에서 쓸 핵심 재무 항목을 정규화

필드 후보:

- `company_code`
- `corp_code`
- `year`
- `quarter`
- `fs_div`
- `is_consolidated`
- `is_cumulative`
- `revenue`
- `op_income`
- `net_income`
- `assets`
- `equity`
- `liabilities`
- `shares_outstanding`
- `source_rcept_no`
- `source_account_ids`
- `source_account_names`
- `normalization_version`

원칙:

- 누적 분기값/단일 분기값 구분을 명시한다.
- 어떤 row가 채택됐는지 남긴다.

### 6-3. Serving layer

목표:

- `/chart` 등 프론트엔드가 단순하게 읽을 수 있는 레이어 제공

형태:

- view 또는 materialized table

원칙:

- 프론트엔드는 DART 원문 구조를 몰라도 되게 한다.
- 전환은 serving layer가 준비된 뒤 한다.

## 7. account_map 방침

현재 단계에서 `account_map`은 필요하다. 하지만 최종 해법은 아니다.

현재 공통 파일:

- [scripts/financials_account_map.py](/Users/myunghoon/my-stock-scheduler/scripts/financials_account_map.py)

현재 포함 항목:

- `revenue`
- `op_income`
- `net_income`
- `assets`
- `equity`
- `liabilities`
- 탐색용으로 `capital`, `shares`

중요 원칙:

1. 문자열 매칭은 임시 정규화 수단이다.
2. 최종 판단은 `sj_nm`, `account_id`, `account_detail`, 공시 유형, 필요하면 회사별 예외 규칙까지 같이 본다.
3. `account_map`은 반드시 실 DART 응답으로 검증하면서 조정한다.

## 8. 이번 작업에서 실제로 한 일

### 8-1. 공통 매핑 파일 추가

추가 파일:

- [scripts/financials_account_map.py](/Users/myunghoon/my-stock-scheduler/scripts/financials_account_map.py)

내용:

- 기존 분기 일괄 수집 스크립트의 긴 문자열 매핑을 공통화
- `parse_amount`, `amount_to_eok`, `row_matches_keywords` 제공

### 8-2. 기존 스크립트 일부를 공통 매핑 사용으로 정리

수정 파일:

- [scripts/update_financials_2025q2.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q2.py)
- [scripts/update_financials_2025q3_only.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_2025q3_only.py)
- [scripts/update_financials_dart_smart.py](/Users/myunghoon/my-stock-scheduler/scripts/update_financials_dart_smart.py)

의미:

- 각 파일에 흩어진 매핑 규칙을 공통화했다.
- 아직 메인 파이프라인은 아니지만, 실험/검증의 기준점이 생겼다.

### 8-3. DART 탐색/검증 스크립트 추가

추가 파일:

- [scripts/test_dart_samsung_2025_q3_report.py](/Users/myunghoon/my-stock-scheduler/scripts/test_dart_samsung_2025_q3_report.py)

이 스크립트가 하는 일:

- `.env.local`의 `DART_API_KEY` 사용
- 삼성전자 `005930`, 2025년 3분기 공시 조회
- `company.json`, `list.json`, `fnlttSinglAcntAll.json` 확인
- 재무제표 section별 계정과목 샘플 출력
- 공통 `account_map`이 실제 응답에서 어떤 row를 잡는지 검증

## 9. 실제 테스트 결과

실제 DART 호출로 삼성전자 2025년 3분기 공시를 확인했다.

대상 공시:

- `분기보고서 (2025.09)`
- `rcept_no = 20251114002447`
- 재무제표 응답은 연결기준 `CFS`
- `fnlttSinglAcntAll.json` row 수: `225`

확인된 핵심 계정:

- `revenue`: `매출액`
- `op_income`: `영업이익`
- `net_income`: `분기순이익`
- `assets`: `자산총계`
- `equity`: `자본총계`
- `liabilities`: `부채총계`
- `capital`: `자본금`

## 10. 테스트로 확인된 account_map 상태

### 10-1. 이미 개선된 점

초기에는 `매출` 같은 짧은 문자열이 `매출채권`, `매출원가`, `매출총이익`까지 잡혔다.  
이를 막기 위해 매칭 로직을 `부분 포함`에서 `공백 정규화 후 동등 비교`로 바꿨다.

현재 상태:

- `revenue`: 삼성전자 2025 Q3에서 `매출액`만 잡힘
- `op_income`: `영업이익`만 잡힘
- `assets`: `자산총계`만 잡힘
- `liabilities`: `부채총계`만 잡힘

### 10-2. 아직 남아 있는 문제

여전히 중복 후보가 많은 항목:

- `net_income`
- `equity`

실제 이유:

- 같은 이름이 `손익계산서`, `포괄손익계산서`, `현금흐름표`, `자본변동표` 등 여러 section에 중복 등장
- 현재 문자열 매칭만으로는 어떤 section의 row를 우선할지 정하지 못함

현재 관찰 결과:

- `net_income`: 후보가 여러 section에서 다수 잡힘
- `equity`: `재무상태표`와 `자본변동표`에서 모두 잡힘

즉 다음 단계는 필수적으로 `sj_nm` 우선순위가 들어가야 한다.

## 11. 다음에 바로 해야 할 일

우선순위 순서:

1. `sj_nm` 기반 우선순위 규칙 추가
   - 예: `revenue`, `op_income`, `net_income`는 `손익계산서` 우선
   - `assets`, `equity`, `liabilities`는 `재무상태표` 우선
2. 동일 계정명이라도 `account_id`, `account_detail`까지 같이 로그로 남기기
3. `raw_dart_financials` migration 초안 만들기
4. raw ingestion 스크립트 첫 버전 만들기
5. normalized 변환 스크립트 초안 만들기

## 12. 지금 당장 하지 않을 것

- 기존 `company_financials`에 임시 컬럼 계속 추가
- `company_financials_v2`를 최종 구조라고 가정
- 테스트 없이 `account_map` 대량 확대
- raw 보존 없이 숫자만 저장
- 기존 대량 배치 파일을 그대로 메인 구조로 승격

## 13. 재무 관련 작업 시작 순서

새 컨텍스트에서 재무 작업을 시작할 때 권장 순서:

1. 이 문서 읽기
2. [scripts/financials_account_map.py](/Users/myunghoon/my-stock-scheduler/scripts/financials_account_map.py) 확인
3. [scripts/test_dart_samsung_2025_q3_report.py](/Users/myunghoon/my-stock-scheduler/scripts/test_dart_samsung_2025_q3_report.py) 실행 또는 수정
4. 필요한 경우 기존 참고 배치 확인
5. 새 migration / 새 raw ingestion 설계

## 14. 빠른 handoff 요약

지금까지의 상태를 새 컨텍스트에서 짧게 이어받으려면 아래만 기억하면 된다.

- 재무는 새로 만든다. 레거시 확장하지 않는다.
- 현재 기준 문서는 이 파일이다.
- 공통 매핑은 `scripts/financials_account_map.py`에 있다.
- 삼성전자 2025 Q3 DART 테스트는 통과했고, `revenue` 오탐은 정리됐다.
- 아직 `net_income`와 `equity`는 section 중복 문제로 추가 규칙이 필요하다.
- 다음 액션은 `sj_nm` 우선순위 반영 -> raw migration 설계 순서다.
