'use client';

import { useState, useEffect, useCallback } from 'react';
import StockChart from '@/components/StockChart';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { 
  calculateEMA, 
  calculateWMA, 
  calculateKeltner, 
  calculateMACD 
} from '@/utils/indicators';

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

export default function MarketIndexPage() {
  const supabase = createClientComponentClient();

  const [kospiData, setKospiData] = useState<ChartData[]>([]);
  const [kosdaqData, setKosdaqData] = useState<ChartData[]>([]);
  
  // Store raw daily data to avoid refetching
  const [rawKospi, setRawKospi] = useState<ChartData[]>([]);
  const [rawKosdaq, setRawKosdaq] = useState<ChartData[]>([]);

  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');

  // 주봉 변환 함수 (기존 로직 재사용)
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

  const processData = (rawData: ChartData[], tf: 'daily' | 'weekly'): ChartData[] => {
    if (rawData.length === 0) return [];

    let ema, wma;
    
    // EMA는 일봉/주봉 모두 20기간
    ema = calculateEMA(rawData, 20); 

    if (tf === 'weekly') {
        wma = calculateWMA(rawData, 30);  // 주봉: WMA 30
    } else {
        wma = calculateWMA(rawData, 150); // 일봉: WMA 150
    }

    const keltner = calculateKeltner(rawData, 20, 2.25);
    const macd = calculateMACD(rawData, 3, 10, 16);

    return rawData.map((d, i) => ({
        ...d,
        ema20: ema[i],
        wma150: wma[i],
        keltner: keltner[i], 
        macd: macd[i]
    }));
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const codes = ['KOSPI', 'KOSDAQ'];
      
      const { data: priceData } = await supabase
        .from('daily_prices_v2')
        .select('code, date, open, high, low, close, volume')
        .in('code', codes)
        .order('date', { ascending: false })
        .limit(2000);

      if (!priceData) return;

      const { data: rsData } = await supabase
        .from('rs_rankings_with_volume')
        .select('code, date, rank_weighted')
        .in('code', codes)
        .order('date', { ascending: false })
        .limit(2000);

      const processIndexData = (targetCode: string) => {
        const targetPrices = priceData.filter(p => p.code === targetCode);
        const targetRs = rsData?.filter(r => r.code === targetCode) || [];

        const dataMap = new Map();

        targetPrices.forEach(row => {
          if (!row.date) return;
          let o = Number(row.open);
          let h = Number(row.high);
          let l = Number(row.low);
          const c = Number(row.close);

          if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }

          dataMap.set(row.date, {
            time: row.date,
            open: o, high: h, low: l, close: c, volume: Number(row.volume),
            rs: undefined
          });
        });

        targetRs.forEach(row => {
          if (!row.date) return;
          const existing = dataMap.get(row.date);
          if (existing) {
            dataMap.set(row.date, { ...existing, rs: row.rank_weighted });
          }
        });

        const sorted = Array.from(dataMap.values()).sort((a: any, b: any) => 
          new Date(a.time).getTime() - new Date(b.time).getTime()
        );
        
        return sorted;
      };

      const k = processIndexData('KOSPI');
      const kq = processIndexData('KOSDAQ');

      setRawKospi(k);
      setRawKosdaq(kq);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Process data when raw data or timeframe changes
  useEffect(() => {
    if (rawKospi.length > 0) {
      const finalKospi = processData(
        timeframe === 'weekly' ? convertToWeekly(rawKospi) : rawKospi, 
        timeframe
      );
      setKospiData(finalKospi);
    }
    if (rawKosdaq.length > 0) {
      const finalKosdaq = processData(
        timeframe === 'weekly' ? convertToWeekly(rawKosdaq) : rawKosdaq, 
        timeframe
      );
      setKosdaqData(finalKosdaq);
    }
  }, [timeframe, rawKospi, rawKosdaq]);

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b p-4 flex justify-between items-center shrink-0">
        <h1 className="text-2xl font-bold text-gray-800">시장 지수 (KOSPI / KOSDAQ)</h1>
        <div className="flex bg-white rounded border border-gray-200 p-[2px]">
            <button 
                onClick={() => setTimeframe('daily')}
                className={`px-3 py-1 text-sm font-bold rounded ${timeframe === 'daily' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
                일봉
            </button>
            <button 
                onClick={() => setTimeframe('weekly')}
                className={`px-3 py-1 text-sm font-bold rounded ${timeframe === 'weekly' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
                주봉
            </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* KOSPI Chart */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-3 border-b bg-gray-50">
            <h2 className="font-bold text-lg text-gray-700">KOSPI</h2>
          </div>
          <div className="flex-1 relative w-full h-full min-h-0 bg-white">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">로딩 중...</div>
            ) : kospiData.length > 0 ? (
              <StockChart 
                data={kospiData} 
                showOHLC={true} 
                showIndicatorsValues={false} 
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 없음</div>
            )}
          </div>
        </div>

        {/* KOSDAQ Chart */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-3 border-b bg-gray-50">
            <h2 className="font-bold text-lg text-gray-700">KOSDAQ</h2>
          </div>
          <div className="flex-1 relative w-full h-full min-h-0 bg-white">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">로딩 중...</div>
            ) : kosdaqData.length > 0 ? (
              <StockChart 
                data={kosdaqData} 
                showOHLC={true} 
                showIndicatorsValues={false}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 없음</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}