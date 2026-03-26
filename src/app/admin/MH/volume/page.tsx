'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartPortfolio from '@/components/StockChartPortfolio';
import FullscreenPanel from '@/components/FullscreenPanel';
import {
  calculateEMA,
  calculateWMA,
  calculateKeltner,
  calculateMACD
} from '@/utils/indicators';

type PortfolioStock = {
  id: string;
  code: string;
  name: string;
  subtitle?: string;
  tradeDate?: string;
  listType: 'active' | 'closed';
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rs?: number;
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

type TradeMarker = {
  time: string;
  type: 'buy' | 'sell';
};

type PortfolioMarkerRow = {
  entry_date: string | null;
  close_date: string | null;
  is_closed: boolean | null;
  is_custom_asset: boolean | null;
};

export default function PortfolioChartPage() {
  const supabase = createClientComponentClient();

  const [currentTab, setCurrentTab] = useState<'active' | 'closed'>('active');
  const [portfolio, setPortfolio] = useState<PortfolioStock[]>([]);
  const [currentStock, setCurrentStock] = useState<PortfolioStock | null>(null);

  const [rawDailyData, setRawDailyData] = useState<ChartData[]>([]);
  const [data, setData] = useState<ChartData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);

  const convertToWeekly = (dailyData: ChartData[]): ChartData[] => {
    if (dailyData.length === 0) return [];

    const weeklyMap = new Map<string, ChartData>();
    const sortedDaily = [...dailyData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    sortedDaily.forEach(day => {
      const date = new Date(day.time);
      const dayOfWeek = date.getDay();
      const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(date.setDate(diff));
      const weekKey = monday.toISOString().split('T')[0];

      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          ...day,
          time: weekKey,
          volume: 0,
          high: -Infinity,
          low: Infinity
        });
      }

      const weekData = weeklyMap.get(weekKey)!;
      weekData.high = Math.max(weekData.high, day.high);
      weekData.low = Math.min(weekData.low, day.low);
      weekData.close = day.close;
      weekData.volume += day.volume;
    });

    return Array.from(weeklyMap.values());
  };

  const fetchPortfolio = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: activePortfolioData } = await supabase
      .from('user_portfolio')
      .select('company_code, company_name, is_custom_asset, is_closed, entry_date')
      .eq('user_id', user.id)
      .eq('is_closed', false)
      .order('entry_date', { ascending: false });

    const { data: transactionData } = await supabase
      .from('user_portfolio_transactions')
      .select('portfolio_id, company_code, company_name, transaction_date')
      .eq('user_id', user.id)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });

    const { data: legacyClosedData } = await supabase
      .from('user_portfolio')
      .select('id, company_code, company_name, is_custom_asset, close_date')
      .eq('user_id', user.id)
      .eq('is_closed', true)
      .order('close_date', { ascending: false });

    const activeMap = new Map<string, PortfolioStock>();
    (activePortfolioData || [])
      .filter(p => !p.is_custom_asset)
      .forEach(p => {
        if (!activeMap.has(p.company_code)) {
          activeMap.set(p.company_code, {
            id: `active-${p.company_code}`,
            code: p.company_code,
            name: p.company_name || p.company_code,
            subtitle: '보유 종목',
            listType: 'active',
          });
        }
      });

    const loggedPortfolioIds = new Set((transactionData || []).map(t => t.portfolio_id));
    const closedList: PortfolioStock[] = [
      ...(transactionData || []).map(t => ({
        id: `closed-tx-${t.portfolio_id}-${t.transaction_date}-${t.company_code}`,
        code: t.company_code,
        name: t.company_name || t.company_code,
        subtitle: t.transaction_date ? `매도 ${t.transaction_date}` : '매도 내역',
        tradeDate: t.transaction_date || undefined,
        listType: 'closed' as const,
      })),
      ...((legacyClosedData || [])
        .filter(p => !p.is_custom_asset && !loggedPortfolioIds.has(p.id))
        .map(p => ({
          id: `closed-legacy-${p.id}`,
          code: p.company_code,
          name: p.company_name || p.company_code,
          subtitle: p.close_date ? `청산 ${p.close_date}` : '청산 내역',
          tradeDate: p.close_date || undefined,
          listType: 'closed' as const,
        }))),
    ];

    const nextPortfolio = currentTab === 'active' ? Array.from(activeMap.values()) : closedList;
    setPortfolio(nextPortfolio);
    setCurrentStock(prev => {
      if (prev && nextPortfolio.some(stock => (
        stock.id === prev.id
      ))) {
        return prev;
      }
      return nextPortfolio[0] || null;
    });
  }, [supabase, currentTab]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  const fetchChartData = useCallback(async (code: string) => {
    setChartLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const dbPromise = supabase.from('daily_prices_v2')
        .select('date, open, high, low, close, volume')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(1000);

      const rsPromise = supabase.from('rs_rankings_v2')
        .select('date, score_weighted')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(1000);

      const portfolioPromise = user
        ? supabase
            .from('user_portfolio')
            .select('entry_date, close_date, is_closed, is_custom_asset')
            .eq('user_id', user.id)
            .eq('company_code', code)
            .eq('is_custom_asset', false)
        : Promise.resolve({ data: [] as PortfolioMarkerRow[] });

      const transactionPromise = user
        ? supabase
            .from('user_portfolio_transactions')
            .select('transaction_date')
            .eq('user_id', user.id)
            .eq('company_code', code)
        : Promise.resolve({ data: [] as { transaction_date: string | null }[] });

      const [dbRes, rsRes, portfolioRes, transactionRes] = await Promise.all([dbPromise, rsPromise, portfolioPromise, transactionPromise]);

      const dataMap = new Map<string, ChartData>();

      dbRes.data?.forEach(row => {
        if (!row.date) return;
        let o = Number(row.open);
        let h = Number(row.high);
        let l = Number(row.low);
        const c = Number(row.close);

        if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }

        dataMap.set(row.date, {
          time: row.date,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: Number(row.volume),
          rs: undefined
        });
      });

      rsRes.data?.forEach(row => {
        if (!row.date) return;
        const existing = dataMap.get(row.date);
        if (existing) {
          dataMap.set(row.date, { ...existing, rs: Number(row.score_weighted) });
        }
      });

      const sorted = Array.from(dataMap.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      setRawDailyData(sorted);

      const markers: TradeMarker[] = [];
      if (portfolioRes.data && portfolioRes.data.length > 0) {
        portfolioRes.data.forEach(p => {
          if (p.entry_date) {
            markers.push({ time: p.entry_date, type: 'buy' });
          }
          if (p.is_closed && p.close_date) {
            markers.push({ time: p.close_date, type: 'sell' });
          }
        });
      }
      if (transactionRes.data && transactionRes.data.length > 0) {
        transactionRes.data.forEach(t => {
          if (t.transaction_date) {
            markers.push({ time: t.transaction_date, type: 'sell' });
          }
        });
      }
      const uniq = new Map<string, TradeMarker>();
      markers.forEach(m => uniq.set(`${m.time}|${m.type}`, m));
      setTradeMarkers(Array.from(uniq.values()));
    } catch (e) {
      console.error(e);
      setRawDailyData([]);
      setTradeMarkers([]);
    } finally {
      setChartLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!currentStock) return;
    fetchChartData(currentStock.code);
  }, [currentStock, fetchChartData]);

  useEffect(() => {
    if (rawDailyData.length === 0) {
      setData([]);
      return;
    }

    let targetData = [...rawDailyData];
    if (timeframe === 'weekly') {
      targetData = convertToWeekly(targetData);
    }

    const ema = calculateEMA(targetData, 20);
    const wma = timeframe === 'weekly'
      ? calculateWMA(targetData, 30)
      : calculateWMA(targetData, 150);
    const keltner = calculateKeltner(targetData, 20, 2.25);
    const macd = calculateMACD(targetData, 3, 10, 16);

    const finalData = targetData.map((d, i) => ({
      ...d,
      ema20: ema[i],
      wma150: wma[i],
      keltner: keltner[i],
      macd: macd[i]
    }));

    setData(finalData);
  }, [rawDailyData, timeframe]);

  return (
    <div className="flex h-full gap-4">
      <aside className="app-card-strong flex h-full w-72 flex-col overflow-hidden">
        <div className="border-b border-[var(--border)] p-4">
          <h2 className="text-base font-semibold text-slate-900">거래 리스트</h2>
          <div className="mt-3 flex rounded-2xl bg-[var(--surface-muted)] p-1">
            <button
              className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                currentTab === 'active' ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-800'
              }`}
              onClick={() => setCurrentTab('active')}
            >
              보유 종목
            </button>
            <button
              className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                currentTab === 'closed' ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-800'
              }`}
              onClick={() => setCurrentTab('closed')}
            >
              청산 매매
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {portfolio.length === 0 ? (
            <div className="p-4 text-sm text-[var(--text-muted)]">
              {currentTab === 'active' ? '보유 종목이 없습니다.' : '청산 매매 내역이 없습니다.'}
            </div>
          ) : (
            <ul className="p-2 space-y-1">
              {portfolio.map(stock => {
                const active =
                  currentStock?.id === stock.id;
                return (
                  <li key={stock.id}>
                    <button
                      className={`w-full rounded-2xl px-3 py-2 text-left text-sm transition ${active ? 'bg-[var(--surface-accent)] text-[var(--primary-strong)]' : 'text-gray-800 hover:bg-[var(--surface-muted)]'}`}
                      onClick={() => setCurrentStock(stock)}
                    >
                      <div className="font-semibold">{stock.name}</div>
                      <div className={`text-xs ${active ? 'text-[var(--primary)]' : 'text-[var(--text-subtle)]'}`}>
                        {stock.code}
                        {stock.subtitle ? ` · ${stock.subtitle}` : ''}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="app-card-strong flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--text-muted)]">선택 종목</div>
            <div className="font-semibold text-slate-950">
              {currentStock ? `${currentStock.name} (${currentStock.code})` : '종목을 선택하세요'}
            </div>
            {currentStock?.subtitle && (
              <div className="mt-1 text-xs text-[var(--text-muted)]">{currentStock.subtitle}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-2xl border px-3 py-1.5 text-sm ${timeframe === 'daily' ? 'border-slate-950 bg-slate-950 text-white' : 'border-[var(--border)] bg-white text-gray-700'}`}
              onClick={() => setTimeframe('daily')}
            >
              일봉
            </button>
            <button
              className={`rounded-2xl border px-3 py-1.5 text-sm ${timeframe === 'weekly' ? 'border-slate-950 bg-slate-950 text-white' : 'border-[var(--border)] bg-white text-gray-700'}`}
              onClick={() => setTimeframe('weekly')}
            >
              주봉
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 p-3">
          <FullscreenPanel className="bg-[var(--surface-muted)]">
            {chartLoading ? (
              <div className="flex h-full items-center justify-center text-[var(--text-muted)]">차트 로딩 중...</div>
            ) : data.length > 0 ? (
              <StockChartPortfolio data={data} trades={tradeMarkers} />
            ) : (
              <div className="flex h-full items-center justify-center text-[var(--text-subtle)]">차트 데이터가 없습니다.</div>
            )}
          </FullscreenPanel>
        </div>
      </section>
    </div>
  );
}
