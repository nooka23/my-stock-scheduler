'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartVolume from '@/components/StockChartVolume';

type VolumeStock = {
  code: string;
  total_value: number; // 60일 누적 거래대금 (추정)
  companies: {
    name: string;
  } | null;
  marcap?: number;
  rank_amount_60?: number; // 0-99 점수
  rank_diff?: number;      // 상승폭
  prev_rank?: number;      // 이전 점수
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
  volumeRank60?: number; // 거래량 순위 지수
};

type FavItem = {
  code: string;
  group: string;
};

type TabType = 'top200' | 'weekly_risers' | 'monthly_risers';

export default function VolumeDiscoveryPage() {
  const supabase = createClientComponentClient();
  
  const [activeTab, setActiveTab] = useState<TabType>('top200');

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

  const [industries, setIndustries] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const [currentDate, setCurrentDate] = useState('');
  const [referenceDate, setReferenceDate] = useState(''); // 비교 시점 날짜

  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    setCurrentDate(`${year}-${month}-${day}`);
  }, []);

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

  // 상위 200 로드
  const fetchTop200 = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReferenceDate(''); 
    try {
      const { data: dateData } = await supabase
        .from('trading_value_rankings')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (!dateData) {
          setStocks([]);
          setLoading(false);
          return;
      }
      setCurrentDate(dateData.date);

      const { data: rankData, error } = await supabase
        .from('trading_value_rankings')
        .select(`
            code, 
            avg_amount_60,
            companies (name, marcap)
        `)
        .eq('date', dateData.date)
        .order('avg_amount_60', { ascending: false })
        .limit(210);

      if (error) throw error;

      if (rankData && rankData.length > 0) {
        const mappedData: VolumeStock[] = rankData.map((item: any) => ({
            code: item.code,
            total_value: item.avg_amount_60 * 60,
            companies: item.companies,
            marcap: item.companies?.marcap || 0
        }));
        
        const filteredData = mappedData.filter(item => !['KOSPI', 'KOSDAQ', 'KS11', 'KQ11'].includes(item.code));
        setStocks(filteredData.slice(0, 200));
      } else {
        setStocks([]);
      }
    } catch (err: any) {
      console.error("Top 200 Load Error:", err.message);
      setError(err.message || '데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 급등 로드 (주간/월간)
  const fetchRankChanges = useCallback(async (period: 'week' | 'month') => {
      setLoading(true);
      setError(null);
      try {
        // 1. 최신 날짜
        const { data: dateData } = await supabase
            .from('trading_value_rankings')
            .select('date')
            .order('date', { ascending: false })
            .limit(1)
            .single();

        if (!dateData) {
            setStocks([]);
            setLoading(false);
            return;
        }
        const latestDate = dateData.date;
        setCurrentDate(latestDate);

        // 2. 비교 날짜 찾기
        // week: 5~7일 전, month: 25~35일 전
        const daysOffset = period === 'week' ? 5 : 25;

        const { data: prevDateData } = await supabase
            .from('trading_value_rankings')
            .select('date')
            .lt('date', new Date(new Date(latestDate).setDate(new Date(latestDate).getDate() - daysOffset)).toISOString().split('T')[0])
            .order('date', { ascending: false })
            .limit(1)
            .single();

        const prevDate = prevDateData?.date;
        setReferenceDate(prevDate || '');

        if (!prevDate) {
            setError(`비교할 과거 데이터(${period})가 부족합니다.`);
            setStocks([]);
            setLoading(false);
            return;
        }

        // 3. 두 날짜의 데이터 가져오기 (rank_amount_60 필요)
        const { data: currentData } = await supabase
            .from('trading_value_rankings')
            .select('code, avg_amount_60, rank_amount_60, companies(name, marcap)')
            .eq('date', latestDate)
            .not('rank_amount_60', 'is', null);

        const { data: prevData } = await supabase
            .from('trading_value_rankings')
            .select('code, rank_amount_60')
            .eq('date', prevDate)
            .not('rank_amount_60', 'is', null);

        if (!currentData || !prevData) {
            throw new Error('데이터 로드 실패');
        }

        // 4. Map 생성 및 Diff 계산
        const prevMap = new Map();
        prevData.forEach((d: any) => prevMap.set(d.code, d.rank_amount_60));

        let risers: VolumeStock[] = [];

        currentData.forEach((curr: any) => {
            if (prevMap.has(curr.code)) {
                const prevRank = prevMap.get(curr.code);
                const diff = curr.rank_amount_60 - prevRank;

                // 상승한 종목만, 그리고 지수 제외
                if (diff > 0 && !['KOSPI', 'KOSDAQ', 'KS11', 'KQ11'].includes(curr.code)) {
                    risers.push({
                        code: curr.code,
                        total_value: curr.avg_amount_60 * 60,
                        companies: curr.companies,
                        marcap: curr.companies?.marcap,
                        rank_amount_60: curr.rank_amount_60,
                        prev_rank: prevRank,
                        rank_diff: diff
                    });
                }
            }
        });

        // 5. 정렬: 점수 상승폭 DESC, 거래대금 DESC
        risers.sort((a, b) => {
            if ((b.rank_diff || 0) !== (a.rank_diff || 0)) {
                return (b.rank_diff || 0) - (a.rank_diff || 0);
            }
            return b.total_value - a.total_value;
        });

        setStocks(risers.slice(0, 200));

      } catch (err: any) {
          console.error("Risers Load Error:", err.message);
          setError(err.message || '데이터 계산 실패');
      } finally {
          setLoading(false);
      }
  }, [supabase]);


  useEffect(() => {
      setCurrentPage(1); // 탭 변경 시 페이지 초기화
      if (activeTab === 'top200') {
          fetchTop200();
      } else if (activeTab === 'weekly_risers') {
          fetchRankChanges('week');
      } else if (activeTab === 'monthly_risers') {
          fetchRankChanges('month');
      }
  }, [activeTab, fetchTop200, fetchRankChanges]);


  // 차트 데이터 로드
  const fetchChartData = async (code: string) => {
    setIsChartLoading(true);
    try {
        const jsonPromise = supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
        const dbPromise = supabase.from('daily_prices_v2').select('date, open, high, low, close, volume').eq('code', code).order('date', { ascending: false }).limit(100);
        
        // 60일 거래량 순위 지수 데이터 로드
        const volumeRankPromise = supabase.from('trading_value_rankings')
            .select('date, rank_amount_60')
            .eq('code', code)
            .order('date', { ascending: false })
            .limit(100);

        const [jsonResult, dbResult, volumeRankResult] = await Promise.all([jsonPromise, dbPromise, volumeRankPromise]);

        let resultData: any[] = [];
        if (jsonResult.data) {
            const textData = await jsonResult.data.text();
            resultData = JSON.parse(textData);
        }

        const dataMap = new Map<string, ChartData>(); 
        
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

        if (volumeRankResult.data) {
            volumeRankResult.data.forEach(row => {
                const time = row.date;
                if (!time) return;
                const existing = dataMap.get(time);
                if (existing) {
                    dataMap.set(time, { ...existing, volumeRank60: row.rank_amount_60 });
                }
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
      fetchIndustriesAndThemes(stock.code);
      setShowAllThemes(false); // 종목 변경 시 테마 접기
  };

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
    <div className="flex h-full flex-col overflow-hidden px-4 py-4 lg:px-8 lg:py-6">
      <main className="flex-1 flex gap-4 overflow-hidden">
        
        {/* [왼쪽] 리스트 영역 */}
        <div className="w-[30%] app-card-strong flex flex-col overflow-hidden">
            <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] p-4 pb-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Discovery</p>
                <h2 className="mb-4 mt-2 text-xl font-semibold text-slate-950">거래대금 분석</h2>
                <div className="flex gap-2 border-b border-[var(--border)]">
                    <button 
                        onClick={() => setActiveTab('top200')}
                        className={`pb-2 px-1 text-sm font-semibold transition-colors ${activeTab === 'top200' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]' : 'text-[var(--text-subtle)] hover:text-slate-700'}`}
                    >
                        상위 200
                    </button>
                    <button 
                        onClick={() => setActiveTab('weekly_risers')}
                        className={`pb-2 px-1 text-sm font-semibold transition-colors ${activeTab === 'weekly_risers' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]' : 'text-[var(--text-subtle)] hover:text-slate-700'}`}
                    >
                        주간 급상승
                    </button>
                    <button
                        onClick={() => setActiveTab('monthly_risers')}
                        className={`pb-2 px-1 text-sm font-semibold transition-colors ${activeTab === 'monthly_risers' ? 'text-[var(--primary)] border-b-2 border-[var(--primary)]' : 'text-[var(--text-subtle)] hover:text-slate-700'}`}
                    >
                        월간 급상승
                    </button>
                </div>

                <div className="mb-2 mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>
                        기준: {currentDate} 
                        {activeTab !== 'top200' && referenceDate && ` (vs ${referenceDate})`}
                    </span>
                    <span>총 {stocks.length}개</span>
                </div>
                {error && <div className="mb-2 rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-500">{error}</div>}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--text-subtle)] shadow-sm">
                        <tr>
                            <th className="px-2 py-2 font-medium w-10 text-center">#</th>
                            <th className="px-2 py-2 font-medium">종목명</th>
                            {activeTab !== 'top200' && (
                                <th className="px-2 py-2 font-medium text-center">점수변화</th>
                            )}
                            <th className="px-2 py-2 font-medium text-right">거래대금(60일)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] text-xs">
                        {!loading && displayedStocks.map((stock, idx) => (
                            <tr 
                                key={stock.code} 
                                onClick={() => handleStockClick(stock)}
                                className={`cursor-pointer transition-colors ${selectedStock?.code === stock.code ? 'bg-[var(--surface-accent)]' : 'hover:bg-[var(--surface-muted)]'}`}
                            >
                                <td className="px-2 py-2 text-[var(--text-muted)] text-center">{(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                <td className="px-2 py-2 font-semibold text-slate-900 truncate max-w-[120px]">
                                    {stock.companies?.name}
                                    <div className="text-[9px] text-[var(--text-subtle)] font-normal">{stock.code}</div>
                                </td>
                                {activeTab !== 'top200' && (
                                    <td className="px-2 py-2 text-center">
                                        <span className="font-semibold text-red-500">+{stock.rank_diff}</span>
                                        <div className="text-[9px] text-[var(--text-subtle)]">
                                            ({stock.prev_rank}→{stock.rank_amount_60})
                                        </div>
                                    </td>
                                )}
                                <td className="px-2 py-2 text-right font-mono text-[var(--primary)] font-semibold">
                                    {formatMoney(stock.total_value)}
                                </td>
                            </tr>
                        ))}
                        {loading && <tr><td colSpan={activeTab !== 'top200' ? 4 : 3} className="p-4 text-center text-[var(--text-subtle)] text-xs">데이터 로딩 중...</td></tr>}
                        {!loading && stocks.length === 0 && !error && (
                            <tr><td colSpan={activeTab !== 'top200' ? 4 : 3} className="p-8 text-center text-[var(--text-subtle)] text-xs">조건에 맞는 종목이 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[10px]">
                    <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50">&lt;</button>
                    <span className="font-semibold text-[var(--text-muted)]">{currentPage} / {totalPages}</span>
                    <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50">&gt;</button>
                </div>
            )}
        </div>

        <div className="app-card-strong relative flex flex-1 flex-col overflow-hidden">
            {selectedStock ? (
                <>
                    <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] p-4">
                        <div className="flex justify-between items-start">
                            <div className="flex flex-col gap-2">
                                <div className="flex items-baseline gap-2">
                                    <h2 className="text-2xl font-semibold text-slate-950">{selectedStock.name}</h2>
                                    <span className="text-base text-[var(--text-muted)]">({selectedStock.code})</span>
                                </div>

                                {/* 업종/테마 표시 */}
                                <div className="flex flex-wrap gap-2 text-xs">
                                    {industries.length > 0 && (
                                        <div className="flex items-center gap-1">
                                            <span className="text-[var(--text-muted)] font-medium">업종:</span>
                                            {industries.map((industry, idx) => (
                                                <span key={idx} className="rounded-full bg-[var(--surface-accent)] px-2 py-0.5 text-[var(--primary)]">
                                                    {industry}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {themes.length > 0 && (
                                        <div className="flex items-center gap-1">
                                            <span className="text-[var(--text-muted)] font-medium">테마:</span>
                                            <div className="flex flex-wrap gap-1">
                                                {(showAllThemes ? themes : themes.slice(0, 5)).map((theme, idx) => (
                                                    <span key={idx} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                                        {theme}
                                                    </span>
                                                ))}
                                                {themes.length > 5 && (
                                                    <button
                                                        onClick={() => setShowAllThemes(!showAllThemes)}
                                                        className="px-1 text-xs font-medium text-[var(--text-muted)] underline hover:text-slate-900"
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

                            <div className="flex items-center gap-2">
                                {isChartLoading && <span className="text-xs font-semibold text-[var(--primary)] animate-pulse">데이터 로딩 중...</span>}

                                <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-[var(--shadow-sm)]">
                                    <select
                                        value={targetGroup}
                                        onChange={(e) => setTargetGroup(e.target.value)}
                                        className="bg-transparent text-xs font-semibold text-slate-700 outline-none cursor-pointer px-1"
                                    >
                                        {favGroups.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                    <button
                                        onClick={toggleFavorite}
                                        className={`text-xl px-1 ${isFavorite ? 'text-amber-400' : 'text-gray-300'}`}
                                    >
                                        {isFavorite ? '⭐' : '☆'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 relative w-full h-full bg-white min-h-0">
                        {chartData.length > 0 ? (
                            <StockChartVolume data={chartData} />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-[var(--text-subtle)]">
                                {isChartLoading ? '차트 그리는 중...' : '데이터가 없습니다.'}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-subtle)] bg-[var(--surface-muted)]/60">
                    <p className="font-semibold">종목을 선택하세요</p>
                </div>
            )}
        </div>

      </main>
    </div>
  );
}
