# Update Log

이 문서는 이 저장소의 **진행 중인 작업 / 미완성 작업 / 최근 변경 사항**을 기록하는 작업 로그다.

원칙:

- 완성되지 않은 프로젝트 진행 사항은 우선 이 문서에 기록한다.
- 향후에도 계속 사용하는 누적 문서다.
- 어떤 프로젝트의 설계 변경, 검증 결과, 다음 액션, 임시 판단은 먼저 여기에 남긴다.
- 프로젝트가 충분히 정리되고 운영 기준이 확정되면, 필요한 내용만 `guide.md`로 옮긴다.
- 특정 프로젝트 전용 handoff 문서가 있더라도, 실제 진행 상황 업데이트는 이 문서에도 남긴다.

관련 문서 역할:

- `update.md`
  - 진행 중 / 미완성 작업 로그
- `financials_rebuild_plan.md`
  - 현재 재무 재설계 작업에서만 한시적으로 쓰는 기준 문서
  - 재무 구조가 완성되면 핵심 내용은 `guide.md`로 이관하고 이 문서는 제거 대상
- `guide.md`
  - 저장소 전체의 장기 운영 기준 문서
  - 완료되고 검증된 내용만 반영

---

## 2026-03-04

### Financials rebuild

상태:

- 진행 중
- `financials_rebuild_plan.md`를 현재 재무 재설계의 기준 문서로 확정

오늘 한 일:

- `financials_rebuild_plan.md` 작성 및 재무 재설계 방향 정리
- `guide.md` 작성 및 저장소 전반 구조/운영 지식 정리
- `scripts/financials_account_map.py` 추가
  - 공통 DART 계정 문자열 매핑 유틸 정리
- `scripts/test_dart_samsung_2025_q3_report.py` 추가
  - 삼성전자 2025년 3분기 DART 응답 탐색 및 계정 매핑 검증 도구 작성
- `scripts/update_financials_2025q2.py`
  - 공통 계정 매핑 사용하도록 정리
- `scripts/update_financials_2025q3_only.py`
  - 공통 계정 매핑 사용하도록 정리
- `scripts/update_financials_dart_smart.py`
  - 공통 계정 매핑 사용하도록 정리
- `scripts/financials_account_map.py`에 `sj_nm` 우선순위 기반 선택 로직 추가
  - `revenue`, `op_income`, `net_income`는 손익계산서 계열 우선
  - `assets`, `equity`, `liabilities`는 재무상태표 우선
- 삼성 검증 스크립트에 `preferred row`, `account_id`, `account_detail` 출력 추가
- `supabase/migrations/20260304_create_raw_dart_financials.sql` 추가
  - raw DART 원문 보존용 테이블 초안 작성
- `scripts/test_dart_all_companies_excel.py` 추가
  - 전 종목 DART 계정 매핑 검증 결과를 엑셀로 내보내는 테스트 스크립트 작성
- 전 종목 테스트 스크립트 기본 대상 수정
  - `companies` 전체가 아니라 기본적으로 `KOSPI`, `KOSDAQ`만 조회
  - 이름 기준 `ETF`, `ETN`, `스팩`, 우선주 제외
- `scripts/requirements.txt`에 `openpyxl` 추가

현재 결론:

- 재무는 기존 `company_financials` / `company_financials_v2` 확장이 아니라 새 구조로 재구축한다.
- 새 구조는 `raw -> normalized -> serving` 3단계다.
- 기존 대량 수집 스크립트는 참고용일 뿐 메인 파이프라인이 아니다.
- `net_income`, `equity`는 문자열 매칭만으로는 부족하고 section 우선순위가 필요하다.
- 전 종목 엑셀 검증 스크립트로 실제 오탐 패턴을 수집할 수 있게 됐다.

남은 일:

- 전 종목 엑셀 검증 결과를 바탕으로 `account_map` 오탐 패턴 분석
- 필요 시 `sj_nm` 외 `account_id`, `account_detail` 기반 예외 규칙 추가
- `raw_dart_financials` ingestion 스크립트 작성
- normalized facts 테이블 초안 및 변환 스크립트 작성
- serving layer 설계 후 `/chart` 전환 전략 정리

주의:

- 재무 관련 진행 사항은 당분간 `financials_rebuild_plan.md`와 함께 이 문서에도 계속 기록한다.

## 2026-03-05

### Financials rebuild

오늘 한 일:

- `scripts/export_dart_account_ids_all_companies.py` 추가
  - 목표: 종목별로 조회 가능한 DART `account_id`를 숫자 없이 전수 수집
  - 수집 대상: `account_id`, `account_nm`, `sj_nm`, `account_detail`, `currency` (금액 제외)
  - 기본 필터: `KOSPI`, `KOSDAQ` + ETF/ETN/스팩/우선주 제외
  - 옵션: `--codes`, `--markets`, `--include-etf`, `--include-spac`, `--include-preferred`
  - 재무구분 옵션: `--fs-div-mode all|cfs|ofs`
  - 출력: `scripts/output/dart_account_ids/*.xlsx`

의미:

- 계정 ID 중심 시스템 설계를 위한 기초 데이터셋을 자동 생성할 수 있게 됨
- 기존 매칭 검증(금액 포함) 스크립트와 별개로, ID 카탈로그 전용 파이프라인을 분리함

## 2026-03-26

### Financials rebuild

오늘 한 일:

- `scripts/financials_account_map.py`
  - `account_id` 정규화 및 우선순위 선택 유틸 추가
- `scripts/export_dart_financials_by_account_id.py` 추가
  - 사용자가 재무 항목별 `account_id` 우선순위 목록을 직접 입력하도록 템플릿 제공
  - 각 기업에서 1순위 `account_id`가 없으면 다음 보조 `account_id`를 순서대로 선택
  - 결과를 재정의된 `company_financials_v2`에 upsert 하도록 구성
- `supabase/migrations/20260326_reset_company_financials_v2_for_account_id.sql` 추가
  - 기존 `company_financials_v2`를 drop 후 재생성하는 초기화 migration 추가
  - `account_id` 수동 우선순위 기반 normalized 재무 저장 스키마로 재정의
  - 선택된 `account_id`, 계정명, statement명, 우선순위를 JSON으로 함께 저장
- `scripts/README_FINANCIALS_V2.md` 재작성
  - 과거 forecast 혼합 구조 설명을 제거하고 새 v2 기준만 남김

의미:

- 문자열 매칭이 아니라 `account_id` 우선순위 기반으로 재무 항목 선택을 검증할 수 있게 됨
- 기업별 계정 차이를 보조 `account_id` 체인으로 흡수하는 실험 파이프라인이 생김
- 단순 엑셀 검토가 아니라 재정의된 `company_financials_v2`에 누적 저장하면서 후속 쿼리와 검증이 가능해짐
