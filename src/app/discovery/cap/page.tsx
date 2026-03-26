'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChartDiscovery from '@/components/StockChartDiscovery';

type CapStock = {
  code: string;
  rsRating: number | null;
  marcap: number;
  volume: number | null;
  companies: {
    name: string;
  } | null;
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

type SortField = 'rsRating' | 'marcap' | 'volume';
type SortDirection = 'desc' | 'asc';

type CompanyRow = {
  code: string;
  name: string | null;
};

type RsRow = {
  code: string;
  rank_weighted: number | null;
};

type VolumeRow = {
  code: string;
  volume: number | null;
};

type MarketCapRow = {
  code: string;
  market_cap: number | string | null;
};

type StoredChartRow = {
  time?: string;
  open?: number | string | null;
  high?: number | string | null;
  low?: number | string | null;
  close?: number | string | null;
  volume?: number | string | null;
  rs?: number | string | null;
};

type IndustryThemeRelation = {
  industries?: { name?: string | null } | null;
  themes?: { name?: string | null } | null;
};

const ITEMS_PER_PAGE = 20;
const EXCLUDED_CODES = new Set(['KOSPI', 'KOSDAQ', 'KS11', 'KQ11']);

const normalizeMarketCapToWon = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return 0;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  // Some rows appear to store market cap in eok units instead of won.
  if (parsed < 100000000) {
    return parsed * 100000000;
  }

  return parsed;
};

export default function CapDiscoveryPage() {
  const supabase = createClientComponentClient();

  const [stocks, setStocks] = useState<CapStock[]>([]);
  const [displayedStocks, setDisplayedStocks] = useState<CapStock[]>([]);
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('marcap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referenceDate, setReferenceDate] = useState('');

  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');

  const [industries, setIndustries] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [showAllThemes, setShowAllThemes] = useState(false);

  useEffect(() => {
    const getUserAndFavs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: favData } = await supabase
        .from('user_favorite_stocks')
        .select('company_code, group_name')
        .eq('user_id', session.user.id);

      if (!favData) return;

      const loadedFavs = favData.map((f) => ({
        code: f.company_code,
        group: f.group_name || '기본 그룹',
      }));
      setFavorites(loadedFavs);

      const groups = Array.from(new Set(loadedFavs.map((f) => f.group)));
      if (!groups.includes('기본 그룹')) groups.unshift('기본 그룹');
      setFavGroups(groups.sort());
    };

    getUserAndFavs();
  }, [supabase]);

  const toggleFavorite = async () => {
    if (!selectedStock) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    const isFav = favorites.some((f) => f.code === selectedStock.code && f.group === targetGroup);

    if (isFav) {
      const { error: deleteError } = await supabase
        .from('user_favorite_stocks')
        .delete()
        .eq('user_id', user.id)
        .eq('company_code', selectedStock.code)
        .eq('group_name', targetGroup);

      if (!deleteError) {
        setFavorites((prev) =>
          prev.filter((f) => !(f.code === selectedStock.code && f.group === targetGroup))
        );
      }
      return;
    }

    const { error: insertError } = await supabase
      .from('user_favorite_stocks')
      .insert({
        user_id: user.id,
        company_code: selectedStock.code,
        company_name: selectedStock.name,
        group_name: targetGroup,
      });

    if (!insertError) {
      setFavorites((prev) => [...prev, { code: selectedStock.code, group: targetGroup }]);
      if (!favGroups.includes(targetGroup)) {
        setFavGroups((prev) => [...prev, targetGroup].sort());
      }
    }
  };

  const fetchTopMarketCapStocks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: dateData, error: dateError } = await supabase
        .from('daily_prices_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (dateError) throw dateError;
      if (!dateData?.date) {
        setStocks([]);
        return;
      }

      const latestDate = dateData.date;
      setReferenceDate(latestDate);

      const [{ data: marketCapData, error: marketCapError }, { data: companyData, error: companyError }] =
        await Promise.all([
          supabase
            .from('daily_prices_v2')
            .select('code, market_cap')
            .eq('date', latestDate)
            .not('market_cap', 'is', null)
            .order('market_cap', { ascending: false })
            .limit(150),
          supabase
            .from('companies')
            .select('code, name'),
        ]);

      if (marketCapError) throw marketCapError;
      if (companyError) throw companyError;

      const companyMap = new Map<string, string | null>();
      ((companyData || []) as CompanyRow[]).forEach((item) => {
        companyMap.set(item.code, item.name);
      });

      const topCandidates = ((marketCapData || []) as MarketCapRow[])
        .filter((item) => item.code && !EXCLUDED_CODES.has(item.code))
        .slice(0, 100);

      if (topCandidates.length === 0) {
        setStocks([]);
        return;
      }

      const codes = topCandidates.map((item) => item.code);

      const [{ data: rsData, error: rsError }, { data: volumeData, error: volumeError }] = await Promise.all([
        supabase
          .from('rs_rankings_v2')
          .select('code, rank_weighted')
          .eq('date', latestDate)
          .in('code', codes),
        supabase
          .from('daily_prices_v2')
          .select('code, volume')
          .eq('date', latestDate)
          .in('code', codes),
      ]);

      if (rsError) throw rsError;
      if (volumeError) throw volumeError;

      const rsMap = new Map<string, number | null>();
      (rsData as RsRow[] | null)?.forEach((item) => rsMap.set(item.code, item.rank_weighted));

      const volumeMap = new Map<string, number | null>();
      (volumeData as VolumeRow[] | null)?.forEach((item) => volumeMap.set(item.code, item.volume));

      const mergedStocks: CapStock[] = topCandidates.map((item) => ({
        code: item.code,
        rsRating: rsMap.get(item.code) ?? null,
        marcap: normalizeMarketCapToWon(item.market_cap),
        volume: volumeMap.get(item.code) ?? null,
        companies: { name: companyMap.get(item.code) || '알 수 없음' },
      }));

      setStocks(mergedStocks);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.';
      console.error('Cap discovery load error:', message);
      setError(message);
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchChartData = async (code: string) => {
    setIsChartLoading(true);
    try {
      const jsonPromise = supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
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

      let resultData: StoredChartRow[] = [];
      if (jsonResult.data) {
        const textData = await jsonResult.data.text();
        resultData = JSON.parse(textData) as StoredChartRow[];
      }

      const dataMap = new Map<string, ChartData>();

      resultData.forEach((item) => {
        if (!item.time) return;

        let open = Number(item.open);
        let high = Number(item.high);
        let low = Number(item.low);
        const close = Number(item.close);

        if (open === 0 && high === 0 && low === 0) {
          open = close;
          high = close;
          low = close;
        }

        dataMap.set(item.time, {
          ...item,
          open,
          high,
          low,
          close,
          volume: Number(item.volume),
          rs: item.rs !== null ? Number(item.rs) : undefined,
        });
      });

      dbResult.data?.forEach((row) => {
        const time = row.date;
        if (!time) return;

        const existing = dataMap.get(time) || ({} as Partial<ChartData>);
        let open = Number(row.open);
        let high = Number(row.high);
        let low = Number(row.low);
        const close = Number(row.close);

        if (open === 0 && high === 0 && low === 0) {
          open = close;
          high = close;
          low = close;
        }

        dataMap.set(time, {
          ...existing,
          time,
          open,
          high,
          low,
          close,
          volume: Number(row.volume),
        } as ChartData);
      });

      rsResult.data?.forEach((row) => {
        const time = row.date;
        if (!time) return;

        const existing = dataMap.get(time);
        if (!existing) return;

        dataMap.set(time, {
          ...existing,
          rs: row.rank_weighted,
        });
      });

      const sortedData = Array.from(dataMap.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      setChartData(sortedData);
    } catch (e) {
      console.error('Chart fetch error:', e);
      setChartData([]);
    } finally {
      setIsChartLoading(false);
    }
  };

  const fetchIndustriesAndThemes = async (code: string) => {
    try {
      const { data: industryData } = await supabase
        .from('company_industries')
        .select('industry_id, industries(name)')
        .eq('company_code', code);

      if (industryData) {
        setIndustries(
          (industryData as IndustryThemeRelation[])
            .map((item) => item.industries?.name)
            .filter((name): name is string => Boolean(name))
        );
      } else {
        setIndustries([]);
      }

      const { data: themeData } = await supabase
        .from('company_themes')
        .select('theme_id, themes(name)')
        .eq('company_code', code);

      if (themeData) {
        setThemes(
          (themeData as IndustryThemeRelation[])
            .map((item) => item.themes?.name)
            .filter((name): name is string => Boolean(name))
        );
      } else {
        setThemes([]);
      }
    } catch (e) {
      console.error('Error fetching industries and themes:', e);
      setIndustries([]);
      setThemes([]);
    }
  };

  const handleStockClick = (stock: CapStock) => {
    setSelectedStock({
      code: stock.code,
      name: stock.companies?.name || '알 수 없음',
    });
    fetchChartData(stock.code);
    fetchIndustriesAndThemes(stock.code);
    setShowAllThemes(false);
  };

  useEffect(() => {
    fetchTopMarketCapStocks();
  }, [fetchTopMarketCapStocks]);

  useEffect(() => {
    setCurrentPage(1);
  }, [stocks.length, sortField, sortDirection]);

  useEffect(() => {
    const sortedStocks = [...stocks].sort((a, b) => {
      const aValue = a[sortField] ?? -1;
      const bValue = b[sortField] ?? -1;

      if (aValue === bValue) {
        return a.code.localeCompare(b.code);
      }

      if (sortDirection === 'desc') {
        return Number(bValue) - Number(aValue);
      }

      return Number(aValue) - Number(bValue);
    });

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedStocks(sortedStocks.slice(startIndex, endIndex));
  }, [stocks, currentPage, sortField, sortDirection]);

  const totalPages = Math.ceil(stocks.length / ITEMS_PER_PAGE);
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }

    setSortField(field);
    setSortDirection('desc');
  };

  const getSortLabel = (field: SortField, label: string) => {
    if (sortField !== field) return label;
    return `${label} ${sortDirection === 'desc' ? '↓' : '↑'}`;
  };

  const isFavorite = selectedStock
    ? favorites.some((f) => f.code === selectedStock.code && f.group === targetGroup)
    : false;

  const formatMarcap = (amount: number) => {
    const trillion = Math.floor(amount / 1000000000000);
    const billion = Math.round((amount % 1000000000000) / 100000000);
    if (trillion > 0) return `${trillion}조 ${billion.toLocaleString()}억`;
    return `${billion.toLocaleString()}억`;
  };

  const formatVolume = (amount: number | null) => {
    if (amount === null || Number.isNaN(amount)) return '-';
    return Math.round(amount).toLocaleString();
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <main className="flex-1 p-4 flex gap-4 overflow-hidden">
        <div className="w-[30%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="text-lg font-bold text-gray-800 mb-3">🏦 시총 TOP 100</h2>
            <div className="text-[10px] text-gray-500 flex justify-between">
              <span>기준: {referenceDate || '-'}</span>
              <span>총 {stocks.length}개</span>
            </div>
            {error && (
              <div className="mt-2 text-xs text-red-500 font-bold bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-2 py-2 font-medium w-10 text-center">#</th>
                  <th className="px-2 py-2 font-medium">종목명</th>
                  <th className="px-2 py-2 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('rsRating')}
                      className="w-full text-right hover:text-gray-700"
                    >
                      {getSortLabel('rsRating', 'RS')}
                    </button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('marcap')}
                      className="w-full text-right hover:text-gray-700"
                    >
                      {getSortLabel('marcap', '시총')}
                    </button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('volume')}
                      className="w-full text-right hover:text-gray-700"
                    >
                      {getSortLabel('volume', '거래량')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {!loading &&
                  displayedStocks.map((stock, idx) => (
                    <tr
                      key={stock.code}
                      onClick={() => handleStockClick(stock)}
                      className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                        selectedStock?.code === stock.code ? 'bg-blue-100' : ''
                      }`}
                    >
                      <td className="px-2 py-2 text-gray-500 text-center">
                        {(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
                      </td>
                      <td className="px-2 py-2 font-bold text-gray-800 truncate max-w-[96px]">
                        {stock.companies?.name}
                        <div className="text-[9px] text-gray-400 font-normal">{stock.code}</div>
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-blue-600">
                        {stock.rsRating ?? '-'}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-600 whitespace-nowrap">
                        {formatMarcap(stock.marcap)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-gray-600">
                        {formatVolume(stock.volume)}
                      </td>
                    </tr>
                  ))}
                {loading && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-400 text-xs">
                      데이터 로딩 중...
                    </td>
                  </tr>
                )}
                {!loading && stocks.length === 0 && !error && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-400 text-xs">
                      조건에 맞는 종목이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-2 border-t bg-gray-50 flex justify-center items-center gap-2 text-[10px]">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50"
              >
                &lt;
              </button>
              <span className="text-gray-600 font-bold">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50"
              >
                &gt;
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden relative">
          {selectedStock ? (
            <>
              <div className="p-4 border-b bg-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-xl font-bold text-gray-800">{selectedStock.name}</h2>
                      <span className="text-base text-gray-500">({selectedStock.code})</span>
                    </div>

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

                  <div className="flex items-center gap-2">
                    {isChartLoading && (
                      <span className="text-xs text-blue-500 font-bold animate-pulse">
                        데이터 로딩 중...
                      </span>
                    )}

                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                      <select
                        value={targetGroup}
                        onChange={(e) => setTargetGroup(e.target.value)}
                        className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer px-1"
                      >
                        {favGroups.map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={toggleFavorite}
                        className={`text-xl px-1 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                      >
                        {isFavorite ? '⭐' : '☆'}
                      </button>
                    </div>
                  </div>
                </div>
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
              <p className="font-bold">왼쪽 목록에서 종목을 선택하세요</p>
              <p className="text-xs mt-1">캔들 차트와 RS 지수를 확인할 수 있습니다.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
