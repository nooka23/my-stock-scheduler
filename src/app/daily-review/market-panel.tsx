'use client';

import { Fragment, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { type ReviewInstrument } from '@/lib/daily-review-demo';
import { reviewMarketCodes, type MarketHistory } from '@/lib/daily-review-market';
import { marketChanges, signed } from '@/lib/daily-review-table';
import styles from './review.module.css';

const Chart = dynamic(() => import('@/components/IndexLineChart'), { ssr: false, loading: () => <div className={styles.chartLoading}>차트 준비 중…</div> });
type Result = { data?: MarketHistory; error?: string };

export default function MarketPanel({ instruments, date }: { instruments: ReviewInstrument[]; date: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState(12);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; items: Record<string, Result> }>({ key: '', items: {} });
  const ids = instruments.map(item => item.id).join(',');
  const key = `${date}:${ids}:${retry}`;
  const results = state.key === key ? state.items : {};

  useEffect(() => {
    const controller = new AbortController();
    const queue = ids.split(',');
    // Bound concurrent requests so other review sections stay responsive.
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        let result: Result;
        try {
          if (!reviewMarketCodes[id]) throw new Error('수집 미연결');
          const response = await fetch(`/api/daily-review/market?instrument=${encodeURIComponent(id)}&date=${date}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '시장 데이터 조회 실패');
          result = { data };
        } catch (error) { result = { error: error instanceof Error ? error.message : '조회 실패' }; }
        if (!controller.signal.aborted) setState(previous => ({ key, items: { ...(previous.key === key ? previous.items : {}), [id]: result } }));
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
  }, [date, ids, key]);

  const groups = [...new Set(instruments.map(item => item.group))];
  const rateOrder = ['us1y', 'us2y', 'us10y', 'us30y', 'kr1y', 'kr3y', 'kr5y', 'kr10y', 'kr20y', 'kr30y', 'fedfunds', 'discount', 'prime'];
  return <div className={styles.tablePanel}>
    <div className={styles.tableIntro}><span>MARKET SNAPSHOT</span><p>행을 눌러 차트 보기 <span aria-hidden="true">↘</span></p></div>
    <div className={styles.tableScroll} tabIndex={0} aria-label="시장지표 비교 표">
      <table className={styles.dataTable}>
        <caption className={styles.srOnly}>시장지표별 현재값과 1일·1주·1달 변화</caption>
        <thead><tr><th scope="col">지표 / 현재값</th><th scope="col">1일</th><th scope="col">1주</th><th scope="col">1달</th></tr></thead>
        {groups.map(group => <tbody key={group}>
          {groups.length > 1 && <tr className={styles.tableGroup}><th colSpan={4} scope="rowgroup">{group}<span>{group === '금리' ? '금리 변화 · bp' : '가격 변화 · %'}</span></th></tr>}
          {instruments.filter(item => item.group === group).sort((a, b) => group === '금리' ? rateOrder.indexOf(a.id) - rateOrder.indexOf(b.id) : 0).map(item => {
            const result = results[item.id];
            const data = result?.data;
            const rows = data?.rows ?? [];
            const last = rows.at(-1);
            const changes = marketChanges(rows, item.group === '금리');
            const expanded = selected === item.id;
            const panelId = `market-chart-${item.id}`;
            const cutoff = new Date(`${date}T00:00:00Z`); cutoff.setUTCMonth(cutoff.getUTCMonth() - period);
            const visible = rows.filter(point => point.time > cutoff.toISOString().slice(0, 10));
            return <Fragment key={item.id}>
              <tr className={expanded ? styles.expandedRow : ''} onClick={() => setSelected(expanded ? null : item.id)}>
                <th scope="row"><button type="button" className={styles.rowToggle} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onClick={event => { event.stopPropagation(); setSelected(expanded ? null : item.id); }}>
                  <span className={styles.rowName}>{item.name}<span aria-hidden="true">{expanded ? '−' : '+'}</span></span>
                  <span className={styles.rowValue}>{last ? last.value.toLocaleString('en-US', { minimumFractionDigits: item.precision, maximumFractionDigits: item.precision }) : result?.error ? '조회 실패' : result ? '저장값 없음' : '조회 중'}{last && <small>{item.unit}</small>}</span>
                  <span className={styles.rowMeta}>{last ? `관측 ${last.time}` : '—'}{last && data && last.time < data.through ? ' · 전일 미확인' : ''}</span>
                </button></th>
                {changes.map((value, index) => <td key={index} className={value === null || value === 0 ? styles.neutral : value > 0 ? styles.up : styles.down}>{signed(value, item.group === '금리' ? 'bp' : '%')}</td>)}
              </tr>
              {expanded && <tr className={styles.chartRow}><td colSpan={4}><div id={panelId} className={styles.inlineChart}>
                <div className={styles.chartHeader}><div><p className={styles.eyebrow}>{item.symbol} · {data?.sourceLabel ?? '공급원 확인 중'}</p><h3>{item.name}</h3></div><div className={styles.periods} aria-label={`${item.name} 차트 기간`}>{[[1, '1M'], [3, '3M'], [12, '1Y']].map(([months, label]) => <button type="button" key={months} aria-pressed={period === months} onClick={() => setPeriod(Number(months))}>{label}</button>)}</div></div>
                {last ? <div className={styles.chart}><Chart data={visible} wmaPeriod={1} pricePrecision={item.precision} /></div> : <div className={styles.chartEmpty} role="status"><p>{result?.error ?? (result ? '선택한 날짜 이전의 관측값이 없습니다.' : '조회 중입니다.')}</p>{result?.error && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}</div>}
                <p className={styles.tableNote}>{item.kind} · {data?.dayBoundary}</p><p className={styles.tableNote}>{data?.freshness}</p>
              </div></td></tr>}
            </Fragment>;
          })}
        </tbody>)}
      </table>
    </div>
    <p className={styles.tableNote}>1일은 직전 관측, 1주·1달은 표시된 관측일의 7일·1개월 전 대비입니다. 휴장일은 그 이전 관측을 사용하며 이력이 부족하면 —로 표시합니다. 금리는 bp 변화이며 채권 가격 수익률이 아닙니다.</p>
  </div>;
}
