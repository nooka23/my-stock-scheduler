/** Verified instruments connected to daily-review collectors. */
export const reviewMarketCodes: Record<string, string> = {
  us2y: 'DGS2',
  wti: 'OPINET_WTI_FUTURE', brent: 'OPINET_BRENT_FUTURE', dubai: 'OPINET_DUBAI_SPOT',
  gold: 'YAHOO_GOLD_FUTURE', copper: 'YAHOO_COPPER_FUTURE', dxy: 'YAHOO_DXY', russell: 'YAHOO_RUSSELL2000',
  btc: 'CRYPTO_BTCUSD', spx: 'US_INDEX_SP500', nasdaq: 'US_INDEX_NASDAQ', dow: 'US_INDEX_DOW',
  sox: 'US_INDEX_SOX', vix: 'US_INDEX_VIX', vkospi: 'KR_INDEX_VKOSPI', us10y: 'US_RATE_10Y',
  krw: 'FX_USDKRW', jpy: 'FX_USDJPY', eur: 'FX_EURUSD', gbp: 'FX_GBPUSD',
  cny: 'FX_USDCNY', jpykrw: 'FX_JPYKRW', cnykrw: 'FX_CNYKRW',
  us1y: 'US_RATE_1Y', us30y: 'US_RATE_30Y', fedfunds: 'US_RATE_FED_FUNDS',
  discount: 'US_RATE_DISCOUNT', prime: 'US_RATE_PRIME',
  kr1y: 'KR_RATE_1Y', kr3y: 'KR_RATE_3Y', kr5y: 'KR_RATE_5Y',
  kr10y: 'KR_RATE_10Y', kr20y: 'KR_RATE_20Y', kr30y: 'KR_RATE_30Y',
};
export const treasuryReviewCodes: Record<string, string> = { us1y: 'UST_1Y', us2y: 'UST_2Y', us10y: 'UST_10Y', us30y: 'UST_30Y' };
export const yahooReviewAssets = new Set(['gold', 'copper', 'dxy', 'russell']);
export const opinetReviewAssets = new Set(['wti', 'brent', 'dubai']);
export function reviewSourceLabel(instrument: string) {
  if (treasuryReviewCodes[instrument]) return '미국 재무부 · 일별 파 수익률';
  if (opinetReviewAssets.has(instrument)) return '오피넷 · 개인용';
  if (yahooReviewAssets.has(instrument)) return 'Yahoo Finance · 개인용';
  if (instrument === 'vkospi') return 'KRX VKOSPI · KIS 일봉';
  if (instrument === 'btc') return 'Coinbase · 개인용';
  return instrument === 'cnykrw' ? 'KIS 기반 계산' : 'KIS 일봉';
}
export type MarketHistory = {
  rows: { time: string; value: number }[];
  through: string;
  source: string;
  sourceLabel?: string;
  dayBoundary?: string;
  freshness?: string;
};
export function koreanDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Compare observation dates, not fetch dates. Older dates alone never prove failure. */
export function observationStatus(latest: string | undefined, through: string, failed = false, weekdaysOnly = true) {
  if (failed) return '최근 수집 실패 · 표시된 관측일의 기존 저장값입니다.';
  if (!latest) return '저장값 없음 · 수집 및 공급원 공표 여부를 확인하세요.';
  const target = new Date(`${through}T00:00:00Z`);
  while (weekdaysOnly && [0, 6].includes(target.getUTCDay())) target.setUTCDate(target.getUTCDate() - 1);
  if (latest >= target.toISOString().slice(0, 10)) return weekdaysOnly ? '직전 평일 관측일 반영 · 공휴일 및 자산별 거래일은 별도입니다.' : '리뷰 전일의 UTC 일봉 반영';
  return weekdaysOnly ? '직전 평일 값 미확인 · 공급원 공표 대기 또는 휴장 가능. 수집 성공과 최신 날짜 반영은 다릅니다.' : '리뷰 전일의 UTC 일봉 미반영 · 한국시간 09:00 종료 후 수집 여부를 확인하세요.';
}
