'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartDiscovery from '@/components/StockChartDiscovery';

type DailyPrice = {
  date_str: string;
  code: string;
  close: number;
  rs_rating: number;
  rank_3m?: number;
  rank_6m?: number;
  rank_12m?: number;
  marcap?: number;
  companies: {
    name: string;
  } | null; 
  rs_diff?: number;
  prev_rs?: number;
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rs?: number;
};

type FavItem = {
  code: string;
  group: string;
};

export default function DiscoveryPage() {
  const supabase = createClientComponentClient();
  
  const [currentTab, setCurrentTab] = useState<'TOP' | 'RISING'>('TOP');
  const [risingPeriod, setRisingPeriod] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');

  const [excludeHighRise, setExcludeHighRise] = useState(false); 
  const [minRs50, setMinRs50] = useState(false);

  const [allRankedStocks, setAllRankedStocks] = useState<DailyPrice[]>([]);
  const [displayedStocks, setDisplayedStocks] = useState<DailyPrice[]>([]);
  
  const [selectedStock, setSelectedStock] = useState<{code: string, name: string} | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('1');
  const ITEMS_PER_PAGE = 20;

  const [referenceDate, setReferenceDate] = useState<string>(''); 
  const [comparisonDate, setComparisonDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');

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

  const toggleFavorite = async () => {
      if (!selectedStock) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { alert('로그인이 필요합니다.'); return; }

      const isFav = favorites.some(f => f.code === selectedStock.code && f.group === targetGroup);

      if (isFav) {
          const { error } = await supabase
              .from('user_favorite_stocks')
              .delete()
              .eq('user_id', user.id)
              .eq('company_code', selectedStock.code)
              .eq('group_name', targetGroup);
          if (!error) {
              setFavorites(prev => prev.filter(f => !(f.code === selectedStock.code && f.group === targetGroup)));
          }
      } else {
          const { error } = await supabase
              .from('user_favorite_stocks')
              .insert({
                  user_id: user.id,
                  company_code: selectedStock.code,
                  company_name: selectedStock.name,
                  group_name: targetGroup
              });
          if (!error) {
              setFavorites(prev => [...prev, { code: selectedStock.code, group: targetGroup }]);
              if (!favGroups.includes(targetGroup)) setFavGroups(prev => [...prev, targetGroup].sort());
          }
      }
  };

  const mapCompanyNames = async (stocks: any[]) => {
    const codes = stocks.map((s: any) => s.code);
    let companyInfoMap = new Map();
    const chunkSize = 1000;
    
    for (let i = 0; i < codes.length; i += chunkSize) {
        const chunk = codes.slice(i, i + chunkSize);
        const { data: companiesData } = await supabase
        .from('companies')
        .select('code, name, marcap')
        .in('code', chunk);

        if (companiesData) {
            companiesData.forEach((c: any) => {
                companyInfoMap.set(c.code, { name: c.name, marcap: c.marcap });
            });
        }
    }
    
    return stocks.map((stock: any) => {
        const info = companyInfoMap.get(stock.code) || { name: '알 수 없음', marcap: 0 };
        return {
            ...stock,
            marcap: info.marcap,
            companies: { name: info.name }
        };
    });
  };

  const fetchRankedStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: dateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();
      
      if (!dateData) throw new Error('랭킹 데이터가 없습니다.');
      const latestDate = dateData.date;
      setReferenceDate(latestDate);
      setComparisonDate(''); 

      const { data: rankData, error: rankError } = await supabase
        .from('rs_rankings_v2')
        .select('*') 
        .eq('date', latestDate)
        .order('rank_weighted', { ascending: false });

      if (rankError) throw rankError;

      if (rankData && rankData.length > 0) {
        const codes = rankData.map((r: any) => r.code);
        const { data: priceData } = await supabase
            .from('daily_prices_v2')
            .select('code, close')
            .eq('date', latestDate)
            .in('code', codes);
            
        const priceMap = new Map();
        priceData?.forEach((p: any) => priceMap.set(p.code, p.close));

        const mergedData = rankData.map((r: any) => ({
            date_str: r.date,
            code: r.code,
            rs_rating: r.rank_weighted,
            rank_3m: r.rank_3m,
            rank_6m: r.rank_6m,
            rank_12m: r.rank_12m,
            close: priceMap.get(r.code) || 0,
            companies: null 
        }));

        const combinedData = await mapCompanyNames(mergedData);
        setAllRankedStocks(combinedData as DailyPrice[]);
      } else {
        setAllRankedStocks([]);
      }
    } catch (err: any) {
      console.error("TOP 로딩 실패:", err.message);
      setError('데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchRisingStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: dateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();
      
      if (!dateData) throw new Error('랭킹 데이터가 없습니다.');
      const latestDate = dateData.date;
      setReferenceDate(latestDate);

      const daysAgo = risingPeriod === 'WEEKLY' ? 5 : 20;
      
      const { data: pastDateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .lt('date', latestDate)
        .eq('code', '005930') 
        .order('date', { ascending: false })
        .range(daysAgo - 1, daysAgo - 1)
        .limit(1)
        .maybeSingle();

      if (!pastDateData) throw new Error('비교할 과거 데이터가 부족합니다.');
      const pastDate = pastDateData.date;
      setComparisonDate(pastDate);

      const { data: currData } = await supabase
        .from('rs_rankings_v2')
        .select('code, rank_weighted')
        .eq('date', latestDate);

      const { data: pastData } = await supabase
        .from('rs_rankings_v2')
        .select('code, rank_weighted')
        .eq('date', pastDate);

      if (!currData || !pastData) throw new Error('랭킹 조회 실패');

      const pastMap = new Map();
      pastData.forEach((p: any) => pastMap.set(p.code, p.rank_weighted));

      let risingList: any[] = [];
      const codes: string[] = [];

      currData.forEach((curr: any) => {
          const prevRank = pastMap.get(curr.code);
          if (prevRank !== undefined && prevRank !== null) {
              const diff = curr.rank_weighted - prevRank;
              if (diff > 0) { 
                  risingList.push({
                      date_str: latestDate,
                      code: curr.code,
                      rs_rating: curr.rank_weighted,
                      prev_rs: prevRank,
                      rs_diff: diff,
                      companies: null
                  });
                  codes.push(curr.code);
              }
          }
      });

      if (codes.length > 0) {
          risingList.sort((a: any, b: any) => b.rs_diff - a.rs_diff);
          
          const topRising = risingList.slice(0, 200);
          const topCodes = topRising.map((r: any) => r.code);

          const { data: priceData } = await supabase
            .from('daily_prices_v2')
            .select('code, close')
            .eq('date', latestDate)
            .in('code', topCodes);
            
          const priceMap = new Map();
          priceData?.forEach((p: any) => priceMap.set(p.code, p.close));
          
          topRising.forEach((r: any) => {
              r.close = priceMap.get(r.code) || 0;
          });

          const combinedData = await mapCompanyNames(topRising);
          setAllRankedStocks(combinedData as DailyPrice[]);
      } else {
          setAllRankedStocks([]);
      }

    } catch (err: any) {
      console.error("RISING 로딩 실패:", err.message);
      setError('급상승 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase, risingPeriod]);

  const fetchChartData = async (code: string) => {
    setIsChartLoading(true);
    try {
        const jsonPromise = supabase.storage
            .from('stocks')
            .download(`${code}.json?t=${Date.now()}`);

        const dbPromise = supabase
            .from('daily_prices_v2')
            .select('date, open, high, low, close, volume')
            .eq('code', code)
            .order('date', { ascending: false })
            .limit(100);

        const rsPromise = supabase
            .from('rs_rankings_v2')
            .select('date, rank_weighted')
            .eq('code', code)
            .order('date', { ascending: false })
            .limit(100);

        const [jsonResult, dbResult, rsResult] = await Promise.all([jsonPromise, dbPromise, rsPromise]);

        let resultData: any[] = [];

        if (jsonResult.data) {
            const textData = await jsonResult.data.text();
            resultData = JSON.parse(textData);
        }

        const dataMap = new Map();
        
        resultData.forEach(item => {
            if (item.time) {
                let o = Number(item.open);
                let h = Number(item.high);
                let l = Number(item.low);
                const c = Number(item.close);
                if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; } 

                dataMap.set(item.time, {
                    ...item,
                    open: o, high: h, low: l, close: c,
                    volume: Number(item.volume),
                    rs: item.rs !== null ? Number(item.rs) : undefined
                });
            }
        });

        if (dbResult.data) {
            dbResult.data.forEach(row => {
                const time = row.date;
                if (!time) return;
                const existing = dataMap.get(time) || {};
                
                let o = Number(row.open);
                let h = Number(row.high);
                let l = Number(row.low);
                const c = Number(row.close);
                if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }

                dataMap.set(time, {
                    ...existing, time,
                    open: o, high: h, low: l, close: c,
                    volume: Number(row.volume)
                });
            });
        }

        if (rsResult.data) {
            rsResult.data.forEach(row => {
                const time = row.date;
                if (!time) return;
                const existing = dataMap.get(time);
                if (existing) {
                    existing.rs = row.rank_weighted;
                    dataMap.set(time, existing);
                }
            });
        }

        const sortedData = Array.from(dataMap.values()).sort((a: any, b: any) => 
            new Date(a.time).getTime() - new Date(b.time).getTime()
        );

        setChartData(sortedData);

    } catch (e) {
        console.error("Chart fetch error:", e);
        setChartData([]);
    } finally {
        setIsChartLoading(false);
    }
  };

  const handleStockClick = (stock: DailyPrice) => {
      setSelectedStock({ 
          code: stock.code, 
          name: stock.companies?.name || '알 수 없음' 
      });
      fetchChartData(stock.code);
  };

  useEffect(() => { setCurrentPage(1); setInputPage('1'); }, [currentTab, risingPeriod, excludeHighRise, minRs50]);
  useEffect(() => {
    let filtered = allRankedStocks;
    if (minRs50) filtered = filtered.filter(s => (s.rs_rating || 0) >= 50);
    if (excludeHighRise && currentTab === 'RISING') filtered = filtered.filter(s => (s.rs_diff || 0) < 90);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedStocks(filtered.slice(startIndex, endIndex));
    setInputPage(currentPage.toString());
  }, [allRankedStocks, currentPage, excludeHighRise, minRs50, currentTab]);

  useEffect(() => {
    if (currentTab === 'TOP') fetchRankedStocks();
    else fetchRisingStocks();
  }, [currentTab, risingPeriod, fetchRankedStocks, fetchRisingStocks]);

  const getFilteredCount = () => {
      let filtered = allRankedStocks;
      if (minRs50) filtered = filtered.filter(s => (s.rs_rating || 0) >= 50);
      if (excludeHighRise && currentTab === 'RISING') filtered = filtered.filter(s => (s.rs_diff || 0) < 90);
      return filtered.length;
  };
  const totalPages = Math.ceil(getFilteredCount() / ITEMS_PER_PAGE);
  const handlePageChange = (n: number) => { if (n >= 1 && n <= totalPages) setCurrentPage(n); };
  const handleInputPageChange = (e: any) => setInputPage(e.target.value);
  const submitPageInput = () => { const n = parseInt(inputPage); if (!isNaN(n) && n >= 1 && n <= totalPages) setCurrentPage(n); else setInputPage(currentPage.toString()); };
  const handleKeyDown = (e: any) => { if (e.key === 'Enter') submitPageInput(); };

  const isFavorite = selectedStock 
    ? favorites.some(f => f.code === selectedStock.code && f.group === targetGroup) 
    : false;

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header removed - now using Sidebar */}
      
      {/* 메인 컨텐츠 (좌우 분할) */}
      <main className="flex-1 p-4 flex gap-4 overflow-hidden">
        
        {/* [왼쪽] 종목 테이블 영역 (너비 30%) */}
        <div className="w-[30%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
            {/* 컨트롤 패널 (탭 & 필터) */}
            <div className="p-4 border-b bg-gray-50">
                <div className="flex justify-between items-end mb-3">
                    <div className="flex gap-1">
                        <button onClick={() => setCurrentTab('TOP')} className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${currentTab === 'TOP' ? 'bg-blue-600 text-white shadow' : 'bg-white border text-gray-500'}`}>TOP</button>
                        <button onClick={() => setCurrentTab('RISING')} className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${currentTab === 'RISING' ? 'bg-red-500 text-white shadow' : 'bg-white border text-gray-500'}`}>급상승</button>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                        {currentTab === 'RISING' && (
                            <label className="flex items-center gap-1 text-[10px] font-bold text-gray-600 cursor-pointer"><input type="checkbox" checked={excludeHighRise} onChange={(e) => setExcludeHighRise(e.target.checked)} className="accent-red-500"/> 90점↑ 제외</label>
                        )}
                        <label className="flex items-center gap-1 text-[10px] font-bold text-gray-600 cursor-pointer"><input type="checkbox" checked={minRs50} onChange={(e) => setMinRs50(e.target.checked)} className="accent-blue-500"/> RS 50↑</label>
                    </div>
                </div>
                
                {currentTab === 'RISING' && (
                    <div className="flex gap-2 mb-2">
                        <button onClick={() => setRisingPeriod('WEEKLY')} className={`text-[10px] px-2 py-1 rounded border font-bold ${risingPeriod === 'WEEKLY' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-white text-gray-500'}`}>📅 주간</button>
                        <button onClick={() => setRisingPeriod('MONTHLY')} className={`text-[10px] px-2 py-1 rounded border font-bold ${risingPeriod === 'MONTHLY' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-white text-gray-500'}`}>🗓️ 월간</button>
                    </div>
                )}
                
                <div className="text-[10px] text-gray-500 flex justify-between">
                    <span>기준: {referenceDate}</span>
                    <span>총 {getFilteredCount()}개</span>
                </div>
            </div>

            {/* 테이블 */}
            <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-2 py-2 font-medium">순위</th>
                            <th className="px-2 py-2 font-medium">종목명</th>
                            {currentTab === 'TOP' ? (
                                <th className="px-2 py-2 font-medium text-right">RS</th>
                            ) : (
                                <th className="px-2 py-2 font-medium text-right">변화</th>
                            )}
                            <th className="px-2 py-2 font-medium text-right">시총(억)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs">
                        {!loading && displayedStocks.map((stock, idx) => (
                            <tr 
                                key={stock.code} 
                                onClick={() => handleStockClick(stock)}
                                className={`cursor-pointer hover:bg-blue-50 transition-colors ${selectedStock?.code === stock.code ? 'bg-blue-100' : ''}`}
                            >
                                <td className="px-2 py-2 text-gray-500">{(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                <td className="px-2 py-2 font-bold text-gray-800 truncate max-w-[80px]">
                                    {stock.companies?.name}
                                    <div className="text-[9px] text-gray-400 font-normal">{stock.code}</div>
                                </td>
                                {currentTab === 'TOP' ? (
                                    <td className="px-2 py-2 text-right font-bold text-blue-600">{stock.rs_rating}</td>
                                ) : (
                                    <td className="px-2 py-2 text-right font-bold text-red-500">+{stock.rs_diff}</td>
                                )}
                                <td className="px-2 py-2 text-right text-gray-600">
                                    {stock.marcap ? Math.round(stock.marcap / 100000000).toLocaleString() : '-'}
                                </td>
                            </tr>
                        ))}
                        {loading && <tr><td colSpan={4} className="p-4 text-center text-gray-400 text-xs">로딩 중...</td></tr>}
                    </tbody>
                </table>
            </div>

            {/* 페이지네이션 */}
            <div className="p-2 border-t bg-gray-50 flex justify-center items-center gap-1 text-[10px]">
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-1.5 py-0.5 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&lt;</button>
                <input 
                    type="text" 
                    className="w-8 border rounded p-0.5 text-center font-bold focus:ring-1 focus:ring-blue-500 outline-none" 
                    value={inputPage} 
                    onChange={handleInputPageChange} 
                    onBlur={submitPageInput} 
                    onKeyDown={handleKeyDown} 
                />
                <span className="text-gray-500">/ {totalPages}</span>
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-1.5 py-0.5 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&gt;</button>
            </div>
        </div>

        {/* [오른쪽] 차트 영역 (나머지 공간) */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden relative">
            {selectedStock ? (
                <>
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-gray-800">
                                {selectedStock.name} <span className="text-base font-normal text-gray-500">({selectedStock.code})</span>
                            </h2>
                            
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
                        {isChartLoading && <span className="text-xs text-blue-500 font-bold animate-pulse">데이터 로딩 중...</span>}
                    </div>
                    <div className="flex-1 relative w-full h-full bg-white min-h-0">
                        {chartData.length > 0 ? (
                            // 차트 컴포넌트 (Price, Volume, RS)
                            <StockChartDiscovery data={chartData} />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                                {isChartLoading ? '차트 그리는 중...' : '데이터가 없습니다.'}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50/50">
                    <div className="text-4xl mb-2">👈</div>
                    <p className="font-bold">왼쪽 목록에서 종목을 선택하세요</p>
                    <p className="text-xs mt-1">상세 차트와 RS 지수를 확인할 수 있습니다.</p>
                </div>
            )}
        </div>

      </main>
    </div>
  );
}