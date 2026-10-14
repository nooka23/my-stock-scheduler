# 데일리 리뷰 미연결 시장 데이터 공급원

확인일: 2026-10-14. 가격은 USD이며 표시 플랜 가격과 최종 라이선스 견적을 구분한다. 유료 상품을 구매하지 않았다.

## 최신 결정: 07:15 갱신 및 세 유종 일별 저장

- 사용자 요청으로 FRED, Yahoo, KIS 리뷰용 시장 데이터, 오피넷 원유의 launchd 수집 시작을 매일 한국시간 07:15로 통일했다. BTC만 기존 09:10을 유지한다. 수집 시작 시각과 완료 시각은 다르다.
- KIS 시장 수집은 기존 06:10 미국 주식 파이프라인의 마지막 단계에서 분리했다. 미국 주식 작업의 시간은 유지하고 별도 scripts/run_daily_review_market_local.sh를 07:15에 예약했다. 기존 앞 단계 실패에 시장 수집이 막히지 않는다. 23/23 직접수집 및 계산환율, 667행 수동 실행 성공 확인.
- 뉴스 AI 선별의 기존 06시/15시 예약은 이번 시장·경제 데이터 갱신 시간 변경에 포함하지 않았다.
- [한국석유공사 오피넷 국제 원유](https://www.opinet.co.kr/glopcoilSelect.do)의 공식 CSV 다운로드를 검증했다. Dubai는 싱가포르 현물 가격 추정값, WTI는 NYMEX 선물 가격, Brent는 ICE 선물 가격이다. 조사주기는 화~토이며 현지 시차로 T일 가격을 T+1일 조사한다. 무료 FRED 월평균을 일별 두바이유 대신 사용하지 않았다.
- 오피넷 자료의 공급원은 OPINET, 출처는 OPINET_CRUDE_DAILY. 세 유종 모두 USD/bbl로 저장하고 현물/선물 이름을 구분한다. 공표 관측일을 보존하고 리뷰 전일 이후의 자료는 제외한다. CSV에는 가격만 있으므로 OHLC·거래량을 임의 생성하지 않는다.
- 초기 저장: 2025-09-29~2026-10-13, Dubai 262행, Brent 269행, WTI 262행, 총 793행. 각 시장 휴장 차이와 결측은 그대로 유지한다. 일별 자료를 저장하지만 틱·실시간 자료는 아니다.
- 실행기 scripts/run_daily_review_opinet_local.sh, 수집기 scripts/collect_opinet_crude.py, 예약 com.myunghoon.my-stock-scheduler.opinet-crude-daily. 매일 최근 14일 upsert. 초기 조회는 --lookback-days 380. 요청 기간은 연도별 분할, 월·일은 반드시 두 자리로 보내고 기간 밖 반환은 실패 처리한다. 공식 다운로드 형식이 바뀌면 실패 기록을 남긴다. 공휴일은 임의로 채우지 않는다.
- 원유 세 항목은 현재 소유자 조회로 제한했다. 무료 다운로드 제공과 외부 재배포 허가를 동일시하지 않았으며 일반 이용자 공개 권한은 미확인이다.
- Yahoo CL=F·BZ=F도 별도 instrument/source로 각 262행 저장했다. BZ=F는 NYMEX Brent Last Day Financial 상품으로 ICE Brent와 구분한다. 리뷰의 원유 세 차트는 오피넷으로 통일해 표시한다. Yahoo 원유는 비교·대체 후보로 별도 저장하며 자동으로 오피넷 결측을 채우지 않는다.
- WTI 현물 DCOILWTICO는 기존 FRED 경제지표 수집을 유지한다. 현물과 선물은 같은 시계열로 합치지 않는다. 계약 만기·재고·보관 비용·롤오버에 따라 차이가 변하므로 고정적인 차액을 가정하지 않는다.
- 검증: CSV 날짜·인코딩·결측·종가 전용 저장 검사, Python 문법 검사, 관련 ESLint, 프로덕션 빌드 통과. 별도 타입 검사에서 daily-review 오류 없음(기존 다른 파일 오류 유지). 모든 launchd 등록과 07:15/BTC09:10 설정을 확인했다. 첫 예약 자동 실행과 소유자 화면 시각 검증은 아직 미완료다.

## 최신 구현: Yahoo 개인용 수집

사용자가 무료 데이터의 DB 저장을 요청하고 Yahoo 개인용 수집을 승인했다. 아래 네 자산을 추가했으며 앞선 공개용 유료 공급원 비교는 공개 확대 시의 참고 기록이다.

| 화면 항목 | 공급원 심볼 | 저장 범위 | 행 수 |
|---|---|---|---|
| 금 선물 | GC=F | 2025-09-29~2026-10-13 | 262 |
| 구리 선물 | HG=F | 2025-09-29~2026-10-13 | 262 |
| 달러 지수 | DX-Y.NYB | 2025-09-29~2026-10-13 | 262 |
| 러셀 2000 | ^RUT | 2025-09-29~2026-10-13 | 262 |

- Python이 Yahoo chart endpoint에서 일봉 OHLCV를 읽어 기존 market_data.global_daily_prices에 저장한다. 공식 지원이 보장된 API가 아니므로 변경·차단 위험이 있다. [yfinance 프로젝트의 개인용·데이터 권한 안내](https://github.com/ranaroussi/yfinance)를 참고하며, 라이브러리의 사용 권한이 데이터 공개 권한을 부여하지는 않는다.
- 공급원은 YAHOO, 출처는 YAHOO_CHART_DAILY. 기존 KIS·Coinbase 데이터는 다른 instrument/source로 유지한다.
- 금·구리는 현물이 아닌 Yahoo 선물 이력이다. 직접 계약별 연속 선물과 롤오버·백어드저스트를 계산하지 않는다. 계약 교체에 따른 가격 차이가 있을 수 있음을 화면에 표시한다.
- 관측일은 공급원의 거래소 시간대로 계산한다. 당일 봉은 공급원 regular 세션 종료 30분 이후만 허용한다. 세션 종료 정보가 없으면 당일 봉을 제외한다. 결측 OHLC는 건너뛰고 잘못된 OHLC·7일 초과 오래된 마지막 관측은 실패로 처리한다. 공휴일·누락일을 임의로 채우지 않는다.
- 최근 14일을 반복 upsert한다. 공급원의 수정값은 갱신되므로 당시 리뷰 스냅샷이나 모든 수정 이력을 보존하는 기능은 아니다. 자산별 실패를 기록하고 다른 자산 수집은 계속하며 전체 작업은 실패 종료한다.
- 완료된 네 자산 일봉 총 1,048행을 저장했다. 기본 14일 재실행은 10행씩 갱신했고 총 행 수 1,048을 유지했다.
- API는 소유자 로그인으로 제한한다. 공개 리뷰 경로에서도 이 네 자산의 데이터는 일반 이용자에게 반환하지 않는다.
- 실행기: scripts/run_daily_review_yahoo_local.sh. launchd: com.myunghoon.my-stock-scheduler.yahoo-review-daily, 매일 한국시간 07:15. 로그: ~/Library/Logs/my-stock-scheduler/yahoo-review-daily.{out,err}.log. Mac과 사용자 launchd 세션이 실행 가능한 상태여야 한다. 06시 리뷰는 07:15 갱신 전 저장본을 사용하므로 최신 관측일을 확인해야 한다.
- 초기 이력 수집: scripts/run_daily_review_yahoo_local.sh --lookback-days 380. 예약과 초기 수집 모두 실제 실행 확인을 구분하며, 예약 등록 후 첫 자동 실행은 아직 도래하지 않았다.
- 검증: Python 문법 검사 및 미완료 봉 제외·종료 세션 허용·잘못된 OHLC 거부 검사 통과. 관련 ESLint와 프로덕션 빌드 통과. 별도 타입 검사에서 daily-review 오류 없음(기존 다른 파일 오류 있음). 비로그인 네 API 모두 401, 기존 S&P 500 정상 200, 모바일 페이지 200과 GC=F 표시 확인. 소유자 로그인 화면의 차트 시각 검증 및 일반 로그인 사용자 403 실검증은 미완료다.

## 구현한 BTC

- Coinbase Exchange BTC-USD의 완료된 UTC 일봉만 저장한다. 현물 가격이며 선물이 아니다.
- 초기 380행: 2025-09-29~2026-10-13. 진행 중인 2026-10-14 봉은 제외했다.
- 매일 한국시간 09:10 launchd로 최근 7일을 upsert한다. UTC 일봉 종료는 한국시간 09:00이므로 오전 06시 리뷰에는 그 시점에 완료된 직전 봉을 표시한다.
- 소유자 로그인에서만 API 조회를 허용한다. 다른 로그인 사용자도 소유자 확인을 통과해야 한다. 소유자 판정은 기존 wiki_is_owner RPC를 재사용한다.
- [Coinbase 시장 데이터 약관](https://www.coinbase.com/legal/market_data)은 제3자에게 앱·차트로 표시할 때 사전 서면 동의를 요구한다. 공개 API에 키가 없다는 사실은 공개 재배포 허가를 뜻하지 않는다. 일반 공개 페이지의 BTC 데이터 제공은 아직 완료하지 않았다.
- 수집기: scripts/collect_coinbase_btc.py. 실행기: scripts/run_daily_review_btc_local.sh. 예약: com.myunghoon.my-stock-scheduler.btc-daily, 매일 09:10. Mac이 깨어 있고 사용자 launchd 세션이 실행 가능한 상태여야 한다.
- [캔들 API 문서](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles): 일봉 granularity 86400, 요청당 최대 300봉. 범위를 나누어 요청하고 범위 밖·미완료 봉을 제외한다.

## 금·구리·달러지수·러셀 2000

| 공급원 | 확인된 범위 | 개인용 표시 가격 | 공개 표시 판단 |
|---|---|---|---|
| Massive | COMEX 금 GC·구리 HG 선물, 유료 지수 RUT. DXY 지원 미확인 | Futures Basic $0, Starter $29/월 등 | 다른 사람이 보는 데이터는 Business 필요. 문서에 COMEX Business $999/월 표시. 지수 요금·거래소 비용·지연 일봉 공개 권한은 별도 확인 필요 |
| Twelve Data | 금 등 commodities와 외부 표시용 Business 상품. 구리·DXY·RUT의 정확한 심볼/상품 지원은 미확인 | 개인용은 외부 표시에 사용할 수 없음 | Venture 월 결제 $499/월, 연 결제 환산 $414/월. 요청한 자산 모두와 거래소 권한이 이 가격에 포함된다는 뜻은 아님 |
| ICE | 공식 USDX 관련 데이터 | 견적 필요 | 공개용 API·일봉·재배포 권한 견적 필요 |

근거:

- [Massive 상품 범위](https://massive.com/knowledge-base/article/does-massive-support-commodities-data), [개인용 선물 요금](https://massive.com/pricing?product=futures), [선물 문서와 Business 플랜](https://massive.com/docs/rest/futures/overview), [계정 및 이용 범위 안내](https://massive.com/knowledge-base/categories/account).
- [Twelve Data Business 요금](https://twelvedata.com/pricing-business), [개인용·상업용 구분](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage).
- [ICE Currency Indices](https://www.ice.com/fixed-income-data-services/index-solutions/currency-indices).

## 다음 구매 전에 확인할 내용

현재 확인한 공개용 표시 가격은 이 프로젝트의 일봉 네 종을 추가하기에 비용 부담이 크다. 우선 구매를 보류하고 다음 내용을 공급원에 확인하는 것이 좋다.

1. GC·HG의 개별 계약 또는 연속 선물 중 어떤 것을 제공하는지, 롤오버 규칙과 과거 수정 여부.
2. 현물 금을 원한다면 XAU/USD를 선택하고 선물 GC와 구분할 것.
3. ICE DXY와 Russell 2000 RUT의 정확한 지원 여부. 달러 ETF·러셀 ETF는 지수 자체와 다른 상품이다.
4. 불특정 사이트 이용자에게 종가 이력과 차트를 공개할 수 있는지. 로그인 유무와 별개로 제3자 표시 권한이 필요하다.
5. 1년 이상 DB 저장, API 전달, 차트 표시, 출처 표기 및 거래소 비용을 포함한 총 월 비용.

예산과 서면 이용 권한을 확정한 뒤 해당 공급원의 수집기를 추가한다. 무료 개인용 구독을 공개 페이지용으로 사용하지 않는다.

## 검증

- BTC DB 380행과 날짜 범위 확인. 비로그인 BTC API 401 확인. 기존 S&P 500 API 249행 정상 반환.
- 관련 ESLint 통과, 프로덕션 빌드 성공. 별도 TypeScript 검사에서 daily-review 관련 오류 없음. 저장소의 기존 다른 파일 타입 오류는 남아 있다.
- 소유자 로그인 상태의 화면 및 일반 로그인 사용자 403 실검증은 수행하지 않았다. 권한 분기는 코드에 구현했다. 이번 변경의 브라우저 시각 검증은 미완료다.
