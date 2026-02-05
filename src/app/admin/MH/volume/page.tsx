'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartPortfolio from '@/components/StockChartPortfolio';
import {
  calculateEMA,
  calculateWMA,
  calculateKeltner,
  calculateMACD
} from '@/utils/indicators';

type PortfolioStock = {
  code: string;
  name: string;
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

export default function PortfolioChartPage() {
  const supabase = createClientComponentClient();

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

    const { data: portfolioData } = await supabase
      .from('user_portfolio')
      .select('company_code, company_name, is_custom_asset, is_closed, entry_date')
      .eq('user_id', user.id)
      .eq('is_closed', false)
      .order('entry_date', { ascending: false });

    if (!portfolioData || portfolioData.length === 0) {
      setPortfolio([]);
      setCurrentStock(null);
      return;
    }

    const map = new Map<string, PortfolioStock>();
    portfolioData
      .filter(p => !p.is_custom_asset)
      .forEach(p => {
        if (!map.has(p.company_code)) {
          map.set(p.company_code, { code: p.company_code, name: p.company_name || p.company_code });
        }
      });

    const list = Array.from(map.values());
    setPortfolio(list);
    if (!currentStock && list.length > 0) {
      setCurrentStock(list[0]);
    }
  }, [supabase, currentStock]);

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
        : Promise.resolve({ data: [] as any[] });

      const [dbRes, rsRes, portfolioRes] = await Promise.all([dbPromise, rsPromise, portfolioPromise]);

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
    <div className="h-full bg-gray-50 flex">
      <aside className="w-72 bg-white border-r h-full flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-bold text-sm text-gray-800">보유 종목</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {portfolio.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">보유 종목이 없습니다.</div>
          ) : (
            <ul className="p-2 space-y-1">
              {portfolio.map(stock => {
                const active = currentStock?.code === stock.code;
                return (
                  <li key={stock.code}>
                    <button
                      className={`w-full text-left px-3 py-2 rounded text-sm transition ${active ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-800'}`}
                      onClick={() => setCurrentStock(stock)}
                    >
                      <div className="font-semibold">{stock.name}</div>
                      <div className={`text-xs ${active ? 'text-blue-100' : 'text-gray-400'}`}>{stock.code}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex-1 flex flex-col">
        <div className="flex items-center justify-between bg-white p-4 border-b">
          <div>
            <div className="text-sm text-gray-500">선택 종목</div>
            <div className="font-bold text-gray-900">
              {currentStock ? `${currentStock.name} (${currentStock.code})` : '종목을 선택하세요'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1.5 rounded text-sm border ${timeframe === 'daily' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
              onClick={() => setTimeframe('daily')}
            >
              일봉
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm border ${timeframe === 'weekly' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
              onClick={() => setTimeframe('weekly')}
            >
              주봉
            </button>
          </div>
        </div>

        <div className="flex-1 p-4">
          <div className="h-full bg-white border rounded shadow-sm">
            {chartLoading ? (
              <div className="h-full flex items-center justify-center text-gray-500">차트 로딩 중...</div>
            ) : data.length > 0 ? (
              <StockChartPortfolio data={data} trades={tradeMarkers} />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">차트 데이터가 없습니다.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
