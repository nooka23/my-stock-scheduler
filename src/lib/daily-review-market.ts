/** Verified instruments connected to daily-review collectors. */
export const reviewMarketCodes: Record<string, string> = {
  us2y: 'DGS2',
  wti: 'OPINET_WTI_FUTURE', brent: 'OPINET_BRENT_FUTURE', dubai: 'OPINET_DUBAI_SPOT',
  gold: 'YAHOO_GOLD_FUTURE', copper: 'YAHOO_COPPER_FUTURE', dxy: 'YAHOO_DXY', russell: 'YAHOO_RUSSELL2000',
  btc: 'CRYPTO_BTCUSD', spx: 'US_INDEX_SP500', nasdaq: 'US_INDEX_NASDAQ', dow: 'US_INDEX_DOW',
  sox: 'US_INDEX_SOX', vix: 'US_INDEX_VIX', us10y: 'US_RATE_10Y',
  krw: 'FX_USDKRW', jpy: 'FX_USDJPY', eur: 'FX_EURUSD', gbp: 'FX_GBPUSD',
  cny: 'FX_USDCNY', jpykrw: 'FX_JPYKRW', cnykrw: 'FX_CNYKRW',
  us1y: 'US_RATE_1Y', us30y: 'US_RATE_30Y', fedfunds: 'US_RATE_FED_FUNDS',
  discount: 'US_RATE_DISCOUNT', prime: 'US_RATE_PRIME',
  kr1y: 'KR_RATE_1Y', kr3y: 'KR_RATE_3Y', kr5y: 'KR_RATE_5Y',
  kr10y: 'KR_RATE_10Y', kr20y: 'KR_RATE_20Y', kr30y: 'KR_RATE_30Y',
};
export const yahooReviewAssets = new Set(['gold', 'copper', 'dxy', 'russell']);
export const opinetReviewAssets = new Set(['wti', 'brent', 'dubai']);
export function reviewSourceLabel(instrument: string) {
  if (instrument === 'us2y') return 'FRED · DGS2';
  if (opinetReviewAssets.has(instrument)) return '오피넷 · 개인용';
  if (yahooReviewAssets.has(instrument)) return 'Yahoo Finance · 개인용';
  if (instrument === 'btc') return 'Coinbase · 개인용';
  return instrument === 'cnykrw' ? 'KIS 기반 계산' : 'KIS 일봉';
}
export type MarketHistory = {
  rows: { time: string; value: number }[];
  through: string;
  source: string;
  sourceLabel?: string;
  dayBoundary?: string;
};
export function koreanDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
