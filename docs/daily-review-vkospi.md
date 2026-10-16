# VKOSPI 연결 — 2026-10-16

## 확인 및 구현

- 한국 공식 변동성지수 VKOSPI는 KOSPI 200 옵션에 반영된 기대 변동성이다. 지수 수익률로 계산한 실현 변동성이나 VKOSPI 선물로 대체하지 않는다.
- KIS 공식 `stocks_info/sector_code.py`에 명시된 `idxcode.mst.zip`을 TLS 검증을 유지해 읽고 `00503VKOSPI` 레코드에서 국내 업종 코드 `0503`을 확인했다.
- KIS 공식 `inquire_index_daily_price` 예제의 국내업종 일자별지수 API(`/uapi/domestic-stock/v1/quotations/inquire-index-daily-price`, TR `FHPUP02120000`, 시장 U, 일간 D) 응답을 확인했다.
- 이 API의 `output1`은 과거 날짜를 지정해도 현재 장중 스냅샷일 수 있다. 저장은 날짜가 있는 `output2`만 사용하고, 리뷰 전일까지의 일봉만 API에 반환한다.
- 기존 KIS 수집기에 국내 지수 분기를 추가하고 해외 분기는 유지했다. 국내 OHLC는 양수·유한값·범위를 검증한다. 일별 자료는 `KR_INDEX_VKOSPI`, 공급원 `KIS_DOMESTIC_INDEX_DAILY`로 구분해 저장한다.
- 최초 저장: 2025-09-10 ~ 2026-10-15, 265개. 2026-10-15 종가 55.38, 직전 44.91이다. 조회 당시 장중 값과 구분함을 확인했다.
- 기존 `market-daily` launchd 작업(07:15)이 변경된 Python 수집기와 설정을 읽으므로 별도 스케줄은 만들지 않았다. 실제 대상 24종에 VKOSPI 포함을 확인했다.
- 위험심리 표에 미국 VIX / 한국 VKOSPI를 구분해 배치했다. 1일·1주·1달 변화와 행별 차트, 한국 거래일·공급원·기대 변동성 설명을 표시한다. 지수 변화율은 표시된 관측일 기준이며 옵션 또는 투자상품 수익률이 아니다.

## 검증

- 국내 dated output2만 사용, 리뷰 이후 값 제외 및 장중 output1 무시, 비정상 종가 거부, 기존 해외 분기 유지 회귀 테스트 3건 통과.
- 변경 Python 컴파일, TypeScript ESLint, Next.js webpack 빌드, 기존 표 계산 테스트 11건 통과.
- 실제 저장과 API 확인: 2026-10-15 종가 55.38, `KIS_DOMESTIC_INDEX_DAILY` 출처. 새 검증 조건으로 45일 dry-run도 통과.
- 모바일 브라우저: VKOSPI 55.38, 1일 +23.31%, 1주 +50.45%, 1달 +21.37%; 행 클릭 차트와 출처 렌더 확인.
- 로컬 구현·DB·수집 스케줄 연결은 반영했다. 공개 사이트 프론트엔드 배포나 커밋/푸시는 수행하지 않았다.

공식 참고: [KIS 국내 지수 API 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_index_daily_price/inquire_index_daily_price.py), [KIS 코드 마스터 예제](https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/sector_code.py), [KRX의 VKOSPI 발표 설명](https://www.newswire.co.kr/newsRead.php?no=398267).
