'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartDiscovery from '@/components/StockChartDiscovery';

type VolumeStock = {
  code: string;
  total_value: number; // 60일 누적 거래대금
  companies: {
    name: string;
  } | null;
  marcap?: number;
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type FavItem = {
  code: string;
  group: string;
};

export default function VolumeDiscoveryPage() {
  const supabase = createClientComponentClient();
  
  const [stocks, setStocks] = useState<VolumeStock[]>([]);
  const [displayedStocks, setDisplayedStocks] = useState<VolumeStock[]>([]);
  
  const [selectedStock, setSelectedStock] = useState<{code: string, name: string} | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');

  // 사용자 정보 및 즐겨찾기 로드
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

  const mapCompanyNames = async (rawStocks: any[]) => {
    const codes = rawStocks.map((s: any) => s.code);
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
    
    return rawStocks.map((stock: any) => {
        const info = companyInfoMap.get(stock.code) || { name: '알 수 없음', marcap: 0 };
        return {
            ...stock,
            marcap: info.marcap,
            companies: { name: info.name }
        };
    });
  };

  const fetchVolumeStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RPC 함수 호출: 60일 누적 거래대금 2조원 이상
      const { data, error } = await supabase.rpc('get_volume_rank_60d', { min_amount: 2000000000000 });

      if (error) {
          // RPC 함수가 없을 경우 처리
          if (error.message.includes('function') && error.message.includes('does not exist')) {
              throw new Error("DB 함수가 없습니다. 'scripts/create_volume_rank_rpc.sql'을 실행해주세요.");
          }
          throw error;
      }

      if (data && data.length > 0) {
        const filteredData = data.filter((item: any) => item.code !== 'KOSPI' && item.code !== 'KOSDAQ');
        const mappedData = await mapCompanyNames(filteredData);
        setStocks(mappedData);
      } else {
        setStocks([]);
      }
    } catch (err: any) {
      console.error("Volume Data Load Error:", err.message);
      setError(err.message || '데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 차트 데이터 로드 (기존 재사용)
  const fetchChartData = async (code: string) => {
    setIsChartLoading(true);
    try {
        const jsonPromise = supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
        const dbPromise = supabase.from('daily_prices_v2').select('date, open, high, low, close, volume').eq('code', code).order('date', { ascending: false }).limit(100);

        const [jsonResult, dbResult] = await Promise.all([jsonPromise, dbPromise]);

        let resultData: any[] = [];
        if (jsonResult.data) {
            const textData = await jsonResult.data.text();
            resultData = JSON.parse(textData);
        }

        const dataMap = new Map();
        resultData.forEach(item => {
            if (item.time) {
                let o = Number(item.open), h = Number(item.high), l = Number(item.low), c = Number(item.close);
                if (o===0 && h===0 && l===0) { o=c; h=c; l=c; }
                dataMap.set(item.time, { ...item, open: o, high: h, low: l, close: c, volume: Number(item.volume) });
            }
        });

        if (dbResult.data) {
            dbResult.data.forEach(row => {
                const time = row.date;
                if (!time) return;
                const existing = dataMap.get(time) || {};
                let o = Number(row.open), h = Number(row.high), l = Number(row.low), c = Number(row.close);
                if (o===0 && h===0 && l===0) { o=c; h=c; l=c; }
                dataMap.set(time, { ...existing, time, open: o, high: h, low: l, close: c, volume: Number(row.volume) });
            });
        }

        const sortedData = Array.from(dataMap.values()).sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
        setChartData(sortedData);
    } catch (e) {
        console.error(e);
        setChartData([]);
    } finally {
        setIsChartLoading(false);
    }
  };

  const handleStockClick = (stock: VolumeStock) => {
      setSelectedStock({ code: stock.code, name: stock.companies?.name || '알 수 없음' });
      fetchChartData(stock.code);
  };

  useEffect(() => {
      fetchVolumeStocks();
  }, [fetchVolumeStocks]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedStocks(stocks.slice(startIndex, endIndex));
  }, [stocks, currentPage]);

  const totalPages = Math.ceil(stocks.length / ITEMS_PER_PAGE);
  const handlePageChange = (n: number) => { if (n >= 1 && n <= totalPages) setCurrentPage(n); };

  const isFavorite = selectedStock 
    ? favorites.some(f => f.code === selectedStock.code && f.group === targetGroup) 
    : false;

  const formatMoney = (amount: number) => {
      const trillion = Math.floor(amount / 1000000000000);
      const billion = Math.round((amount % 1000000000000) / 100000000);
      if (trillion > 0) return `${trillion}조 ${billion}억`;
      return `${billion}억`;
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <main className="flex-1 p-4 flex gap-4 overflow-hidden">
        
        {/* [왼쪽] 리스트 영역 */}
        <div className="w-[30%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
                <h2 className="text-lg font-bold text-gray-800">💰 거래대금 상위 (최근 60일)</h2>
                <div className="text-[10px] text-gray-500 mt-1 flex justify-between">
                    <span>기준: 누적 2조원 이상</span>
                    <span>총 {stocks.length}개 종목</span>
                </div>
                {error && <div className="mt-2 text-xs text-red-500 font-bold bg-red-50 p-2 rounded">{error}</div>}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-2 py-2 font-medium w-10">순위</th>
                            <th className="px-2 py-2 font-medium">종목명</th>
                            <th className="px-2 py-2 font-medium text-right">누적 거래대금</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs">
                        {!loading && displayedStocks.map((stock, idx) => (
                            <tr 
                                key={stock.code} 
                                onClick={() => handleStockClick(stock)}
                                className={`cursor-pointer hover:bg-blue-50 transition-colors ${selectedStock?.code === stock.code ? 'bg-blue-100' : ''}`}
                            >
                                <td className="px-2 py-2 text-gray-500 text-center">{(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                <td className="px-2 py-2 font-bold text-gray-800 truncate">
                                    {stock.companies?.name}
                                    <div className="text-[9px] text-gray-400 font-normal">{stock.code}</div>
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-blue-600 font-bold">
                                    {formatMoney(stock.total_value)}
                                </td>
                            </tr>
                        ))}
                        {loading && <tr><td colSpan={3} className="p-4 text-center text-gray-400 text-xs">데이터 로딩 중...</td></tr>}
                        {!loading && stocks.length === 0 && !error && (
                            <tr><td colSpan={3} className="p-8 text-center text-gray-400 text-xs">조건에 맞는 종목이 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
                <div className="p-2 border-t bg-gray-50 flex justify-center items-center gap-2 text-[10px]">
                    <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&lt;</button>
                    <span className="text-gray-600 font-bold">{currentPage} / {totalPages}</span>
                    <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&gt;</button>
                </div>
            )}
        </div>

        {/* [오른쪽] 차트 영역 */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden relative">
            {selectedStock ? (
                <>
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-gray-800">
                                {selectedStock.name} <span className="text-base font-normal text-gray-500">({selectedStock.code})</span>
                            </h2>
                            <div className="flex items-center gap-1 ml-2 bg-gray-100 rounded-lg p-1">
                                <select 
                                    value={targetGroup} 
                                    onChange={(e) => setTargetGroup(e.target.value)}
                                    className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer px-1"
                                >
                                    {favGroups.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                                <button 
                                    onClick={toggleFavorite}
                                    className={`text-xl px-1 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                                >
                                    {isFavorite ? '⭐' : '☆'}
                                </button>
                            </div>
                        </div>
                        {isChartLoading && <span className="text-xs text-blue-500 font-bold animate-pulse">데이터 로딩 중...</span>}
                    </div>
                    <div className="flex-1 relative w-full h-full bg-white min-h-0">
                        {chartData.length > 0 ? (
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
                    <p className="font-bold">종목을 선택하세요</p>
                </div>
            )}
        </div>

      </main>
    </div>
  );
}