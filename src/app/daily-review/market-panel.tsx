'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { makeDemoSeries, type ReviewInstrument } from '@/lib/daily-review-demo';
import styles from './review.module.css';

const IndexLineChart = dynamic(() => import('@/components/IndexLineChart'), { ssr: false, loading: () => <div className={styles.chartLoading}>예시 차트 준비 중…</div> });

export default function MarketPanel({ instruments, date, delayed = false }: { instruments: ReviewInstrument[]; date: string; delayed?: boolean }) {
  const [selected, setSelected] = useState(instruments[0].id);
  const [period, setPeriod] = useState(12);
  const instrument = instruments.find(item => item.id === selected) ?? instruments[0];
  const series = useMemo(() => makeDemoSeries(instrument, date), [instrument, date]);
  const visible = useMemo(() => {
    const cutoff = new Date(`${date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - period);
    return series.filter(point => point.time > cutoff.toISOString().slice(0, 10));
  }, [series, period, date]);
  const last = series[series.length - 1].value;
  const previous = series[series.length - 2].value;
  const difference = last - previous;
  const change = instrument.group === '금리' ? difference * 100 : difference / previous * 100;
  const format = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: instrument.precision, maximumFractionDigits: instrument.precision });

  return <div className={styles.marketPanel}>
    <div className={styles.instrumentList} aria-label="확인할 자산">
      {instruments.map(item => <button type="button" key={item.id} aria-pressed={item.id === instrument.id} onClick={() => setSelected(item.id)} className={item.id === instrument.id ? styles.selectedInstrument : ''}>
        <span>{item.name}</span><small>{item.symbol}</small>
      </button>)}
    </div>
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div><div className={styles.eyebrow}>{instrument.symbol} <span>· 예시</span></div><h3>{instrument.name}</h3></div>
        <div className={styles.periods} aria-label={`${instrument.name} 차트 기간`}>
          {[[1, '1M'], [3, '3M'], [12, '1Y']].map(([months, label]) => <button type="button" key={months} aria-pressed={period === months} onClick={() => setPeriod(Number(months))}>{label}</button>)}
        </div>
      </div>
      {!delayed && <div className={styles.priceRow}><strong>{format(last)}</strong><span>{instrument.unit}</span><b className={difference >= 0 ? styles.up : styles.down}>{change >= 0 ? '+' : ''}{change.toFixed(2)}{instrument.group === '금리' ? 'bp' : '%'} <small>직전 관측 대비</small></b></div>}
      {delayed ? <div className={styles.chartEmpty}><span>갱신 대기</span><h4>최신 관측값을 기다리고 있습니다</h4><p>이전 값을 오늘 가격으로 표시하지 않습니다.</p><small>수집 지연 상황을 보여주는 예시입니다.</small></div> : <div className={styles.chart} aria-label={`${instrument.name} 합성 예시 가격 추이`}><IndexLineChart data={visible} wmaPeriod={1} pricePrecision={instrument.precision} /></div>}
      <div className={styles.chartFoot}><span>{instrument.kind}</span><span>{delayed ? '최신값 미수신 · 예시' : `${date}까지 · 합성 일별 데이터`}</span></div>
    </div>
  </div>;
}
