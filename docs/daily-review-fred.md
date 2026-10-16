# FRED 경제지표 수집 · 2026-10-14

## 구현 및 실행

- 설정: `config/daily_review_fred.json`의 53종. 물가, 고용, 소비·생산, 주택, GDP·심리, 국채 만기, 실질금리·기대인플레이션, 신용·유동성, 광의 달러 및 WTI 현물.
- 실행: `.venv/bin/python3 -u scripts/collect_daily_review_fred.py`. 2016년부터 관측 이력을 조회한다. `--dry-run`은 저장하지 않는다. API 키 없이 공식 FRED CSV를 조회하며, Supabase 서버 자격증명은 기존 환경에서 읽는다.
- DB: `market_data.economic_series`, `economic_observations`, `economic_changes`. 새 migration에 정의된 RPC로 각 시리즈의 관측값과 변경 로그를 원자적으로 저장한다. 공개 DB 쓰기 권한은 부여하지 않는다. 로컬 실행 잠금으로 중복 수집을 방지한다.
- 첫 성공 저장은 기준선이다. 다음 실행부터 신규 관측값과 수정치를 old/new로 기록하고 한국시간 감지 날짜에 연결한다. 실패한 시리즈는 기존 관측값을 유지하고 오류 상태를 표시한다.
- 저장의 first_seen_at/last_checked_at은 우리 시스템의 수집 시각이며 FRED 자체 갱신 시각이나 원기관 발표 시각이 아니다. 발표 일정 API/원기관 시각/예상치/AI 해석은 미구현이다.
- 과거 차트는 현재 DB 수정값을 표시한다. 당시 알려졌던 값 재현은 미구현이며 UI에 안내한다. 단위가 %인 지표는 변화량을 %p로, 월간 수준값은 MoM/YoY로 표시한다. GDP 실질성장은 전분기 대비 연율을 계산한다. CPI 원자료 SA/NSA를 함께 수집한다.

## 검증 결과

- 2026-10-14 초기 실행: 53/53 성공, 관측값 74,524개 저장, 신규·수정 로그 0건.
- CPI 재실행: 0행 변경, 변경 로그 0건. API에서 53종의 실제 관측값·빈 초기 변경 목록 확인.
- CPI 최신 관측 기간 2026-08-01, 고용 2026-09-01, GDP 2026-04-01, WTI 2026-10-06. 관측 기간 날짜를 실제 발표일로 사용하지 않는다.
- 관련 ESLint·프로덕션 빌드 통과. 별도 타입 검사에서 변경 영역의 오류 없음; 저장소의 기존 다른 오류는 남아 있음.
- 경제지표 UI는 `/api/daily-review/economy`를 통해 실제 저장값을 읽는다. 각 그룹의 최근 36개 관측 추이를 제공한다. 이번 브라우저 확인은 제어 연결 타임아웃으로 완료하지 못했으며 API 조회는 성공했다.

## 예약 실행

- 2026-10-14 사용자의 요청으로 Codex 자동화 `fred`를 PAUSED로 전환하고 launchd로 교체했다.
- LaunchAgent: `com.myunghoon.my-stock-scheduler.fred-daily`, 사용자 `gui/501`에 등록 완료.
- 매일 Mac 현지시간 오전 7시 15분. 현재 Mac 시간대는 KST이며 첫 예약 실행은 2026-10-15 오전 7시 15분다. 시간대를 바꾸면 실행 시간도 해당 현지시간을 따른다.
- 실행 파일: `scripts/run_daily_review_fred_local.sh`. 기존 .venv와 .env.local을 사용한다. RunAtLoad/KeepAlive는 꺼져 있으며 중복 실행은 수집기의 잠금으로 방지한다.
- 설치된 plist: `/Users/myunghoon/Library/LaunchAgents/com.myunghoon.my-stock-scheduler.fred-daily.plist`. 저장소 원본은 `scripts/launchd/`에 있다.
- 로그: `/Users/myunghoon/Library/Logs/my-stock-scheduler/fred-daily.out.log`, `fred-daily.err.log`. Codex 앱 알림 없이 파일에 성공/실패를 기록한다.
- Mac이 켜져 있고 사용자 로그인 상태여야 한다. 컴퓨터 종료 중에는 실행할 수 없다. 내일 예약 실행 성공은 아직 확인 전이다.
- plist 유효성·실행 파일 구문 검사 및 launchctl의 오전 7시 15분 캘린더 트리거 확인 완료. 실행 파일로 CPI 1종 수집 성공, 기존 값 변경 0건. ChatGPT/Codex 앱 실행에 의존하지 않는다.

## 운영 점검·설정 수정 · 2026-10-16

- launchd 실제 실행: 10/15 07:15:00~07:15:43, 10/16 07:15:00~07:16:01 KST. 두 실행 모두 53종 오류 0. 변경 기록은 각각 27건, 102건이며 16일에는 신규 36·수정 66건이었다. 수정치가 많다는 것 자체는 실패가 아니다.
- 발견·수정: `PCECC96`은 FRED 공식 분기 시리즈인데 monthly로 설정돼 있었다. 기존 관측은 보존하고 이름·빈도를 분기로 바로잡았다. 실제 월간 실질소비 `PCEC96`을 추가해 2016년 이후 128개 관측을 기준선으로 저장했다. 현재 총 54종. 최초 저장은 신규 발표 알림으로 만들지 않았다.
- 실제 코드에 `--series CODE` 반복 옵션, 월간/분기 관측 간격 검증과 원천 최신일 후퇴 방지를 추가했다. 더 오래된 CSV가 반환돼도 DB 최신 체크포인트를 뒤로 이동시키지 않는다.
- 읽기 전용 점검 도구: `.venv/bin/python3 scripts/check_daily_review_economy.py --output /tmp/economy-check.json`. 54종의 최신 원천 CSV와 DB 관측일·값·설정 빈도·최근 확인 시각을 대조한다. 2026-10-16 실행에서 불일치·조회 실패 0건.
- CPI·소매판매 최신 관측월은 2026-09, 월간 실질소비는 2026-08로 원천과 일치했다. 미국 국채·WTI 등 일부 최신 관측일이 전일보다 오래된 경우에도 원천 CSV와 일치했다. 원천 관측기간이 오래됐다는 것만으로 수집 실패라고 단정하지 않는다. 원기관 최신 발표와 FRED CSV 갱신 간 지연은 여전히 별도 문제다.
- 제한: 발표 일정/원기관 발표 시각/예상치와 AI 해석은 아직 연결하지 않았다. 현재 설정에 PPI는 없으므로 뉴스에서 다뤘다고 경제지표 DB에도 수집됐다고 보지 않는다. 전체 과거 관측값의 수정 비교를 수행하지만 원천에서 사라진 관측값의 삭제·빈티지 재현은 미지원이다.
- 검증 자료: `/tmp/economy-live-audit-20261016.json`; 원천 메타데이터 https://fred.stlouisfed.org/series/PCECC96 및 https://fred.stlouisfed.org/series/PCEC96 .
- 공개 `/api/daily-review/economy?date=2026-10-16`에서도 54종, PCECC96 quarterly/PCEC96 monthly, 월간 최신 2026-08 관측을 검증했다. Python 테스트 8개·문법 검사 및 Webpack 프로덕션 빌드 통과.
