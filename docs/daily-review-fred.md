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
