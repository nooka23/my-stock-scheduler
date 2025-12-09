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
  rank: number; 
  rs_score: number;
  close: number;
  marcap: number;
  is_template?: boolean | null; 
};

type FavItem = {
  code: string;
  group: string;
};

export default function ChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  
  const [data, setData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [chartLoading, setChartLoading] = useState(false);

  const [tableData, setTableData] = useState<TableStock[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('1');
  const ITEMS_PER_PAGE = 20;
  const [totalPages, setTotalPages] = useState(1);
  const [latestDate, setLatestDate] = useState('');

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [inputCompany, setInputCompany] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');
  const [checkGroup, setCheckGroup] = useState<string>('기본 그룹');

  useEffect(() => {
    const getUserAndFavs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: favData } = await supabase
            .from('user_favorite_stocks')
            .select('company_code, group_name')
            .eq('user_id', session.user.id);
        
        if (favData) {
            const loadedFavs = favData.map(f => ({ code: f.company_code, group: f.group_name || '기본 그룹' }));
            setFavorites(loadedFavs);
            
            const groups = Array.from(new Set(loadedFavs.map(f => f.group)));
            if (!groups.includes('기본 그룹')) groups.unshift('기본 그룹');
            setFavGroups(groups.sort());
        }
      }
    };
    getUserAndFavs();
  }, [supabase]);

  useEffect(() => {
      setInputPage(currentPage.toString());
  }, [currentPage]);

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputPage(e.target.value);
  };
  const handlePageSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          const p = parseInt(inputPage);
          if (!isNaN(p) && p >= 1 && p <= totalPages) {
              setCurrentPage(p);
          } else {
              setInputPage(currentPage.toString());
          }
      }
  };

  const fetchRankingsAndCompanies = useCallback(async () => {
    setTableLoading(true);
    try {
      const { data: allCompanies } = await supabase.from('companies').select('code, name').range(0, 9999);
      if(allCompanies) setCompanyList(allCompanies);

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
    fetchRankingsAndCompanies();
  }, [fetchRankingsAndCompanies]);

    const fetchChartData = useCallback(async (code: string) => {
      setChartLoading(true);
      try {
        const dbPromise = supabase.from('daily_prices_v2')
          .select('date, open, high, low, close, volume')
          .eq('code', code)
          .order('date', { ascending: false })
          .limit(400);
  
        const rsPromise = supabase.from('rs_rankings_v2')
          .select('date, rank_weighted')
          .eq('code', code)
          .order('date', { ascending: false })
          .limit(400);
  
        const [dbRes, rsRes] = await Promise.all([dbPromise, rsPromise]);
        
        const dataMap = new Map();
        
        dbRes.data?.forEach(row => {
          if (!row.date) return;
          let o = Number(row.open);
          let h = Number(row.high);
          let l = Number(row.low);
          const c = Number(row.close);
  
          // 거래정지 데이터 보정
          if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }
          
          dataMap.set(row.date, { 
              time: row.date,
              open: o, high: h, low: l, close: c, volume: Number(row.volume),
              rs: undefined // RS는 rsRes에서 가져올 것
          });
        });
  
        rsRes.data?.forEach(row => {
            if (!row.date) return;
            const existing = dataMap.get(row.date);
            if (existing) {
                dataMap.set(row.date, { ...existing, rs: row.rank_weighted });
            }
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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; 
    setInputCompany(val);
    if (val.trim()) { 
        const filtered = companyList.filter(c => c.name.includes(val) || c.code.includes(val));
        setFilteredCompanies(filtered); 
        setShowDropdown(true); 
    } else { 
        setShowDropdown(false); 
    }
  };
  const selectCompany = (c: Company) => { 
      setCurrentCompany(c); 
      setInputCompany(c.name); 
      setShowDropdown(false); 
  };

  const toggleFavorite = async () => {
      if (!currentCompany) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('로그인이 필요합니다.'); return; }

      const isFav = favorites.some(f => f.code === currentCompany.code && f.group === targetGroup);

      if (isFav) {
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
              if (!favGroups.includes(targetGroup)) setFavGroups(prev => [...prev, targetGroup].sort());
          }
      }
  };

  const isFavorite = currentCompany
    ? favorites.some(f => f.code === currentCompany.code && f.group === targetGroup) 
    : false;


  return (
    <div className="h-full bg-gray-50 flex flex-col">
       <div className="flex justify-between items-center bg-white p-4 shadow-sm border-b shrink-0 z-20 relative">
           <div className="flex items-center gap-6">
               <h1 className="text-2xl font-bold text-blue-800">📊 차트 분석 (Admin)</h1>
               <div className="relative w-72">
                    <input 
                        type="text" 
                        className="w-full border p-2 rounded font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                        value={inputCompany} 
                        onChange={handleSearchChange} 
                        onFocus={() => inputCompany && setShowDropdown(true)}
                        placeholder="종목명 또는 코드 검색..." 
                    />
                    {showDropdown && filteredCompanies.length > 0 && (
                        <ul className="absolute z-30 w-full bg-white border mt-1 rounded max-h-60 overflow-y-auto shadow-xl">
                            {filteredCompanies.map(c => (
                                <li key={c.code} onClick={() => selectCompany(c)} className="p-2 hover:bg-gray-100 cursor-pointer text-sm flex justify-between border-b last:border-none">
                                    <span className="font-bold text-gray-700">{c.name}</span>
                                    <span className="text-gray-400 text-xs bg-gray-100 px-2 py-1 rounded">{c.code}</span>
                                </li>
                            ))}
                        </ul>
                    )}
               </div>
           </div>
           <div className="text-sm text-gray-500">기준일: {latestDate}</div>
       </div>

       <main className="flex-1 p-4 flex gap-4 overflow-hidden">
          <div className="w-[35%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
             <div className="p-3 border-b bg-gray-50 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-gray-700">RS 랭킹 TOP 2000</h3>
                    <div className="flex gap-1 text-xs items-center">
                       <button disabled={currentPage===1} onClick={()=>setCurrentPage(p=>p-1)} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">◀</button>
                       <input 
                          type="text" 
                          value={inputPage} 
                          onChange={handlePageInput} 
                          onKeyDown={handlePageSubmit}
                          className="w-10 text-center border rounded p-1 outline-none focus:border-blue-500"
                       />
                       <span className="text-gray-500">/ {totalPages}</span>
                       <button disabled={currentPage===totalPages} onClick={()=>setCurrentPage(p=>p+1)} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">▶</button>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-gray-600">확인할 그룹:</span>
                    <select 
                        value={checkGroup} 
                        onChange={(e) => setCheckGroup(e.target.value)}
                        className="border rounded p-1 bg-white outline-none"
                    >
                        {favGroups.map(g => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                   <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10">
                      <tr><th className="px-3 py-2">순위</th><th className="px-2 py-2">종목</th><th className="px-2 py-2 text-right">RS</th><th className="px-2 py-2 text-center">Templ.</th><th className="px-2 py-2 text-center">관심</th></tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100 text-xs">
                      {tableLoading ? (
                        <tr><td colSpan={5} className="p-10 text-center text-gray-400">로딩 중...</td></tr>
                      ) : tableData.map((stock, idx) => {
                         const isIncluded = favorites.some(f => f.code === stock.code && f.group === checkGroup);
                         return (
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
                                <td className="px-2 py-2 text-center text-base">
                                    {isIncluded ? <span className="text-yellow-400">⭐</span> : <span className="text-gray-200">☆</span>}
                                </td>
                             </tr>
                         );
                      })}
                   </tbody>
                </table>
             </div>
          </div>

          <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden relative">
              <div className="p-4 border-b flex justify-between items-baseline shrink-0">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-2xl font-bold text-gray-800">{currentCompany.name}</h2>
                    <span className="text-lg text-gray-500 font-medium">({currentCompany.code})</span>
                    
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