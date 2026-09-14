'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@/lib/supabase-browser';

type FinancialRow = {
  year: number;
  quarter: number;
  reprt_code: string;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
};

type PriceRow = { date: string; close: number | null };
const UNIT = 1_000_000;

function amount(value: number | null) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(Number(value) / UNIT).toLocaleString()}억`;
}

function normalizedQuarterlyRows(rows: FinancialRow[]) {
  const byPeriod = new Map(rows.map((row) => [`${row.year}-${row.quarter}`, row]));
  return rows.map((row) => {
    if (row.quarter !== 4) return row;
    const earlier = [1, 2, 3].map((quarter) => byPeriod.get(`${row.year}-${quarter}`));
    const subtract = (key: 'revenue' | 'operating_income' | 'net_income') => {
      if (row[key] === null || earlier.some((item) => item?.[key] === null || item === undefined)) return null;
      return Number(row[key]) - earlier.reduce((sum, item) => sum + Number(item?.[key]), 0);
    };
    return { ...row, revenue: subtract('revenue'), operating_income: subtract('operating_income'), net_income: subtract('net_income') };
  });
}

function FinancialTable({ title, rows, period }: { title: string; rows: FinancialRow[]; period: (row: FinancialRow) => string }) {
  return <section className="wiki-stock-table"><h3>{title}</h3><div className="wiki-table-wrap"><table><thead><tr><th>기간</th><th>매출</th><th>영업이익</th><th>당기순이익</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.year}-${row.quarter}`}><td>{period(row)}</td><td>{amount(row.revenue)}</td><td>{amount(row.operating_income)}</td><td>{amount(row.net_income)}</td></tr>)}</tbody></table></div></section>;
}

export function WikiFinancialPanel({ tickerCode }: { tickerCode: string }) {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [rows, setRows] = useState<FinancialRow[] | null>(null);

  useEffect(() => { let active = true; (async () => {
    const { data, error } = await supabase.from('company_financials_v2')
      .select('year,quarter,reprt_code,revenue,operating_income,net_income')
      .eq('company_code', tickerCode).order('year', { ascending: false }).order('quarter', { ascending: false });
    if (active) setRows(error ? [] : (data as FinancialRow[] ?? []));
  })(); return () => { active = false; }; }, [supabase, tickerCode]);

  const annual = useMemo(() => (rows ?? []).filter((row) => row.reprt_code === '11011' || row.quarter === 4).slice(0, 5), [rows]);
  const quarterly = useMemo(() => normalizedQuarterlyRows(rows ?? []).slice(0, 8), [rows]);
  if (rows === null) return <div className="wiki-stock-panel wiki-stock-loading">실적을 불러오는 중…</div>;
  if (!rows.length) return <div className="wiki-stock-panel wiki-stock-empty">등록된 실적 데이터가 없습니다.</div>;
  return <div className="wiki-stock-panel wiki-financial-panel"><p className="wiki-stock-caption">단위: 억원 · DART 공시 기준</p><div className="wiki-stock-grid"><FinancialTable title="연간" rows={annual} period={(row) => `${row.year}`} /><FinancialTable title="분기" rows={quarterly} period={(row) => `${row.year} Q${row.quarter}`} /></div></div>;
}

export function WikiPriceChart({ tickerCode }: { tickerCode: string }) {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  useEffect(() => { let active = true; (async () => {
    const { data, error } = await supabase.from('daily_prices_v2').select('date,close')
      .eq('code', tickerCode).order('date', { ascending: false }).limit(70);
    if (active) setPrices(error ? [] : ((data as PriceRow[] ?? []).reverse()));
  })(); return () => { active = false; }; }, [supabase, tickerCode]);

  const chart = useMemo(() => {
    const values = (prices ?? []).map((row) => Number(row.close)).filter((value) => Number.isFinite(value));
    if (values.length < 2) return null;
    const low = Math.min(...values); const high = Math.max(...values); const range = high - low || 1;
    const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${96 - ((value - low) / range) * 92}`).join(' ');
    return { low, high, points, first: prices?.[0]?.date, last: prices?.[prices.length - 1]?.date };
  }, [prices]);
  if (prices === null) return <div className="wiki-stock-panel wiki-stock-loading">차트를 불러오는 중…</div>;
  if (!chart) return <div className="wiki-stock-panel wiki-stock-empty">최근 3개월 일봉 데이터가 없습니다.</div>;
  return <figure className="wiki-stock-panel wiki-price-chart"><figcaption><span>최근 3개월 일봉 종가</span><small>{chart.first} ~ {chart.last}</small></figcaption><div className="wiki-price-scale"><span>{chart.high.toLocaleString()}</span><span>{chart.low.toLocaleString()}</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="최근 3개월 종가 추이"><line x1="0" y1="4" x2="100" y2="4" /><line x1="0" y1="50" x2="100" y2="50" /><line x1="0" y1="96" x2="100" y2="96" /><polyline points={chart.points} /></svg></figure>;
}
