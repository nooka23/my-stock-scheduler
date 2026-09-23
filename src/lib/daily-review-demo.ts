/** Synthetic fixtures for the review prototype. Never market observations. */
export type ReviewSection = 'news' | 'economy' | 'macro' | 'sentiment' | 'indices';
export type ReviewNews = {
  id: string;
  category: '정책' | '기업·산업' | '경제';
  importance: '핵심' | '주요';
  title: string;
  summary: string;
  reason: string;
  sources: string[];
};
export type ReviewInstrument = {
  id: string;
  name: string;
  symbol: string;
  unit: string;
  group: '금리' | '환율' | '원자재' | '위험 심리' | '지수';
  base: number;
  slope: number;
  precision: number;
  kind: string;
};

export const reviewSections: { id: ReviewSection; number: string; title: string; subtitle: string }[] = [
  { id: 'news', number: '01', title: '시장 뉴스', subtitle: '오늘 새롭게 확인할 사건' },
  { id: 'economy', number: '02', title: '경제지표', subtitle: '새 발표와 이전 수치의 변화' },
  { id: 'macro', number: '03', title: '매크로 가격', subtitle: '금리 · 환율 · 원자재' },
  { id: 'sentiment', number: '04', title: '위험 심리', subtitle: 'VIX · 금 · 비트코인' },
  { id: 'indices', number: '05', title: '주요 지수', subtitle: '시장의 방향과 확산' },
];

export const demoNews: ReviewNews[] = [
  { id: 'policy', category: '정책', importance: '핵심', title: '무역 정책 변화, 적용 범위와 시행 시점 확인', summary: '새 정책이 발표된 상황을 가정한 예시입니다. 발표 내용과 실제 시행 조건을 구분해 확인합니다.', reason: '기업의 비용과 공급망에 영향을 주는 변화인지, 이미 알려진 내용의 반복인지 살펴봅니다.', sources: ['정책 발표 원문', '관련 보도'] },
  { id: 'semis', category: '기업·산업', importance: '핵심', title: '반도체 투자 계획, 수요가 이어지는지 점검', summary: '주요 기업의 설비 투자 계획이 공개된 상황입니다. 투자 규모뿐 아니라 집행 시기와 수요 근거를 함께 봅니다.', reason: '반도체와 장비 등 관련 종목군으로 영향이 확산될 수 있는 사건입니다.', sources: ['기업 IR 발표', '실적 설명회', '산업 보도'] },
  { id: 'inflation', category: '경제', importance: '주요', title: '물가 발표 이후, 금리와 주식의 반응을 함께 확인', summary: '물가 지표가 나온 날의 리뷰 예시입니다. 지표 자체의 변화와 발표 이후 가격의 움직임을 나눠 기록합니다.', reason: '숫자의 개선과 시장 반응이 일치하는지 확인할 필요가 있습니다.', sources: ['통계기관 발표'] },
  { id: 'energy', category: '기업·산업', importance: '주요', title: '에너지 공급 관련 발표, 일시적 이슈인지 구분', summary: '원유 공급 관련 소식이 나온 상황입니다. 공급 변화의 규모와 지속 기간을 확인합니다.', reason: '원유 가격과 물가 기대에 영향을 줄 만한 내용인지 점검합니다.', sources: ['공식 발표', '관련 보도'] },
];

export const demoInstruments: ReviewInstrument[] = [
  { id: 'us2y', name: '미국 2년물', symbol: 'US 2Y', unit: '%', group: '금리', base: 4.1, slope: -0.07, precision: 2, kind: '국채 수익률' },
  { id: 'us10y', name: '미국 10년물', symbol: 'US 10Y', unit: '%', group: '금리', base: 4.35, slope: 0.03, precision: 2, kind: '국채 수익률' },
  { id: 'dxy', name: '달러 지수', symbol: 'DXY', unit: 'pt', group: '환율', base: 101.2, slope: -0.06, precision: 2, kind: '달러 지수' },
  { id: 'krw', name: '달러 / 원', symbol: 'USD/KRW', unit: 'KRW', group: '환율', base: 1370, slope: 0.04, precision: 2, kind: '원 / 1달러' },
  { id: 'jpy', name: '달러 / 엔', symbol: 'USD/JPY', unit: 'JPY', group: '환율', base: 148.3, slope: -0.04, precision: 2, kind: '엔 / 1달러' },
  { id: 'eur', name: '유로 / 달러', symbol: 'EUR/USD', unit: 'USD', group: '환율', base: 1.12, slope: 0.03, precision: 4, kind: '달러 / 1유로' },
  { id: 'wti', name: 'WTI 원유', symbol: 'WTI', unit: 'USD/bbl', group: '원자재', base: 72.5, slope: -0.12, precision: 2, kind: '선물 · 계약 기준 미정' },
  { id: 'copper', name: '구리', symbol: 'COPPER', unit: 'USD/lb', group: '원자재', base: 4.6, slope: 0.13, precision: 3, kind: '선물 · 계약 기준 미정' },
  { id: 'vix', name: '변동성 지수', symbol: 'VIX', unit: 'pt', group: '위험 심리', base: 18.3, slope: -0.12, precision: 2, kind: '예상 변동성 지수' },
  { id: 'gold', name: '금', symbol: 'XAU/USD', unit: 'USD/oz', group: '위험 심리', base: 2650, slope: 0.2, precision: 2, kind: '현물 · 달러 / 트로이온스' },
  { id: 'btc', name: '비트코인', symbol: 'BTC/USD', unit: 'USD', group: '위험 심리', base: 92000, slope: 0.27, precision: 0, kind: '현물 · 거래소 기준 미정' },
  { id: 'spx', name: 'S&P 500', symbol: 'SPX', unit: 'pt', group: '지수', base: 5800, slope: 0.17, precision: 2, kind: '주가 지수' },
  { id: 'nasdaq', name: '나스닥 종합', symbol: 'NASDAQ', unit: 'pt', group: '지수', base: 18300, slope: 0.23, precision: 2, kind: '주가 지수' },
  { id: 'dow', name: '다우', symbol: 'DJIA', unit: 'pt', group: '지수', base: 41000, slope: 0.1, precision: 2, kind: '주가 지수' },
  { id: 'russell', name: '러셀 2000', symbol: 'RUT', unit: 'pt', group: '지수', base: 2100, slope: 0.06, precision: 2, kind: '주가 지수' },
  { id: 'sox', name: '필라델피아 반도체', symbol: 'SOX', unit: 'pt', group: '지수', base: 5100, slope: 0.25, precision: 2, kind: '업종 지수' },
];

export function makeDemoSeries(instrument: ReviewInstrument, endDate: string) {
  const phase = instrument.id.length * 0.73;
  const dates: string[] = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(cursor);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  while (cursor > start) {
    if (instrument.id === 'btc' || (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6)) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.map((time, i) => ({
    time,
    value: Number((instrument.base * (1 + instrument.slope * i / dates.length + Math.sin(i * 0.08 + phase) * 0.025 + Math.sin(i * 0.51 + phase) * 0.006)).toFixed(instrument.precision)),
  }));
}

export const demoCpi = [
  { month: '3월', headline: 3.4, core: 3.8 }, { month: '4월', headline: 3.3, core: 3.6 },
  { month: '5월', headline: 3.2, core: 3.5 }, { month: '6월', headline: 3.0, core: 3.4 },
  { month: '7월', headline: 2.9, core: 3.3 }, { month: '8월', headline: 2.8, core: 3.2 },
];
