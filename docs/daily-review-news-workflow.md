# 데일리 리뷰 뉴스 · ChatGPT 직접 검토

## 실행 계약

- Python은 RSS 후보 수집·입력 검증·DB 저장만 담당한다. 별도 LLM API를 호출하거나 키워드 점수로 기사 중요도를 결정하지 않는다.
- ChatGPT/Codex가 이 작업에서 전체 후보를 읽고 시장 중요도 판단·사건 묶기·한국어 요약과 상세 설명을 직접 수행한다. `region`은 언론사/피드 국가 태그이며 기사가 다루는 시장 범위와 다르다.
- 출력 사건 수 상한은 없다. 전체 원문·RSS 본문은 DB에 영구 저장하지 않는다. 사건 요약·선별 이유·시장 범위·근거 기사 제목/출처/URL/발행 시각을 저장한다.

## 매일 실행

1. `.venv/bin/python3 scripts/daily_review_news.py collect` 실행. 기존 article-scrapper 전용 .venv를 사용한다. raw JSON/manifest는 `scripts/output/daily-review-news/`에 최신 스냅샷만 저장한다. 실패하거나 모든 후보가 없으면 요약을 지어내지 않는다.
2. raw JSON의 모든 제목을 작은 묶음으로 읽는다. 도구 출력이 잘린 부분은 다시 읽어 전체 검토를 완료한다. 후보를 키워드 필터로 먼저 제거하지 않는다.
3. 중요 후보의 요약과 시각을 읽고 같은 사건을 묶는다. 해외 사건은 해외 출처를 우선하되 국내 고유 정보도 포함한다. 해석·전망·확정 사실과 장중/종가를 구분한다. 제목뿐인 근거에는 `confidence`로 한계를 표시한다. 미해결 Google News 링크는 원문으로 해결됐다고 주장하지 않는다.
4. `/tmp`에 selection JSON을 작성한다. 필드: run_id, input_sha256, reviewed_article_ids(전체 후보 ID), excluded_article_ids(근거로 선택하지 않은 ID), exclusion_reasons(한국어 제외 이유 목록), events.
5. 각 events 항목: id(날짜 안의 안정적 사건 키), category(정책/기업·산업/경제), importance(핵심/주요), title, summary, details, reason, market_scope, confidence, article_ids(실제 후보 ID 목록).
6. `.venv/bin/python3 scripts/daily_review_news.py publish --selection /tmp/선별파일.json` 실행. 입력 hash/실행 ID/전체 후보 검토/선택·제외 분할/URL을 검증하고 저장한다. 이미 공개한 실행은 동일 내용 재실행만 허용한다. 수정하려면 새 수집 실행을 만든다.
7. `/api/daily-review/news?date=YYYY-MM-DD`에서 사건·수집 상태를 확인한다. 실패/검토대기/검토완료0건은 다른 상태다. 오류 시 기사 숫자만 보고 완전 수집이라고 판단하지 않는다.

## 저장·화면

- 테이블: `market_data.daily_review_news_runs`. 리뷰 날짜별 최신 수집 실행을 표시하고 이전 실행은 보존한다. 새 수집 실행이 PENDING이면 이전 결과를 오늘 최신 결과로 가장하지 않는다.
- Python publisher만 기존 service role로 쓰며 공개 쓰기 API는 없다. UI 서버의 읽기 API는 안전한 상태·사건·기사 링크만 반환한다.
- 뉴스 분류/안 읽음/브라우저별 읽음 표시는 기존 흐름을 유지한다. 핵심 사건 먼저 표시한다.

## 검증 기록 · 2026-10-14

- 현재 24시간 RSS 후보 1,223건 전체 제목 검토. 직접 선정한 37개 사건, 근거 기사 114건 저장.
- 수집 구간: 2026-10-13T04:19:28Z ~ 2026-10-14T04:19:28Z. 리뷰 날짜 2026-10-14 KST. 한국 당일 장중 보도도 포함되며 전일 미국장 종가와 구분한다.
- status PARTIAL: 일부 경향신문·한겨레 피드의 발행 시각 누락. 원문 검증/링크 해석을 모든 기사에 대해 완료한 결과는 아니다.
- 요약 생성에 별도 OpenAI API·SDK·API 키를 사용하지 않았다. 최초 버전은 ChatGPT 직접 판단이며 재현할 입력 hash와 선별 방법을 기록한다.
- 매일 ChatGPT 직접 검토에는 Codex 앱 로컬 자동화의 실행 환경이 필요하다. FRED launchd 작업과 독립적이며, FRED 수집은 ChatGPT 없이 계속 실행할 수 있다.
- 매일 07:15 KST Codex heartbeat `automation-2` ACTIVE 등록. 첫 다음 예약은 2026-10-15. 정상 성공은 조용히 마치고 실패/조치 필요 시 알리도록 설정했다.
- API에서 37개 사건/114개 참조/1,223개 후보/PARTIAL 상태 확인. 동일 결과 재발행은 'Already published; no change'로 종료했다. 기사 summary/content_snippet은 근거 참조에 저장되지 않음을 확인했다.
- 관련 ESLint와 프로덕션 빌드 통과. 브라우저 제어가 타임아웃으로 실패해 시각 검증은 미완료다.

## 상세 설명 · 2026-10-14

- 각 사건에 `details`를 필수로 작성한다. 카드 본문 summary는 짧게 유지하고, 펼친 영역 맨 위에는 details의 문단별 상세 설명을 표시한다. 그 아래 선별 이유·불확실성·근거 링크를 배치한다.
- details는 사건의 확인된 사실, 배경·맥락, 아직 확인해야 할 부분을 설명한다. 제목이나 RSS 요약에 없는 숫자·사실을 추정으로 보충하지 않는다. 같은 summary의 단순 반복이나 고정 문구가 아니라 사건별로 직접 작성한다.
- 기존 공개 결과의 설명 보강은 `daily_review_news.py enrich --selection ...`로 수행한다. 기존 요약·선별 이유·근거 자료가 모두 동일한지 검증하고 details만 보강한다. 이전 사건 JSON hash와 보강 시각을 audit에 남긴다. 검토 시각을 이용한 조건부 갱신으로 동시 수정을 탐지한다.
- 현재 저장된 37개 사건 모두 2문단 이상의 상세 설명을 보강했다. API에서 details 반환과 기존 summary/reason 보존 확인. 관련 ESLint·프로덕션 빌드 통과. 매일 직접 검토 자동화에도 details 작성 규칙을 추가했고 실행 시간은 유지했다.

- 사용자 요청으로 뉴스 직접 선별 예약을 매일 06:00 및 15:00 KST로 변경했다. 기존 07:15 예약을 대체하며 수집·상세 설명·검증 규칙은 유지한다. 각 실행은 최근 24시간 후보를 새로 수집하고, 날짜별 화면은 최신 실행 결과를 표시한다.
