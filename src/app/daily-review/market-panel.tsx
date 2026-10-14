'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { type ReviewInstrument } from '@/lib/daily-review-demo';
import { reviewMarketCodes, reviewSourceLabel, type MarketHistory } from '@/lib/daily-review-market';
import styles from './review.module.css';

const IndexLineChart = dynamic(() => import('@/components/IndexLineChart'), { ssr: false, loading: () => <div className={styles.chartLoading}>차트 준비 중…</div> });

export default function MarketPanel({ instruments, date }: { instruments: ReviewInstrument[]; date: string }) {
  const [selected, setSelected] = useState(() => (instruments.find(item => reviewMarketCodes[item.id]) ?? instruments[0]).id);
  const [period, setPeriod] = useState(12);
  const instrument = instruments.find(item => item.id === selected) ?? instruments[0];
  const [result, setResult] = useState<{ key: string; data?: MarketHistory; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const supported = Boolean(reviewMarketCodes[instrument.id]);
  const requestKey = `${instrument.id}:${date}:${retry}`;
  const current = result?.key === requestKey ? result : null;
  const loading = supported && !current;
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    fetch(`/api/daily-review/market?instrument=${encodeURIComponent(instrument.id)}&date=${date}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '시장 데이터 조회 실패');
        return data as MarketHistory;
      })
      .then(data => { if (!controller.signal.aborted) setResult({ key: requestKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : '시장 데이터 조회 실패' }); });
    return () => controller.abort();
  }, [instrument.id, date, supported, requestKey]);
  const series = useMemo(() => current?.data?.rows ?? [], [current]);
  const visible = useMemo(() => {
    const cutoff = new Date(`${date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - period);
    return series.filter(point => point.time > cutoff.toISOString().slice(0, 10));
  }, [series, period, date]);
  const lastPoint = series.at(-1);
  const last = lastPoint?.value;
  const previous = series.at(-2)?.value;
  const difference = last !== undefined && previous !== undefined ? last - previous : null;
  const change = difference === null ? null : instrument.group === '금리' ? difference * 100 : previous ? difference / previous * 100 : null;
  const format = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: instrument.precision, maximumFractionDigits: instrument.precision });

  return <div className={styles.marketPanel}>
    <div className={styles.instrumentList} aria-label="확인할 자산">
      {instruments.map(item => <button type="button" key={item.id} aria-pressed={item.id === instrument.id} onClick={() => setSelected(item.id)} className={item.id === instrument.id ? styles.selectedInstrument : ''}>
        <span>{item.name}</span><small>{item.symbol}</small>
      </button>)}
    </div>
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div><div className={styles.eyebrow}>{instrument.symbol} <span>· {supported ? reviewSourceLabel(instrument.id) : '수집 미연결'}</span></div><h3>{instrument.name}</h3></div>
        <div className={styles.periods} aria-label={`${instrument.name} 차트 기간`}>
          {[[1, '1M'], [3, '3M'], [12, '1Y']].map(([months, label]) => <button type="button" key={months} aria-pressed={period === months} onClick={() => setPeriod(Number(months))}>{label}</button>)}
        </div>
      </div>
      {last !== undefined && <div className={styles.priceRow}><strong>{format(last)}</strong><span>{instrument.unit}</span>{change !== null && <b className={change >= 0 ? styles.up : styles.down}>{change >= 0 ? '+' : ''}{change.toFixed(2)}{instrument.group === '금리' ? 'bp' : '%'} <small>직전 관측 대비</small></b>}</div>}
      {loading || current?.error || !series.length ? <div className={styles.chartEmpty} role="status"><span>{loading ? '조회 중' : current?.error ? '조회 실패' : supported ? '데이터 없음' : '수집 미연결'}</span><h4>{loading ? '일봉을 불러오고 있습니다' : current?.error || (supported ? '선택한 날짜 이전의 관측값이 없습니다' : '아직 가격 공급원이 연결되지 않았습니다')}</h4>{current?.error && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}</div> : <div className={styles.chart} aria-label={`${instrument.name} 일별 관측 추이`}><IndexLineChart data={visible} wmaPeriod={1} pricePrecision={instrument.precision} /></div>}
      <div className={styles.chartFoot}><span>{instrument.kind}</span><span>{lastPoint ? `관측일 ${lastPoint.time} · ${current?.data?.sourceLabel ?? reviewSourceLabel(instrument.id)}` : '관측값 미수신'}</span></div>
      {current?.data?.dayBoundary && <p className={styles.chartFoot}>{current.data.dayBoundary}</p>}
      {lastPoint && current?.data && lastPoint.time < current.data.through && <p className={styles.chartFoot}>리뷰 전일보다 이전 관측값입니다. 휴장 또는 수집 지연 여부를 확인하세요.</p>}
    </div>
  </div>;
}
