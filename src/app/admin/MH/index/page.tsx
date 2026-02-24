'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LivermoreStateChart from '@/components/LivermoreStateChart';
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
  const [reversalMult, setReversalMult] = useState(4);
  const [confirmMult, setConfirmMult] = useState(2);

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

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-gray-900">
              {(meta?.code ?? code.trim().toUpperCase()) || 'KOSPI'} Livermore Price Record
            </h1>
            <div className={`rounded px-3 py-1 text-sm font-semibold ${STATE_BADGE_STYLE[currentState]}`}>
              Current: {STATE_LABELS[currentState]}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="relative">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
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
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              {suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
                  {suggestions.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setQuery(`${item.name} (${item.code})`);
                        setCode(item.code.toUpperCase());
                        setSuggestions([]);
                      }}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="truncate text-gray-800">{item.name}</span>
                      <span className="ml-2 font-mono text-xs text-gray-500">{item.code}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs text-gray-500">
                selected code: <span className="font-mono">{code.trim().toUpperCase() || '-'}</span>
                {searching ? ' | searching...' : ''}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm text-gray-700">
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

            <label className="flex flex-col gap-1 text-sm text-gray-700">
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

            <label className="flex flex-col gap-1 text-sm text-gray-700">
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

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={fetchData}
              className="rounded bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Recalculate'}
            </button>
            {meta && (
              <div className="text-xs text-gray-500">
                code: {meta.code} | {meta.startDate} ~ {meta.endDate} | rows: {meta.rowCount} | timestamp date rows:{' '}
                {meta.hasTimestampRows ? 'yes' : 'no'} | missing high/low: {meta.missingHighLowCount}
              </div>
            )}
          </div>

          {error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <LivermoreStateChart rows={rows} />
          <div className="mt-2 text-xs text-gray-500">
            Background: Uptrend(green), Downtrend(red), Natural(gray), Secondary(yellow), Insufficient(gray).
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Latest State Changes</h2>
          <div className="max-h-80 overflow-auto border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600">
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
                    <tr key={`${row.date}-${row.state}`} className="border-t border-gray-100">
                      <td className="px-2 py-1.5 font-mono text-xs">{row.date}</td>
                      <td className="px-2 py-1.5">{STATE_LABELS[row.state]}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-600">{row.reason}</td>
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
