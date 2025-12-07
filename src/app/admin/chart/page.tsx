'use client';

import { useState, useEffect, useCallback } from 'react';
import StockChart from '@/components/StockChart';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { 
  calculateEMA, 
  calculateWMA, 
  calculateKeltner, 
  calculateMACD 
} from '@/utils/indicators';

type Company = {
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

type TableStock = {
  code: string;
  name: string;
  rank: number; // RS 순위
  rs_score: number;
  close: number;
  marcap: number;
  is_template?: boolean | null; // null: 로딩중, true: 충족, false: 미충족
};

// [신규] 즐겨찾기 아이템 타입
type FavItem = {
  code: string;
  group: string;
};

export default function ChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  
  // --- 차트 상태 ---
  const [data, setData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [chartLoading, setChartLoading] = useState(false);

  // --- 테이블 상태 ---
  const [tableData, setTableData] = useState<TableStock[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;
  const [totalPages, setTotalPages] = useState(1);
  const [latestDate, setLatestDate] = useState('');

  // --- 즐겨찾기 상태 ---
  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');

  // [신규] 유저 프로필 및 즐겨찾기 가져오기
  useEffect(() => {
    const getUserAndFavs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // 즐겨찾기 전체 로드
        const { data: favData } = await supabase
            .from('user_favorite_stocks')
            .select('company_code, group_name')
            .eq('user_id', session.user.id);
        
        if (favData) {
            const loadedFavs = favData.map(f => ({ code: f.company_code, group: f.group_name || '기본 그룹' }));
            setFavorites(loadedFavs);
            
            // 그룹 목록 추출
            const groups = Array.from(new Set(loadedFavs.map(f => f.group)));
            if (!groups.includes('기본 그룹')) groups.unshift('기본 그룹');
            setFavGroups(groups.sort());
        }
      }
    };
    getUserAndFavs();
  }, [supabase]);

  // [신규] 즐겨찾기 토글 (선택된 그룹 기준)
  const toggleFavorite = async () => {
      if (!currentCompany) return; // 선택된 종목이 없으면 아무것도 하지 않음
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('로그인이 필요합니다.'); return; }

      const isFav = favorites.some(f => f.code === currentCompany.code && f.group === targetGroup);

      if (isFav) {
          // 삭제
          const { error } = await supabase
              .from('user_favorite_stocks')
              .delete()
              .eq('user_id', user.id)
              .eq('company_code', currentCompany.code)
              .eq('group_name', targetGroup);
          if (!error) {
              setFavorites(prev => prev.filter(f => !(f.code === currentCompany.code && f.group === targetGroup)));
          }
      } else {
          // 추가
          const { error } = await supabase
              .from('user_favorite_stocks')
              .insert({
                  user_id: user.id,
                  company_code: currentCompany.code,
                  company_name: currentCompany.name,
                  group_name: targetGroup
              });
          if (!error) {
              setFavorites(prev => [...prev, { code: currentCompany.code, group: targetGroup }]);
              // 만약 새로운 그룹이면 그룹 목록에도 추가 (UI 즉시 반영)
              if (!favGroups.includes(targetGroup)) setFavGroups(prev => [...prev, targetGroup].sort());
          }
      }
  };

  // 1. 초기 데이터 로드 (랭킹 리스트)
  const fetchRankings = useCallback(async () => {
    setTableLoading(true);
    try {
      // 최신 날짜 확인
      const { data: dateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (!dateData) return;
      setLatestDate(dateData.date);

      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE - 1;

      const { data: rankData, count } = await supabase
        .from('rs_rankings_v2')
        .select('*', { count: 'exact' })
        .eq('date', dateData.date)
        .order('rank_weighted', { ascending: false })
        .range(start, end);

      if (rankData && rankData.length > 0) {
        if (count) setTotalPages(Math.ceil(count / ITEMS_PER_PAGE));

        const codes = rankData.map(r => r.code);

        const { data: compData } = await supabase
          .from('companies')
          .select('code, name, marcap')
          .in('code', codes);
        
        const compMap = new Map();
        compData?.forEach(c => compMap.set(c.code, c));

        const { data: priceData } = await supabase
            .from('daily_prices_v2')
            .select('code, close')
            .eq('date', dateData.date)
            .in('code', codes);
        
        const priceMap = new Map();
        priceData?.forEach(p => priceMap.set(p.code, p.close));

        const formatted: TableStock[] = rankData.map(r => ({
          code: r.code,
          name: compMap.get(r.code)?.name || r.code,
          rank: r.rank_weighted, 
          rs_score: r.rank_weighted, 
          close: priceMap.get(r.code) || 0,
          marcap: compMap.get(r.code)?.marcap || 0,
          is_template: null 
        }));

        setTableData(formatted);
        
        checkTrendTemplates(formatted);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTableLoading(false);
    }
  }, [supabase, currentPage]);

  // 2. 트렌드 템플릿 검사 (클라이언트 사이드 계산)
  const checkTrendTemplates = async (stocks: TableStock[]) => {
    const results = await Promise.all(stocks.map(async (stock) => {
        try {
            const { data: prices } = await supabase
                .from('daily_prices_v2')
                .select('close')
                .eq('code', stock.code)
                .order('date', { ascending: false })
                .limit(265); 

            if (!prices || prices.length < 200) return { code: stock.code, result: false };

            const closes = prices.map(p => p.close);
            const current = closes[0];

            const sma = (arr: number[], period: number) => {
                if (arr.length < period) return null;
                const slice = arr.slice(0, period);
                return slice.reduce((a, b) => a + b, 0) / period;
            };

            const ma50 = sma(closes, 50);
            const ma150 = sma(closes, 150);
            const ma200 = sma(closes, 200);
            
            const ma200_prev_slice = closes.slice(20, 220);
            const ma200_prev = ma200_prev_slice.length === 200 
                ? ma200_prev_slice.reduce((a, b) => a + b, 0) / 200 
                : null;

            if (!ma50 || !ma150 || !ma200 || !ma200_prev) return { code: stock.code, result: false };

            const year_slice = closes.slice(0, 260);
            const high_52 = Math.max(...year_slice);
            const low_52 = Math.min(...year_slice);

            const c1 = current > ma150 && current > ma200;
            const c2 = ma150 > ma200;
            const c3 = ma200 > ma200_prev;
            const c4 = ma50 > ma150 && ma50 > ma200;
            const c5 = current > ma50;
            const c6 = current >= (low_52 * 1.30);
            const c7 = current >= (high_52 * 0.75);
            const c8 = stock.rs_score >= 70;

            const isMet = c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8;
            
            return { code: stock.code, result: isMet };

        } catch (e) {
            return { code: stock.code, result: false };
        }
    }));

    setTableData(prev => prev.map(item => {
        const res = results.find(r => r.code === item.code);
        return res ? { ...item, is_template: res.result } : item;
    }));
  };

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  // 3. 차트 데이터 로드 (최근 1년치 이상)
  const fetchChartData = useCallback(async (code: string) => {
    setChartLoading(true);
    try {
      const jsonPromise = supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
      
      // 차트 줌 기능을 위해 더 많은 데이터 로드 (400일)
      // StockChart 내부에서 초기 250일만 보여줌
      const dbPromise = supabase.from('daily_prices_v2')
        .select('date, open, high, low, close, volume')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(400); 

      const [jsonRes, dbRes] = await Promise.all([jsonPromise, dbPromise]);
      
      let chartData: any[] = [];
      if (jsonRes.data) {
        chartData = JSON.parse(await jsonRes.data.text());
      }

      const dataMap = new Map();
      chartData.forEach(d => { if(d.time) dataMap.set(d.time, d); });

      dbRes.data?.forEach(row => {
        if (!row.date) return;
        const existing = dataMap.get(row.date) || { time: row.date };
        dataMap.set(row.date, { 
            ...existing, 
            open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume)
        });
      });

      const sorted = Array.from(dataMap.values()).sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const ema20 = calculateEMA(sorted, 20);
      const wma150 = calculateWMA(sorted, 150);
      const keltner = calculateKeltner(sorted, 20, 2.25);
      const macd = calculateMACD(sorted, 3, 10, 16);

      const finalData = sorted.map((d, i) => ({
          ...d,
          ema20: ema20[i], wma150: wma150[i], keltner: keltner[i], macd: macd[i]
      }));

      setData(finalData);
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setChartLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchChartData(currentCompany.code);
  }, [currentCompany, fetchChartData]);

  const handleStockClick = (stock: TableStock) => {
    setCurrentCompany({ name: stock.name, code: stock.code });
  };

  // 현재 종목이 활성화된 그룹에 즐겨찾기 되어있는지 확인
  const isFavorite = currentCompany
    ? favorites.some(f => f.code === currentCompany.code && f.group === targetGroup) 
    : false;


  return (
    <div className="h-full bg-gray-50 flex flex-col">
       {/* 상단바 제거됨 */}

       <main className="flex-1 p-4 flex gap-4 overflow-hidden">
          {/* [좌측] 종목 리스트 테이블 (35%) */}
          <div className="w-[35%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
             <div className="p-3 border-b bg-gray-50 flex justify-between items-center">
                <h3 className="font-bold text-gray-700">RS 랭킹 TOP 2000</h3>
                <div className="flex gap-1 text-xs">
                   <button disabled={currentPage===1} onClick={()=>setCurrentPage(p=>p-1)} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">◀</button>
                   <span className="px-2 py-1">{currentPage} / {totalPages}</span>
                   <button disabled={currentPage===totalPages} onClick={()=>setCurrentPage(p=>p+1)} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">▶</button>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                   <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10">
                      <tr>
                         <th className="px-3 py-2">순위</th>
                         <th className="px-2 py-2">종목</th>
                         <th className="px-2 py-2 text-right">RS</th>
                         <th className="px-2 py-2 text-center" title="Minervini Trend Template">Template</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100 text-xs">
                      {tableLoading ? (
                        <tr><td colSpan={4} className="p-10 text-center text-gray-400">로딩 중...</td></tr>
                      ) : tableData.map((stock, idx) => (
                         <tr 
                            key={stock.code} 
                            onClick={() => handleStockClick(stock)}
                            className={`cursor-pointer hover:bg-blue-50 transition-colors ${currentCompany.code === stock.code ? 'bg-blue-100' : ''}`}
                         >
                            <td className="px-3 py-2 text-gray-500">{(currentPage-1)*ITEMS_PER_PAGE + idx + 1}</td>
                            <td className="px-2 py-2">
                               <div className="font-bold text-gray-800">{stock.name}</div>
                               <div className="text-[9px] text-gray-400">{stock.code}</div>
                            </td>
                            <td className="px-2 py-2 text-right font-bold text-blue-600">{stock.rs_score}</td>
                            <td className="px-2 py-2 text-center text-base">
                               {stock.is_template === null ? (
                                 <span className="text-gray-300 animate-pulse">●</span>
                               ) : stock.is_template ? (
                                 <span className="text-green-500">✅</span>
                               ) : (
                                 <span className="text-gray-200">‐</span>
                               )}
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>

          {/* [우측] 차트 영역 (70%) */}
          <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden relative">
              <div className="p-4 border-b flex justify-between items-baseline shrink-0">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-2xl font-bold text-gray-800">{currentCompany.name}</h2>
                    <span className="text-lg text-gray-500 font-medium">({currentCompany.code})</span>
                    
                    {/* [신규] 즐겨찾기 그룹 선택 드롭다운 + 별 버튼 */}
                    <div className="flex items-center gap-1 ml-2 bg-gray-100 rounded-lg p-1">
                        <select 
                            value={targetGroup} 
                            onChange={(e) => setTargetGroup(e.target.value)}
                            className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer px-1"
                        >
                            {favGroups.map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                        <button 
                            onClick={toggleFavorite}
                            className={`text-xl focus:outline-none transition-transform hover:scale-110 px-1 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                            title={`'${targetGroup}'에 ${isFavorite ? '삭제' : '추가'}`}
                        >
                            {isFavorite ? '⭐' : '☆'}
                        </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">기준일: {latestDate}</div>
              </div>

              <div className="flex-1 relative w-full h-full min-h-0 bg-white">
                  {chartLoading ? (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400">차트 로딩 중...</div>
                  ) : data.length > 0 ? (
                      <StockChart data={data} />
                  ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터가 없습니다</div>
                  )}
              </div>
          </div>
       </main>
    </div>
  );
}