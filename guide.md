# GUIDE

이 문서는 이 저장소를 처음 읽는 AI를 위한 실무 가이드다. 설명보다 운영 기준, 데이터 흐름, 위험 지점을 우선한다.

문서 역할 구분:

- `guide.md`
  - 이 저장소 전체의 장기 운영 기준 문서이자 바이블
  - 완료되고 검증된 프로젝트 내용만 반영한다
- `update.md`
  - 진행 중 / 미완성 프로젝트의 진행 사항 기록 문서
  - 새로운 변동사항, 작업 로그, 임시 판단, 다음 액션은 우선 여기에 기록한다
- `financials_rebuild_plan.md`
  - 현재 재무 재설계 작업에서만 한시적으로 사용하는 기준 문서
  - 재무 구조가 완성되면 필요한 내용은 `guide.md`로 이관하고 이 문서는 제거 대상이다

## 1. 이 프로젝트를 한 줄로 요약

이 프로젝트는 `Next.js + Supabase + Python 배치`로 구성된 한국 주식 분석 앱이다. 다만 루트 `/`는 원래 일정 관리용 스케줄러이고, 현재 핵심 가치는 주식 데이터 수집/랭킹/차트/포트폴리오 기능에 있다.

즉, 이 저장소는 아래 두 축이 공존한다.

- 일정 관리 축: `schedules`, `participants`, `profiles`
- 주식 분석 축: `companies`, `daily_prices_v2`, `rs_rankings_v2`, `trading_value_rankings`, `leader_stocks_daily`, `equal_weight_indices` 등

새 작업을 시작할 때는 먼저 "이번 변경이 스케줄러 영역인지, 주식 분석 영역인지"를 구분하라. 대부분의 최근 기능은 주식 분석 영역이다.

## 2. 먼저 알아야 할 사실

- 루트 `README.md`는 거의 기본 Next.js 템플릿 상태다. 신뢰하지 말 것.
- 실제 운영 지식은 `src/app`, `scripts`, `launchd`, `supabase/migrations`에 흩어져 있다.
- 프론트엔드는 대부분 클라이언트 컴포넌트에서 Supabase를 직접 조회한다.
- 별도 서비스 레이어가 거의 없다. 스키마 변경은 UI에 바로 영향을 준다.
- `next.config.ts`에서 build 시 `eslint`와 `typescript` 오류를 무시한다.
- 즉, `npm run build`가 통과해도 코드 품질이 보장되지 않는다.
- Python 스크립트는 매우 중요하다. 화면보다 배치가 데이터의 진짜 소스다.

## 3. 기술 스택

- 프론트엔드: Next.js 16, React 19, TypeScript, App Router
- 차트: `lightweight-charts`, `recharts`
- 인증/DB 접근: Supabase
- 배치/데이터 수집: Python
- 외부 데이터 소스:
  - KIS API / KIS 마스터 파일
  - DART API
  - Naver Finance 크롤링

관련 파일:

- `package.json`
- `src/lib/supabase.ts`
- `scripts/requirements.txt`

## 4. 디렉터리 지도

- `src/app`
  - 실제 화면과 API route
- `src/components`
  - 차트, 사이드바 등 UI 컴포넌트
- `src/utils`
  - 보조 지표 계산
- `src/lib`
  - Supabase 클라이언트, Livermore 상태 계산
- `scripts`
  - 주가 수집, 랭킹 계산, 지수 계산, 재무 수집, 백필, 수동 보정
- `supabase/migrations`
  - 최근 추가된 DB 변경사항 일부
- `launchd`
  - macOS 정기 실행 설정

## 5. 실제 아키텍처

### 5-1. 프론트엔드

대부분의 페이지는 `createClientComponentClient()`로 브라우저에서 직접 Supabase를 읽고 쓴다.

즉, 변경 시 보통 함께 확인해야 하는 것은 아래 세 가지다.

- 해당 페이지 쿼리
- 관련 테이블/컬럼
- 그 테이블을 채우는 Python 스크립트

### 5-2. 데이터 파이프라인

핵심 일일 흐름은 아래 순서다.

1. `scripts/update_today_v3.py`
2. `scripts/calculate_trading_value_rank.py`
3. `scripts/calculate_rs_v2.py`
4. `scripts/calculate_leader_stocks_daily.py`
5. `scripts/update_group_indices_daily.py`

이 순서는 `scripts/run_daily_stock_local.sh`와 `launchd/com.myunghoon.my-stock-scheduler.daily-stock.plist`에 반영되어 있다.

### 5-3. 스케줄링

macOS `launchd` 기준 `StartCalendarInterval`의 `Weekday 1~5`, `15:35`에 위 배치가 실행되도록 구성되어 있다.

주의:

- 이 시간은 머신 로컬 시간 기준이다.
- 배치 실패 시 화면 이상보다 데이터 공백으로 먼저 드러난다.

## 6. 핵심 데이터 흐름

### 6-1. 가격 데이터

`update_today_v3.py`가 가장 중요하다.

- KOSPI/KOSDAQ 지수 데이터를 `daily_prices_v2`에 저장한다.
- KIS 마스터 파일로 `companies`를 갱신한다.
- 개별 종목 OHLCV를 `daily_prices_v2`에 upsert 한다.
- 최신 행에는 `market_cap`도 함께 기록한다.

중요한 비직관 포인트:

- `daily_prices_v2`에는 일반 종목뿐 아니라 `KOSPI`, `KOSDAQ` 같은 지수 코드도 들어간다.
- `companies`에도 `KOSPI`, `KOSDAQ`가 `market = 'INDEX'`로 들어간다.
- 최신 시총은 `companies.marcap`와 `daily_prices_v2.market_cap` 둘 다 관련이 있지만 성격이 다를 수 있다.

### 6-2. 거래대금 랭킹

`calculate_trading_value_rank.py`

- `daily_prices_v2`에서 `close * volume` 기반 거래대금을 계산한다.
- 50일/60일 평균 거래대금 랭킹을 `trading_value_rankings`에 저장한다.

### 6-3. RS 랭킹

`calculate_rs_v2.py`

- `daily_prices_v2`에서 최근 약 400일 데이터를 읽는다.
- 3/6/12개월 수익률과 가중 점수를 계산한다.
- 결과를 `rs_rankings_v2`에 저장한다.

### 6-4. 리더 종목

`calculate_leader_stocks_daily.py`

- `rs_rankings_v2`와 `daily_prices_v2`를 결합한다.
- 거래대금 상위 200과 RS 상위 500의 교집합을 기반으로 점수를 만든다.
- 결과를 `leader_stocks_daily`에 저장한다.

### 6-5. 업종/테마 지수

`update_group_indices_daily.py`

- `index_constituents_monthly`를 기반으로 구성 종목을 가져온다.
- `daily_prices_v2` 수익률을 평균해 `equal_weight_indices`를 갱신한다.

이 영역은 아래 테이블 묶음으로 이해하면 된다.

- 메타: `themes`, `industries`
- 매핑: `company_themes`, `company_industries`
- 구성종목: `index_constituents_monthly`
- 시계열 지수: `equal_weight_indices`

## 7. 주요 화면과 사용하는 데이터

### 핵심 사용자 화면

- `/`
  - 일정 관리 스케줄러
  - `schedules`, `participants`, `profiles`
- `/chart`
  - 밴드 차트
  - `daily_prices_v2`, `company_financials`, `user_custom_financials`, `user_chart_settings`
- `/discovery/rs`
  - RS 발굴
  - `rs_rankings_v2`, `daily_prices_v2`, `companies`, `user_favorite_stocks`
- `/discovery/volume`
  - 거래대금 발굴
  - `trading_value_rankings`, `daily_prices_v2`, `companies`, `user_favorite_stocks`
- `/market-index`
  - 업종/테마 지수와 리더 종목
  - `equal_weight_indices`, `leader_stocks_daily`, `themes`, `industries`, 매핑 테이블
- `/favorites`
  - 관심 종목 및 그룹 관리
  - `user_favorite_stocks`, `trading_candidates`, `companies`

### 관리자/분석 화면

- `/admin`
  - 회원 승인/관리자 권한
  - `profiles`
- `/admin/index`
  - KOSPI/KOSDAQ 차트
  - `daily_prices_v2`, `rs_rankings_with_volume`
- `/admin/MH/chart`
  - 관리자용 차트 리뷰
  - `rs_rankings_v2`, `user_favorite_stocks`, `company_themes`, `company_industries`
- `/admin/MH/volume`
  - 2차 필터링/포트폴리오 보조
- `/admin/MH/index`
  - Livermore Price Record
  - `/api/livermore/kospi`, `/api/companies/search`, `daily_prices_v2`
- `/admin/MH/portfolio`
  - 포트폴리오 관리
  - `user_portfolio`, `user_portfolio_transactions`, `daily_prices_v2`, `companies`
- `/admin/game`
  - 차트 게임 및 고수익 랭킹
  - `daily_prices_v2`, `rs_rankings_with_volume`, `get_high_return_rankings` RPC

## 8. 중요한 테이블들

### 거의 항상 중심이 되는 테이블

- `companies`
  - 종목 코드/이름/시장/시총 마스터
- `daily_prices_v2`
  - 가격 데이터의 중심
- `rs_rankings_v2`
  - RS 점수/랭킹
- `trading_value_rankings`
  - 거래대금 랭킹
- `leader_stocks_daily`
  - 리더 스코어
- `equal_weight_indices`
  - 업종/테마 지수 시계열

### 관계/분류 테이블

- `themes`
- `industries`
- `company_themes`
- `company_industries`
- `index_constituents_monthly`

### RPC / SQL helper

- `get_latest_prices_by_code`
  - `update_today_v3.py`가 최신 DB 스냅샷 비교에 사용
  - 생성 SQL: `scripts/create_rpc_get_latest_prices_by_code.sql`
- `get_high_return_rankings`
  - `/admin/game`에서 사용
  - 생성 SQL: `supabase/migrations/20250210_create_high_return_rankings.sql`

### 사용자 데이터

- `user_favorite_stocks`
- `user_chart_settings`
- `user_custom_financials`
- `user_portfolio`
- `user_portfolio_transactions`
- `trading_candidates`

### 스케줄러 영역

- `profiles`
- `schedules`
- `participants`

## 9. 재무 데이터는 새로 재설계할 예정

재무 영역은 별도 재설계 트랙으로 관리한다.

재무 작업을 할 때의 기준 문서:

- [financials_rebuild_plan.md](/Users/myunghoon/my-stock-scheduler/financials_rebuild_plan.md)

핵심 원칙만 요약하면 아래와 같다.

- 기존 `company_financials` / `company_financials_v2`를 최종 구조로 보지 않는다.
- 새 재무 시스템은 DART-first로 다시 설계한다.
- raw -> normalized -> serving 레이어로 분리한다.
- 기존 DART 배치 파일은 참고용이며, 특히 `scripts/update_financials_2025q3_only.py`는 메인 파이프라인의 기반으로 쓰지 않는다.
- 현재 진행상황, 테스트 결과, `account_map` 상태, 다음 액션은 모두 `financials_rebuild_plan.md`를 따른다.

## 10. 환경 변수

주요 환경 변수 이름은 아래와 같다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_KEY`
- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `DART_API_KEY`

주의:

- 스크립트마다 `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, 심지어 anon key를 쓰는 경우가 섞여 있다.
- 따라서 환경 변수 정리 작업은 전역 치환으로 처리하지 말고 스크립트별 의도를 확인해야 한다.
- 브라우저 코드와 서버 route는 대체로 anon key를 사용한다.
- 배치/쓰기 스크립트는 보통 service role key가 필요하다.

## 11. 인증/권한 동작

- `src/middleware.ts`는 `/`와 `/login`만 매처로 감싼다.
- 즉, 전체 사이트가 중앙집중식으로 보호되는 구조는 아니다.
- 여러 페이지는 각자 클라이언트에서 세션을 확인하고 직접 리다이렉트한다.

따라서 auth 관련 수정 시 주의할 점:

- 미들웨어만 바꾸면 끝나지 않는다.
- 페이지별 세션 체크 로직이 따로 있는지 확인해야 한다.
- admin 권한은 보통 `profiles.is_admin`으로 판정한다.

## 12. API route

API route는 많지 않다.

- `/api/companies/search`
  - 종목 검색
- `/api/livermore/kospi`
  - `daily_prices_v2`를 읽어 Livermore 상태 계산
- `/auth/signout`
  - 로그아웃 보조

이 프로젝트의 핵심 비즈니스 로직은 API가 아니라 Python 배치와 클라이언트 페이지에 있다.

## 13. 지금 코드베이스에서 특히 조심할 점

### 13-1. 빌드가 녹색이어도 안전하지 않다

`next.config.ts`에서 아래가 설정되어 있다.

- `eslint.ignoreDuringBuilds = true`
- `typescript.ignoreBuildErrors = true`

즉:

- 빌드 성공은 품질 보증이 아니다.
- 실제 검증은 화면 확인, 쿼리 확인, 배치 실행 결과 확인이 더 중요하다.

### 13-2. 테스트가 거의 정식 체계가 아니다

`scripts/test_*.py` 파일이 많이 있지만, 전통적인 자동 테스트 스위트라고 보기 어렵다.

- 일부는 실험 스크립트다.
- 일부는 수동 검증용이다.
- 일부는 실제 외부 API 호출을 전제한다.

새 변경을 검증할 때는 다음 우선순위를 따르는 편이 안전하다.

1. 관련 페이지 직접 확인
2. 관련 Supabase 테이블/컬럼 확인
3. 해당 배치 스크립트 단독 실행 또는 dry-run 성격 검증
4. 그 다음에 lint나 build

### 13-3. 스키마 진실은 migration만으로 충분하지 않다

`supabase/migrations`에는 최근 migration만 일부 있다. 전체 스키마의 완전한 역사라고 가정하지 말 것.

실제 스키마 파악은 아래를 함께 보라.

- migration
- 현재 페이지 쿼리
- 현재 Python 스크립트 쓰기 대상

### 13-4. 절반쯤 이동 중인 기능이 있다

대표적으로:

- `company_financials` -> `company_financials_v2`
- `SUPABASE_SERVICE_KEY` -> `SUPABASE_SERVICE_ROLE_KEY`
- 일부 관리자 기능은 실험적 성격이 강함

리팩터링 시 "이미 다 옮겨졌겠지"라고 가정하면 위험하다.

## 14. AI가 작업 시작 전에 읽으면 좋은 파일 순서

전체 문맥이 필요할 때:

1. `guide.md`
2. `package.json`
3. `src/components/Sidebar.tsx`
4. 관련 페이지 파일 1개
5. 관련 Python 스크립트 1개
6. 관련 migration 또는 SQL 파일

배치/데이터 문제일 때:

1. `scripts/run_daily_stock_local.sh`
2. 관련 계산 스크립트
3. 관련 테이블을 읽는 프론트엔드 페이지

재무 문제일 때:

1. `financials_rebuild_plan.md`
2. `src/app/chart/page.tsx`
3. `scripts/financials_account_map.py`
4. 기존 재무 스크립트는 참고용으로만 확인

## 15. 작업 규칙

### 변경 전

- 먼저 이 변경이 어느 테이블을 읽고 쓰는지 식별하라.
- 프론트엔드 수정이면 배치 스크립트까지 거슬러 올라가라.
- 배치 수정이면 그 결과를 소비하는 페이지를 반드시 확인하라.

### 변경 중

- 새 추상화 계층을 섣불리 도입하지 말 것.
- 이 코드베이스는 직접 쿼리와 직접 스크립트 중심이다.
- 기존 패턴과 어긋나는 대규모 구조화는 비용이 크다.

예외:

- 재무 파이프라인 재설계는 예외다.
- 재무 영역은 `financials_rebuild_plan.md`를 기준으로 새 DART 구조를 만드는 것이 현재 기준이다.

### 변경 후

- 최소한 관련 화면 또는 스크립트 한 번은 검증하라.
- 쿼리 컬럼명을 바꿨으면 프론트와 배치를 모두 다시 점검하라.
- 테이블명을 바꿨으면 레거시 페이지가 아직 남아 있지 않은지 확인하라.

## 16. 실무 체크리스트

### 화면 수정 체크리스트

- 이 페이지는 어떤 Supabase 테이블을 읽는가
- 사용자 인증이 필요한가
- 즐겨찾기/포트폴리오 같은 사용자 테이블과 연결되는가
- 동일 데이터를 쓰는 다른 페이지가 있는가

### 배치 수정 체크리스트

- 입력 소스는 KIS / DART / Naver 중 무엇인가
- 대상 테이블과 `on_conflict` 키는 무엇인가
- 후속 스크립트가 이 결과를 전제로 하는가
- 부분 실행과 재실행이 안전한가

### 재무 재설계 체크리스트

- 기존 테이블 보강인지, 새 DART 파이프라인인지 먼저 분리했는가
- raw / normalized / serving 레이어를 구분했는가
- DART 원본 식별자와 출처 메타데이터를 보존하는가
- 연결/별도와 누적/단일 분기 규칙이 명확한가
- `/chart`를 언제 새 serving layer로 전환할지 계획이 있는가

### DB 수정 체크리스트

- 프론트엔드의 직접 쿼리 컬럼명이 깨지지 않는가
- Python 스크립트의 upsert payload와 충돌하지 않는가
- migration만 추가하고 기존 script를 놓치지 않았는가

## 17. 추천 로컬 실행 순서

프론트엔드 개발:

```bash
npm run dev
```

Python 준비:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

일일 배치 수동 실행:

```bash
./scripts/run_daily_stock_local.sh
```

개별 스크립트 실행 예시:

```bash
.venv/bin/python3 scripts/update_today_v3.py
.venv/bin/python3 scripts/calculate_trading_value_rank.py
.venv/bin/python3 scripts/calculate_rs_v2.py
```

## 18. 최종 요약

이 저장소의 핵심은 "화면"보다 "데이터 파이프라인"이다.

새 AI는 아래 원칙만 지켜도 크게 잘못 들어가지 않는다.

- `README.md`보다 `guide.md`, `scripts`, 실제 페이지 코드를 믿을 것
- 프론트 수정 시 항상 Supabase 테이블과 배치 스크립트를 같이 볼 것
- 재무 영역은 기존 테이블 연장이 아니라, DART 중심 새 구조로 재설계한다는 기준을 우선할 것
- build 통과를 안전 신호로 오해하지 말 것
- 큰 변경 전에는 현재 source of truth가 어느 파일/테이블인지 먼저 확인할 것
