'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LivermoreStateChart from '@/components/LivermoreStateChart';
import FullscreenPanel from '@/components/FullscreenPanel';
import type { LivermoreComputedRow, ExtendedLivermoreState } from '@/lib/livermoreStateMachine';

type CompanySearchRow = {
  code: string;
  name: string;
};

type ApiResponse = {
  meta: {
    code: string;
    startDate: string;
    endDate: string;
    rowCount: number;
    hasTimestampRows: boolean;
    missingHighLowCount: number;
    reversalMultiplier: number;
    confirmMultiplier: number;
  };
  rows: LivermoreComputedRow[];
};

const STATE_LABELS: Record<ExtendedLivermoreState, string> = {
  upward_trend: '상승추세',
  downward_trend: '하락추세',
  natural_rally: '통상반등',
  natural_reaction: '통상조정',
  secondary_rally: '부차반등',
  secondary_reaction: '부차조정',
  insufficient_data: '데이터부족',
};

const STATE_BADGE_STYLE: Record<ExtendedLivermoreState, string> = {
  upward_trend: 'bg-green-100 text-green-800',
  downward_trend: 'bg-red-100 text-red-800',
  natural_rally: 'bg-gray-100 text-gray-800',
  natural_reaction: 'bg-gray-100 text-gray-800',
  secondary_rally: 'bg-amber-100 text-amber-800',
  secondary_reaction: 'bg-amber-100 text-amber-800',
  insufficient_data: 'bg-slate-100 text-slate-700',
};

export default function MhIndexPage() {
  const [code, setCode] = useState('KOSPI');
  const [query, setQuery] = useState('KOSPI');
  const [suggestions, setSuggestions] = useState<CompanySearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [years, setYears] = useState(3);
  const [reversalMult, setReversalMult] = useState(3);
  const [confirmMult, setConfirmMult] = useState(1.5);

  const [rows, setRows] = useState<LivermoreComputedRow[]>([]);
  const [meta, setMeta] = useState<ApiResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        code: code.trim().toUpperCase(),
        years: String(years),
        reversalMult: String(reversalMult),
        confirmMult: String(confirmMult),
      });

      const res = await fetch(`/api/livermore/kospi?${params.toString()}`);
      const payload = (await res.json()) as ApiResponse | { error: string };

      if (!res.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Request failed');
      }

      setRows(payload.rows);
      setMeta(payload.meta);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [code, years, reversalMult, confirmMult]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q, limit: '12' });
        const res = await fetch(`/api/companies/search?${params.toString()}`);
        const payload = (await res.json()) as { rows?: CompanySearchRow[]; error?: string };
        if (!res.ok || payload.error) {
          throw new Error(payload.error ?? 'Search failed');
        }
        setSuggestions(payload.rows ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const transitions = useMemo(() => rows.filter((row) => row.state_changed), [rows]);
  const currentState = rows.length ? rows[rows.length - 1].state : 'insufficient_data';
  const latestTransition = transitions.length ? transitions[transitions.length - 1] : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="app-card-strong p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-950">
                {(meta?.code ?? code.trim().toUpperCase()) || 'KOSPI'} Livermore Price Record
              </h1>
              <div className={`rounded-full px-3 py-1 text-sm font-semibold ${STATE_BADGE_STYLE[currentState]}`}>
                {STATE_LABELS[currentState]}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
              <span>{meta ? `${meta.startDate} ~ ${meta.endDate}` : '데이터 로딩 중'}</span>
              <span>rows {meta?.rowCount ?? 0}</span>
              <span>전환 {transitions.length}</span>
              {latestTransition && <span>최근 전환 {latestTransition.date}</span>}
              {searching && <span>searching...</span>}
            </div>
          </div>

          <button
            type="button"
            onClick={fetchData}
            className="rounded-2xl bg-slate-950 px-4 py-2 text-sm text-white hover:bg-slate-800"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Recalculate'}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,1.2fr)_repeat(3,minmax(180px,1fr))]">
          <div className="relative">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              Name / Code
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (/^[A-Za-z0-9]+$/.test(e.target.value.trim())) {
                    setCode(e.target.value.trim().toUpperCase());
                  }
                }}
                placeholder="삼성전자, KOSPI, 005930"
                className="app-input px-3 py-2 text-sm"
              />
            </label>
            {suggestions.length > 0 && (
              <div className="absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-md)]">
                {suggestions.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setQuery(`${item.name} (${item.code})`);
                      setCode(item.code.toUpperCase());
                      setSuggestions([]);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                  >
                    <span className="truncate text-gray-800">{item.name}</span>
                    <span className="ml-2 font-mono text-xs text-gray-500">{item.code}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              selected code: <span className="font-mono">{code.trim().toUpperCase() || '-'}</span>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Years ({years})
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700">
            반전 배수 ({reversalMult.toFixed(1)}x ATR20)
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={reversalMult}
              onChange={(e) => setReversalMult(Number(e.target.value))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700">
            확정 배수 ({confirmMult.toFixed(1)}x ATR20)
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={confirmMult}
              onChange={(e) => setConfirmMult(Number(e.target.value))}
            />
          </label>
        </div>

        {error && <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(420px,1fr)]">
        <div className="app-card-strong min-h-0 p-3">
          <FullscreenPanel>
            <LivermoreStateChart rows={rows} />
          </FullscreenPanel>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Background: Uptrend(green), Downtrend(red), Natural(gray), Secondary(yellow), Insufficient(gray).
          </div>
        </div>

        <div className="app-card-strong min-h-0 overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Latest State Changes</h2>
            {meta && (
              <span className="text-xs text-[var(--text-muted)]">
                missing H/L {meta.missingHighLowCount}
              </span>
            )}
          </div>
          <div className="h-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[var(--surface-muted)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">State</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Close</th>
                  <th className="px-2 py-2">ATR20</th>
                  <th className="px-2 py-2">반전 임계값</th>
                  <th className="px-2 py-2">확정 임계값</th>
                </tr>
              </thead>
              <tbody>
                {transitions
                  .slice()
                  .reverse()
                  .slice(0, 80)
                  .map((row) => (
                    <tr key={`${row.date}-${row.state}`} className="border-t border-[var(--border)]">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{row.date}</td>
                      <td className="px-2 py-1.5">{STATE_LABELS[row.state]}</td>
                      <td className="px-2 py-1.5 text-xs text-[var(--text-muted)]">{row.reason}</td>
                      <td className="px-2 py-1.5">{row.close.toLocaleString()}</td>
                      <td className="px-2 py-1.5">{row.atr20?.toFixed(2) ?? '-'}</td>
                      <td className="px-2 py-1.5">{row.reversal_threshold_value?.toFixed(2) ?? '-'}</td>
                      <td className="px-2 py-1.5">{row.confirm_threshold_value?.toFixed(2) ?? '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
