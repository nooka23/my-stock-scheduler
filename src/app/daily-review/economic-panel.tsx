'use client';

import { Fragment, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { sortEconomic, signed, type Observation } from '@/lib/daily-review-table';
import styles from './review.module.css';

const Chart = dynamic(() => import('@/components/IndexLineChart'), { ssr: false });
type Item = { code: string; name: string; group: string; frequency: string; unit: string; transform: string; source?: string; source_url: string; detected_at: string | null; last_checked_at: string | null; last_error: string | null; rows: Observation[] };
type Change = { series_code: string; observation_date: string; old_value: number | null; new_value: number; kind: string; detected_at: string };
type Data = { items: Item[]; changes: Change[] };
const frequencies: Record<string, string> = { daily: '일간', weekly: '주간', monthly: '월간', quarterly: '분기' };
const format = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const koreanTime = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export default function EconomicPanel({ date }: { date: string }) {
  const [result, setResult] = useState<{ key: string; data?: Data; error?: string } | null>(null);
  const [group, setGroup] = useState('전체');
  const [selected, setSelected] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${date}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/daily-review/economy?date=${date}&view=indicators`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '경제지표 조회 실패');
      return data as Data;
    }).then(data => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [date, key]);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  if (!data) return <div className={styles.empty} role="status"><p>{current?.error ?? '경제지표를 불러오는 중입니다.'}</p>{current?.error && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}</div>;
  const items = sortEconomic(data.items);
  const list = items.filter(item => group === '전체' || item.group === group);
  const changes = data.changes.filter(change => items.some(item => item.code === change.series_code));
  return <div className={styles.tablePanel}>
    <div className={styles.tableIntro}><span>ECONOMIC RELEASES</span><p>최근 신규 감지순 <span aria-hidden="true">↓</span></p></div>
    <div className={styles.filters} aria-label="경제지표 분류">{['전체', ...new Set(items.map(item => item.group))].map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</button>)}</div>
    <p className={styles.tableNote}>채권·금리는 시장지표에서 확인합니다. 실제 발표 시각은 미제공으로 신규 값 감지 시각순이며, 초기 저장분은 관측 기간순입니다. 감지일과 발표일은 다를 수 있습니다.</p>
    <div className={styles.tableScroll} tabIndex={0} aria-label="경제지표 최근 값 비교 표"><table className={`${styles.dataTable} ${styles.economyTable}`}>
      <caption className={styles.srOnly}>최근 신규 값이 확인된 경제지표와 이전 관측 비교</caption>
      <thead><tr><th scope="col">지표 / 관측 기간</th><th scope="col">최근 값</th><th scope="col">이전 값</th><th scope="col">신규 감지</th></tr></thead>
      <tbody>{list.map(item => {
        const latest = item.rows.at(-1), previous = item.rows.at(-2);
        const expanded = selected === item.code;
        const panelId = `economy-chart-${item.code}`;
        const pct = latest && previous && previous.value > 0 ? (latest.value / previous.value - 1) * 100 : null;
        let yoy: number | null = null;
        if (latest) {
          const year = new Date(`${latest.time}T00:00:00Z`); year.setUTCFullYear(year.getUTCFullYear() - 1);
          const prior = item.rows.find(row => row.time === year.toISOString().slice(0, 10));
          if (prior && prior.value > 0) yoy = (latest.value / prior.value - 1) * 100;
        }
        return <Fragment key={item.code}>
          <tr className={expanded ? styles.expandedRow : ''} onClick={() => setSelected(expanded ? null : item.code)}>
            <th scope="row"><button type="button" className={styles.rowToggle} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onClick={event => { event.stopPropagation(); setSelected(expanded ? null : item.code); }}><span className={styles.rowName}>{item.name}<span aria-hidden="true">{expanded ? '−' : '+'}</span></span><span className={styles.rowMeta}>{latest?.time ?? '저장값 없음'} · {frequencies[item.frequency]}</span></button></th>
            <td><strong>{latest ? format(latest.value) : '—'}</strong><small className={styles.cellMeta}>{item.unit}</small>{item.last_error && <small className={styles.cellMeta}>수집 오류</small>}</td>
            <td>{previous ? format(previous.value) : '—'}<small className={styles.cellMeta}>{previous?.time ?? ''}</small></td>
            <td>{item.detected_at ? koreanTime(item.detected_at) : '—'}<small className={styles.cellMeta}>{item.detected_at ? '한국시간' : '초기 저장'}</small></td>
          </tr>
          {expanded && <tr className={styles.chartRow}><td colSpan={4}><div id={panelId} className={styles.inlineChart}>
            <div className={styles.chartHeader}><div><p className={styles.eyebrow}>{item.code} · {item.source === 'ISM_PRNEWSWIRE' ? 'ISM · 공식 발표' : item.source ?? 'FRED'}</p><h3>{item.name}</h3></div><a href={item.source_url} target="_blank" rel="noreferrer">원자료 ↗</a></div>
            {latest ? <>
              <div className={styles.priceRow}><strong>{format(latest.value)}</strong><span>{item.unit}</span></div>
              <p className={styles.tableNote}>{item.transform === 'diffusion' && previous ? `직전 관측 대비 ${signed(latest.value - previous.value, 'pt')} · 50 초과 확장 / 50 미만 위축` : item.unit === '%' && previous ? `직전 관측 대비 ${signed(latest.value - previous.value, '%p')}` : item.frequency === 'monthly' && pct !== null ? `MoM ${signed(pct)}${yoy !== null ? ` · YoY ${signed(yoy)}` : ''}` : ''}{item.transform === 'gdp' && previous && previous.value > 0 ? ` · 전분기 대비 연율 ${signed(((latest.value / previous.value) ** 4 - 1) * 100)}` : ''}{item.code === 'PAYEMS' && previous ? ` · 전월 대비 ${format(latest.value - previous.value)}천 명` : ''}</p>
              <div className={styles.chart}><Chart data={item.rows} wmaPeriod={1} pricePrecision={3} /></div>
            </> : <div className={styles.empty}>저장된 관측값이 없습니다.</div>}
            <p className={styles.tableNote}>{item.last_error ? '최근 수집 실패 · 이전 저장값 표시' : `마지막 수집 확인 ${item.last_checked_at ? koreanTime(item.last_checked_at) : '미수집'}`} · 차트에는 현재 저장된 수정값이 반영됩니다.</p>
          </div></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>
    {!list.length && <p className={styles.empty}>해당 분류에 저장된 경제지표가 없습니다.</p>}
    {changes.length > 0 && <details className={styles.changeLog}><summary>{date} 신규·수정 감지 {changes.length}건</summary>{changes.map((change, index) => <p key={index}>{items.find(item => item.code === change.series_code)?.name ?? change.series_code} · {change.observation_date} · {change.kind === 'revision' ? '수정' : '신규'}: {change.old_value === null ? '—' : format(Number(change.old_value))} → {format(Number(change.new_value))}</p>)}</details>}
  </div>;
}
