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
  rank_amount?: number; // 거래대금 순위 추가
};

type FavItem = {
  code: string;
  group: string;
};

export default function ChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  
  const [data, setData] = useState<ChartData[]>([]);
  const [rawDailyData, setRawDailyData] = useState<ChartData[]>([]);
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

  const [minRS, setMinRS] = useState(0);
  const [indicesRS, setIndicesRS] = useState<{ kospi: number | null, kosdaq: number | null }>({ kospi: null, kosdaq: null });
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');

  const [industries, setIndustries] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [showAllThemes, setShowAllThemes] = useState(false);

  // 주봉 변환 함수
  const convertToWeekly = (dailyData: ChartData[]): ChartData[] => {
      if (dailyData.length === 0) return [];
      
      const weeklyMap = new Map<string, ChartData>();
      
      // 날짜 오름차순 정렬 (과거 -> 미래)
      const sortedDaily = [...dailyData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      sortedDaily.forEach(day => {
          const date = new Date(day.time);
          const dayOfWeek = date.getDay(); // 0(일) ~ 6(토)
          // 해당 주의 월요일 계산 (일요일이면 -6, 월~토면 1-요일)
          const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); 
          const monday = new Date(date.setDate(diff));
          const weekKey = monday.toISOString().split('T')[0];

          if (!weeklyMap.has(weekKey)) {
              weeklyMap.set(weekKey, { 
                  ...day, 
                  time: weekKey,
                  volume: 0, // 누적을 위해 0으로 초기화
                  high: -Infinity,
                  low: Infinity
              });
          }

          const weekData = weeklyMap.get(weekKey)!;
          weekData.high = Math.max(weekData.high, day.high);
          weekData.low = Math.min(weekData.low, day.low);
          weekData.close = day.close; // 마지막 날짜의 종가가 그 주의 종가
          weekData.volume += day.volume;
          
          // 첫 데이터가 시가 (이미 초기화 시 들어감, 하지만 확실히 하기 위해)
          // 정렬되어 있으므로 weekData 생성 시점의 open이 시가가 됨.
      });

      return Array.from(weeklyMap.values());
  };

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
        .from('rs_rankings_with_volume')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (!dateData) return;
      setLatestDate(dateData.date);

      // 지수 RS 조회 (KOSPI, KOSDAQ, KS11, KQ11)
      const { data: indexData } = await supabase
        .from('rs_rankings_with_volume')
        .select('code, rank_weighted')
        .eq('date', dateData.date)
        .in('code', ['KOSPI', 'KOSDAQ', 'KS11', 'KQ11']);
      
      if (indexData) {
          const kospi = indexData.find(i => i.code === 'KOSPI' || i.code === 'KS11')?.rank_weighted || null;
          const kosdaq = indexData.find(i => i.code === 'KOSDAQ' || i.code === 'KQ11')?.rank_weighted || null;
          setIndicesRS({ kospi, kosdaq });
      }

      // 뷰(View) 조회: rs_rankings_with_volume
      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE - 1;

      const { data: rankData, count: totalRowCount } = await supabase
        .from('rs_rankings_with_volume')
        .select('*', { count: 'exact' })
        .eq('date', dateData.date)
        .gte('rank_amount', 60) // 거래대금 상위 40%
        .gte('rank_weighted', minRS) // RS 지수 필터링
        .order('rank_weighted', { ascending: false })
        .order('code', { ascending: true }) // 동점자 처리: 코드순 정렬로 순서 고정
        .range(start, end);

      if (rankData && rankData.length > 0) {
        if (totalRowCount !== null) setTotalPages(Math.ceil(totalRowCount / ITEMS_PER_PAGE));

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
          rs_score: r.rank_weighted, // RS 점수를 랭킹으로 변경 (점수 -> 순위)
          close: priceMap.get(r.code) || 0,
          marcap: compMap.get(r.code)?.marcap || 0,
          is_template: null,
          rank_amount: r.rank_amount // 거래대금 순위
        }));

        setTableData(formatted);
        
        checkTrendTemplates(formatted);
      } else {
          setTableData([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTableLoading(false);
    }
  }, [supabase, currentPage, minRS]);

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
          .limit(1000);
  
        const rsPromise = supabase.from('rs_rankings_with_volume')
          .select('date, rank_weighted')
          .eq('code', code)
          .order('date', { ascending: false })
          .limit(1000);
  
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
  
        setRawDailyData(sorted);
      } catch (e) {
        console.error(e);
        setRawDailyData([]);
      } finally {
        setChartLoading(false);
      }
    }, [supabase]);
  useEffect(() => {
    fetchChartData(currentCompany.code);
    fetchIndustriesAndThemes(currentCompany.code);
    setShowAllThemes(false); // 종목 변경 시 테마 접기
  }, [currentCompany, fetchChartData]);

  const fetchIndustriesAndThemes = async (code: string) => {
    try {
      // 업종 정보 조회
      const { data: industryData } = await supabase
        .from('company_industries')
        .select('industry_id, industries(name)')
        .eq('company_code', code);

      if (industryData) {
        const industryNames = industryData
          .map((item: any) => item.industries?.name)
          .filter(Boolean);
        setIndustries(industryNames);
      } else {
        setIndustries([]);
      }

      // 테마 정보 조회
      const { data: themeData } = await supabase
        .from('company_themes')
        .select('theme_id, themes(name)')
        .eq('company_code', code);

      if (themeData) {
        const themeNames = themeData
          .map((item: any) => item.themes?.name)
          .filter(Boolean);
        setThemes(themeNames);
      } else {
        setThemes([]);
      }
    } catch (e) {
      console.error('Error fetching industries and themes:', e);
      setIndustries([]);
      setThemes([]);
    }
  };

  useEffect(() => {
      if (rawDailyData.length === 0) {
          setData([]);
          return;
      }

      let targetData = [...rawDailyData];
      if (timeframe === 'weekly') {
          targetData = convertToWeekly(targetData);
      }

      let ema, wma;
      
      ema = calculateEMA(targetData, 20); // EMA는 일봉/주봉 모두 20기간으로 유지

      if (timeframe === 'weekly') {
          wma = calculateWMA(targetData, 30);  // 주봉: WMA 30
      } else {
          wma = calculateWMA(targetData, 150); // 일봉: WMA 150
      }

      const keltner = calculateKeltner(targetData, 20, 2.25);
      const macd = calculateMACD(targetData, 3, 10, 16);

      const finalData = targetData.map((d, i) => ({
          ...d,
          ema20: ema[i],   // 차트 컴포넌트 호환성을 위해 키 이름 유지 (일봉/주봉 20)
          wma150: wma[i],  // 차트 컴포넌트 호환성을 위해 키 이름 유지 (주봉 30, 일봉 150)
          keltner: keltner[i], 
          macd: macd[i]
      }));

      setData(finalData);
  }, [rawDailyData, timeframe]);

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
                    <div className="flex items-baseline gap-2">
                        <h3 className="font-bold text-gray-700">종목발굴</h3>
                        {indicesRS.kospi !== null && (
                            <span className="text-[10px] text-gray-400 font-normal">
                                (KOSPI: <span className="font-bold">{indicesRS.kospi}</span> / KOSDAQ: <span className="font-bold">{indicesRS.kosdaq}</span>)
                            </span>
                        )}
                    </div>
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
                
                <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                        <label className="font-bold text-gray-600 flex items-center gap-1">
                            RS 지수 
                            <input 
                                type="number" 
                                min="0" 
                                max="99" 
                                value={minRS} 
                                onChange={(e) => setMinRS(Number(e.target.value))}
                                className="w-12 border rounded p-1 bg-white outline-none focus:border-blue-500 text-center"
                            />
                            이상
                        </label>
                        <span className="text-gray-400 ml-2">기준일: {latestDate}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-600">그룹:</span>
                        <select 
                            value={checkGroup} 
                            onChange={(e) => setCheckGroup(e.target.value)}
                            className="border rounded p-1 bg-white outline-none max-w-[100px]"
                        >
                            {favGroups.map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                   <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10">
                      <tr><th className="px-3 py-2">순위</th><th className="px-2 py-2">종목</th><th className="px-2 py-2 text-right">RS</th><th className="px-2 py-2 text-center">거래대금</th><th className="px-2 py-2 text-center">Templ.</th><th className="px-2 py-2 text-center">관심</th></tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100 text-xs">
                      {tableLoading ? (
                        <tr><td colSpan={6} className="p-10 text-center text-gray-400">로딩 중...</td></tr>
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
                                <td className="px-2 py-2 text-center font-medium text-gray-600">
                                   {stock.rank_amount ? <span title="50일 평균 거래대금 순위 (0~99)">{stock.rank_amount}</span> : '-'}
                                </td>
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
              <div className="p-4 border-b shrink-0">
                  <div className="flex justify-between items-start">
                      <div className="flex flex-col gap-2">
                          <div className="flex items-baseline gap-2">
                              <h2 className="text-2xl font-bold text-gray-800">{currentCompany.name}</h2>
                              <span className="text-lg text-gray-500 font-medium">({currentCompany.code})</span>
                          </div>

                          {/* 업종/테마 표시 */}
                          <div className="flex flex-wrap gap-2 text-xs">
                              {industries.length > 0 && (
                                  <div className="flex items-center gap-1">
                                      <span className="text-gray-500 font-medium">업종:</span>
                                      {industries.map((industry, idx) => (
                                          <span key={idx} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                              {industry}
                                          </span>
                                      ))}
                                  </div>
                              )}
                              {themes.length > 0 && (
                                  <div className="flex items-center gap-1">
                                      <span className="text-gray-500 font-medium">테마:</span>
                                      <div className="flex flex-wrap gap-1">
                                          {(showAllThemes ? themes : themes.slice(0, 5)).map((theme, idx) => (
                                              <span key={idx} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                                  {theme}
                                              </span>
                                          ))}
                                          {themes.length > 5 && (
                                              <button
                                                  onClick={() => setShowAllThemes(!showAllThemes)}
                                                  className="text-gray-500 hover:text-gray-700 px-1 text-xs font-medium underline"
                                                  title={showAllThemes ? '접기' : '전체 보기'}
                                              >
                                                  {showAllThemes ? '접기' : `+${themes.length - 5} 더보기`}
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              )}
                          </div>
                      </div>

                      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                          {/* 주봉/일봉 토글 */}
                          <div className="flex bg-white rounded border border-gray-200 p-[2px] mr-2">
                              <button
                                  onClick={() => setTimeframe('daily')}
                                  className={`px-2 py-0.5 text-xs font-bold rounded ${timeframe === 'daily' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                  일
                              </button>
                              <button
                                  onClick={() => setTimeframe('weekly')}
                                  className={`px-2 py-0.5 text-xs font-bold rounded ${timeframe === 'weekly' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                              >
                                  주
                              </button>
                          </div>

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