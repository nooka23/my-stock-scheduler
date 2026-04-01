'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import StockChart, { type StockChartHandle } from '@/components/StockChart';
import FullscreenPanel from '@/components/FullscreenPanel';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
  calculateEMA,
  calculateWMA,
  calculateKeltner,
  calculateMACD,
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

function formatChartLegend(item: ChartData | undefined) {
  if (!item) {
    return '지표 로딩중...';
  }

  const fmtPrice = (value: number | undefined) =>
    typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : '-';
  const fmtVol = (value: number | undefined) =>
    typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : '-';
  const fmtRS = (value: number | undefined) =>
    typeof value === 'number' && !Number.isNaN(value) ? value.toFixed(2) : '-';

  return {
    ema20: fmtPrice(item.ema20),
    wma150: fmtPrice(item.wma150),
    volume: fmtVol(item.volume),
    rs: fmtRS(item.rs),
  };
}

type TableStock = {
  code: string;
  name: string;
  rank: number;
  rs_score: number;
  close: number;
  marcap: number;
  is_template?: boolean | null;
  rank_amount?: number;
};

type FavItem = {
  code: string;
  group: string;
};

type ReviewStatus = 'candidate' | 'excluded';

type RankingRow = {
  code: string;
  rank_weighted: number;
  rank_amount?: number | null;
};

type IndustryRelationRow = {
  industries?: { name?: string | null } | null;
};

type ThemeRelationRow = {
  themes?: { name?: string | null } | null;
};

const ITEMS_PER_PAGE = 20;
const REVIEW_LIMIT = 420;

export default function ChartPage() {
  const supabase = createClientComponentClient();
  const chartRef = useRef<StockChartHandle | null>(null);

  const [data, setData] = useState<ChartData[]>([]);
  const [rawDailyData, setRawDailyData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [chartLoading, setChartLoading] = useState(false);

  const [tableData, setTableData] = useState<TableStock[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('1');
  const [totalPages, setTotalPages] = useState(1);
  const [latestDate, setLatestDate] = useState('');

  const [reviewStocks, setReviewStocks] = useState<TableStock[]>([]);
  const [reviewStatusMap, setReviewStatusMap] = useState<Record<string, ReviewStatus>>({});

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [inputCompany, setInputCompany] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const [favorites, setFavorites] = useState<FavItem[]>([]);
  const [favGroups, setFavGroups] = useState<string[]>(['기본 그룹']);
  const [targetGroup, setTargetGroup] = useState<string>('기본 그룹');
  const [checkGroup, setCheckGroup] = useState<string>('기본 그룹');
  const [savingReviewGroup, setSavingReviewGroup] = useState(false);

  const [minRS, setMinRS] = useState(0);
  const [indicesRS, setIndicesRS] = useState<{ kospi: number | null; kosdaq: number | null }>({ kospi: null, kosdaq: null });
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');

  const [industries, setIndustries] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [legendData, setLegendData] = useState<ChartData | undefined>(undefined);
  const legendDisplay = formatChartLegend(legendData);

  const convertToWeekly = (dailyData: ChartData[]): ChartData[] => {
    if (dailyData.length === 0) return [];

    const weeklyMap = new Map<string, ChartData>();
    const sortedDaily = [...dailyData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    sortedDaily.forEach((day) => {
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
          low: Infinity,
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

  const getReviewStorageKey = useCallback(
    () => (latestDate ? `mh-chart-review:${latestDate}:minRS:${minRS}` : ''),
    [latestDate, minRS]
  );

  const getStockStatus = useCallback(
    (code: string) => reviewStatusMap[code],
    [reviewStatusMap]
  );

  const currentReviewIndex = reviewStocks.findIndex((stock) => stock.code === currentCompany.code);
  const currentReviewStock = currentReviewIndex >= 0 ? reviewStocks[currentReviewIndex] : null;
  const candidateCount = Object.values(reviewStatusMap).filter((status) => status === 'candidate').length;
  const excludedCount = Object.values(reviewStatusMap).filter((status) => status === 'excluded').length;

  const selectReviewStockByIndex = useCallback((index: number) => {
    setReviewStocks((prev) => {
      const stock = prev[index];
      if (stock) {
        setCurrentCompany({ code: stock.code, name: stock.name });
        setCurrentPage(Math.floor(index / ITEMS_PER_PAGE) + 1);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    const getUserAndFavs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: favData } = await supabase
        .from('user_favorite_stocks')
        .select('company_code, group_name')
        .eq('user_id', session.user.id);

      if (!favData) return;

      const loadedFavs = favData.map((fav) => ({
        code: fav.company_code,
        group: fav.group_name || '기본 그룹',
      }));
      setFavorites(loadedFavs);

      const groups = Array.from(new Set(loadedFavs.map((fav) => fav.group)));
      if (!groups.includes('기본 그룹')) groups.unshift('기본 그룹');
      const sortedGroups = [...groups].sort((a, b) => {
        if (a === '기본 그룹') return -1;
        if (b === '기본 그룹') return 1;
        return a.localeCompare(b);
      });
      setFavGroups(sortedGroups);
    };

    getUserAndFavs();
  }, [supabase]);

  useEffect(() => {
    setInputPage(currentPage.toString());
  }, [currentPage]);

  useEffect(() => {
    const storageKey = getReviewStorageKey();
    if (!storageKey || reviewStocks.length === 0 || typeof window === 'undefined') {
      setReviewStatusMap({});
      return;
    }

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setReviewStatusMap({});
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, ReviewStatus>;
      const validCodes = new Set(reviewStocks.map((stock) => stock.code));
      const filtered = Object.fromEntries(
        Object.entries(parsed).filter(([code, status]) => validCodes.has(code) && (status === 'candidate' || status === 'excluded'))
      );
      setReviewStatusMap(filtered);
    } catch {
      setReviewStatusMap({});
    }
  }, [getReviewStorageKey, reviewStocks]);

  useEffect(() => {
    const storageKey = getReviewStorageKey();
    if (!storageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(reviewStatusMap));
  }, [getReviewStorageKey, reviewStatusMap]);

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPage(e.target.value);
  };

  const handlePageSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;

    const page = parseInt(inputPage, 10);
    if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      return;
    }

    setInputPage(currentPage.toString());
  };

  const checkTrendTemplates = useCallback(async (stocks: TableStock[]) => {
    const results = await Promise.all(
      stocks.map(async (stock) => {
        try {
          const { data: prices } = await supabase
            .from('daily_prices_v2')
            .select('close')
            .eq('code', stock.code)
            .order('date', { ascending: false })
            .limit(265);

          if (!prices || prices.length < 200) return { code: stock.code, result: false };

          const closes = prices.map((price) => price.close);
          const current = closes[0];

          const sma = (arr: number[], period: number) => {
            if (arr.length < period) return null;
            const slice = arr.slice(0, period);
            return slice.reduce((acc, value) => acc + value, 0) / period;
          };

          const ma50 = sma(closes, 50);
          const ma150 = sma(closes, 150);
          const ma200 = sma(closes, 200);
          const ma200PrevSlice = closes.slice(20, 220);
          const ma200Prev = ma200PrevSlice.length === 200
            ? ma200PrevSlice.reduce((acc, value) => acc + value, 0) / 200
            : null;

          if (!ma50 || !ma150 || !ma200 || !ma200Prev) {
            return { code: stock.code, result: false };
          }

          const yearSlice = closes.slice(0, 260);
          const high52 = Math.max(...yearSlice);
          const low52 = Math.min(...yearSlice);

          const isMet = (
            current > ma150 &&
            current > ma200 &&
            ma150 > ma200 &&
            ma200 > ma200Prev &&
            ma50 > ma150 &&
            ma50 > ma200 &&
            current > ma50 &&
            current >= low52 * 1.3 &&
            current >= high52 * 0.75 &&
            stock.rs_score >= 70
          );

          return { code: stock.code, result: isMet };
        } catch {
          return { code: stock.code, result: false };
        }
      })
    );

    setTableData((prev) => prev.map((item) => {
      const result = results.find((entry) => entry.code === item.code);
      return result ? { ...item, is_template: result.result } : item;
    }));
  }, [supabase]);

  const fetchRankingsAndCompanies = useCallback(async () => {
    setTableLoading(true);

    try {
      const { data: allCompanies } = await supabase
        .from('companies')
        .select('code, name')
        .range(0, 9999);

      if (allCompanies) setCompanyList(allCompanies);

      const { data: dateData } = await supabase
        .from('rs_rankings_with_volume')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (!dateData) return;

      setLatestDate(dateData.date);

      const [indexRes, pagedRankRes, reviewRankRes] = await Promise.all([
        supabase
          .from('rs_rankings_with_volume')
          .select('code, rank_weighted')
          .eq('date', dateData.date)
          .in('code', ['KOSPI', 'KOSDAQ', 'KS11', 'KQ11']),
        supabase
          .from('rs_rankings_with_volume')
          .select('*', { count: 'exact' })
          .eq('date', dateData.date)
          .gte('rank_amount', 60)
          .gte('rank_weighted', minRS)
          .order('rank_weighted', { ascending: false })
          .order('code', { ascending: true })
          .range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1),
        supabase
          .from('rs_rankings_with_volume')
          .select('*')
          .eq('date', dateData.date)
          .gte('rank_amount', 60)
          .gte('rank_weighted', minRS)
          .order('rank_weighted', { ascending: false })
          .order('code', { ascending: true })
          .range(0, REVIEW_LIMIT - 1),
      ]);

      if (indexRes.data) {
        const kospi = indexRes.data.find((item) => item.code === 'KOSPI' || item.code === 'KS11')?.rank_weighted || null;
        const kosdaq = indexRes.data.find((item) => item.code === 'KOSDAQ' || item.code === 'KQ11')?.rank_weighted || null;
        setIndicesRS({ kospi, kosdaq });
      }

      const mergedCodes = Array.from(new Set([
        ...(pagedRankRes.data || []).map((row) => row.code),
        ...(reviewRankRes.data || []).map((row) => row.code),
      ]));

      const [compRes, priceRes] = mergedCodes.length > 0
        ? await Promise.all([
            supabase
              .from('companies')
              .select('code, name, marcap')
              .in('code', mergedCodes),
            supabase
              .from('daily_prices_v2')
              .select('code, close')
              .eq('date', dateData.date)
              .in('code', mergedCodes),
          ])
        : [{ data: [] }, { data: [] }];

      const compMap = new Map<string, { code: string; name: string; marcap: number | null }>();
      compRes.data?.forEach((company) => compMap.set(company.code, company));

      const priceMap = new Map<string, number>();
      priceRes.data?.forEach((price) => priceMap.set(price.code, price.close || 0));

      const formatStocks = (rows: RankingRow[]): TableStock[] => rows.map((row) => ({
        code: row.code,
        name: compMap.get(row.code)?.name || row.code,
        rank: row.rank_weighted,
        rs_score: row.rank_weighted,
        close: priceMap.get(row.code) || 0,
        marcap: compMap.get(row.code)?.marcap || 0,
        is_template: null,
        rank_amount: row.rank_amount,
      }));

      const formattedTable = formatStocks(pagedRankRes.data || []);
      const formattedReview = formatStocks(reviewRankRes.data || []);

      if (pagedRankRes.count !== null) {
        setTotalPages(Math.max(1, Math.ceil(pagedRankRes.count / ITEMS_PER_PAGE)));
      }

      setTableData(formattedTable);
      setReviewStocks(formattedReview);
      checkTrendTemplates(formattedTable);

      if (formattedReview.length > 0) {
        setCurrentCompany((prev) => {
          const hasCurrentInReview = formattedReview.some((stock) => stock.code === prev.code);
          if (hasCurrentInReview) {
            return prev;
          }

          const nextCompany = { code: formattedReview[0].code, name: formattedReview[0].name };
          setInputCompany(nextCompany.name);
          return nextCompany;
        });
      } else {
        setTableData([]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setTableLoading(false);
    }
  }, [supabase, minRS, currentPage, checkTrendTemplates]);

  useEffect(() => {
    fetchRankingsAndCompanies();
  }, [fetchRankingsAndCompanies]);

  const fetchChartData = useCallback(async (code: string) => {
    setChartLoading(true);

    try {
      const [dbRes, rsRes] = await Promise.all([
        supabase
          .from('daily_prices_v2')
          .select('date, open, high, low, close, volume')
          .eq('code', code)
          .order('date', { ascending: false })
          .limit(1000),
        supabase
          .from('rs_rankings_v2')
          .select('date, score_weighted')
          .eq('code', code)
          .order('date', { ascending: false })
          .limit(1000),
      ]);

      const dataMap = new Map<string, ChartData>();

      dbRes.data?.forEach((row) => {
        if (!row.date) return;

        let open = Number(row.open);
        let high = Number(row.high);
        let low = Number(row.low);
        const close = Number(row.close);

        if (open === 0 && high === 0 && low === 0) {
          open = close;
          high = close;
          low = close;
        }

        dataMap.set(row.date, {
          time: row.date,
          open,
          high,
          low,
          close,
          volume: Number(row.volume),
        });
      });

      rsRes.data?.forEach((row) => {
        if (!row.date) return;
        const existing = dataMap.get(row.date);
        if (!existing) return;
        dataMap.set(row.date, { ...existing, rs: Number(row.score_weighted) });
      });

      const sorted = Array.from(dataMap.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      setRawDailyData(sorted);
    } catch (error) {
      console.error(error);
      setRawDailyData([]);
    } finally {
      setChartLoading(false);
    }
  }, [supabase]);

  const fetchIndustriesAndThemes = useCallback(async (code: string) => {
    try {
      const [industryRes, themeRes] = await Promise.all([
        supabase
          .from('company_industries')
          .select('industry_id, industries(name)')
          .eq('company_code', code),
        supabase
          .from('company_themes')
          .select('theme_id, themes(name)')
          .eq('company_code', code),
      ]);

      const industryNames = industryRes.data
        ? (industryRes.data as IndustryRelationRow[]).map((item) => item.industries?.name).filter((name): name is string => Boolean(name))
        : [];
      const themeNames = themeRes.data
        ? (themeRes.data as ThemeRelationRow[]).map((item) => item.themes?.name).filter((name): name is string => Boolean(name))
        : [];

      setIndustries(industryNames);
      setThemes(themeNames);
    } catch (error) {
      console.error('Error fetching industries and themes:', error);
      setIndustries([]);
      setThemes([]);
    }
  }, [supabase]);

  useEffect(() => {
    fetchChartData(currentCompany.code);
    fetchIndustriesAndThemes(currentCompany.code);
    setShowAllThemes(false);
  }, [currentCompany, fetchChartData, fetchIndustriesAndThemes]);

  useEffect(() => {
    if (rawDailyData.length === 0) {
      setData([]);
      setLegendData(undefined);
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

    const nextData = targetData.map((point, index) => ({
      ...point,
      ema20: ema[index],
      wma150: wma[index],
      keltner: keltner[index],
      macd: macd[index],
    }));

    setData(nextData);
    setLegendData(nextData[nextData.length - 1]);
  }, [rawDailyData, timeframe]);

  const handleStockClick = (stock: TableStock) => {
    setCurrentCompany({ name: stock.name, code: stock.code });
    setInputCompany(stock.name);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);

    if (!value.trim()) {
      setShowDropdown(false);
      return;
    }

    const filtered = companyList.filter((company) => (
      company.name.includes(value) || company.code.includes(value)
    ));
    setFilteredCompanies(filtered);
    setShowDropdown(true);
  };

  const selectCompany = (company: Company) => {
    setCurrentCompany(company);
    setInputCompany(company.name);
    setShowDropdown(false);
  };

  const toggleFavorite = async () => {
    if (!currentCompany) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    const isFav = favorites.some((fav) => fav.code === currentCompany.code && fav.group === targetGroup);

    if (isFav) {
      const { error } = await supabase
        .from('user_favorite_stocks')
        .delete()
        .eq('user_id', user.id)
        .eq('company_code', currentCompany.code)
        .eq('group_name', targetGroup);

      if (!error) {
        setFavorites((prev) => prev.filter((fav) => !(fav.code === currentCompany.code && fav.group === targetGroup)));
      }
      return;
    }

    const { error } = await supabase
      .from('user_favorite_stocks')
      .insert({
        user_id: user.id,
        company_code: currentCompany.code,
        company_name: currentCompany.name,
        group_name: targetGroup,
      });

    if (!error) {
      setFavorites((prev) => [...prev, { code: currentCompany.code, group: targetGroup }]);
      if (!favGroups.includes(targetGroup)) {
        setFavGroups((prev) => [...prev, targetGroup].sort((a, b) => {
          if (a === '기본 그룹') return -1;
          if (b === '기본 그룹') return 1;
          return a.localeCompare(b);
        }));
      }
    }
  };

  const updateReviewStatus = useCallback((code: string, nextStatus?: ReviewStatus) => {
    setReviewStatusMap((prev) => {
      const currentStatus = prev[code];
      const shouldClear = !nextStatus || currentStatus === nextStatus;
      if (shouldClear) {
        const nextMap = { ...prev };
        delete nextMap[code];
        return nextMap;
      }
      return { ...prev, [code]: nextStatus };
    });
  }, []);

  const moveReview = useCallback((direction: -1 | 1) => {
    if (reviewStocks.length === 0) return;

    if (currentReviewIndex < 0) {
      const targetIndex = direction > 0 ? 0 : reviewStocks.length - 1;
      selectReviewStockByIndex(targetIndex);
      return;
    }

    const nextIndex = currentReviewIndex + direction;
    if (nextIndex < 0 || nextIndex >= reviewStocks.length) return;
    selectReviewStockByIndex(nextIndex);
  }, [currentReviewIndex, reviewStocks.length, selectReviewStockByIndex]);

  const handleArrowAction = useCallback((key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
    if (!currentReviewStock) return;

    if (key === 'ArrowLeft') {
      if (getStockStatus(currentReviewStock.code) === 'candidate') {
        updateReviewStatus(currentReviewStock.code);
      } else {
        updateReviewStatus(currentReviewStock.code, 'excluded');
      }
      return;
    }

    if (key === 'ArrowRight') {
      if (getStockStatus(currentReviewStock.code) === 'excluded') {
        updateReviewStatus(currentReviewStock.code);
      } else {
        updateReviewStatus(currentReviewStock.code, 'candidate');
      }
      return;
    }

    if (key === 'ArrowUp') {
      moveReview(-1);
      return;
    }

    moveReview(1);
  }, [currentReviewStock, getStockStatus, moveReview, updateReviewStatus]);

  const handleTimeframeShortcut = useCallback((key: string) => {
    if (key !== '0') return false;

    setTimeframe((prev) => (prev === 'daily' ? 'weekly' : 'daily'));
    return true;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isTypingTarget = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        if (isTypingTarget) return;
      }

      if (handleTimeframeShortcut(event.key)) {
        event.preventDefault();
        return;
      }

      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      handleArrowAction(event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleArrowAction, handleTimeframeShortcut]);

  const saveReviewCandidates = async () => {
    const candidateStocks = reviewStocks.filter((stock) => reviewStatusMap[stock.code] === 'candidate');

    if (candidateStocks.length === 0) {
      alert('후보 편입된 종목이 없습니다.');
      return;
    }

    const defaultGroupName = latestDate
      ? `${latestDate.slice(2, 4)}${latestDate.slice(5, 7)}${latestDate.slice(8, 10)} 매수후보`
      : '매수후보';
    const groupName = window.prompt('저장할 관심종목 그룹명을 입력하세요.', defaultGroupName);
    const normalizedGroup = groupName?.trim();

    if (!normalizedGroup) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    setSavingReviewGroup(true);

    try {
      const groupExists = favGroups.includes(normalizedGroup);
      if (groupExists) {
        const shouldReplace = window.confirm(`'${normalizedGroup}' 그룹이 이미 있습니다. 기존 종목을 지우고 이번 후보로 다시 저장할까요?`);
        if (!shouldReplace) return;

        const { error: deleteError } = await supabase
          .from('user_favorite_stocks')
          .delete()
          .eq('user_id', user.id)
          .eq('group_name', normalizedGroup);

        if (deleteError) throw deleteError;
      }

      const payload = candidateStocks.map((stock) => ({
        user_id: user.id,
        company_code: stock.code,
        company_name: stock.name,
        group_name: normalizedGroup,
      }));

      const { error: insertError } = await supabase
        .from('user_favorite_stocks')
        .insert(payload);

      if (insertError) throw insertError;

      setFavorites((prev) => {
        const withoutGroup = prev.filter((fav) => fav.group !== normalizedGroup);
        const inserted = candidateStocks.map((stock) => ({ code: stock.code, group: normalizedGroup }));
        return [...inserted, ...withoutGroup];
      });

      setFavGroups((prev) => {
        if (prev.includes(normalizedGroup)) return prev;
        return [...prev, normalizedGroup].sort((a, b) => {
          if (a === '기본 그룹') return -1;
          if (b === '기본 그룹') return 1;
          return a.localeCompare(b);
        });
      });

      setTargetGroup(normalizedGroup);
      setCheckGroup(normalizedGroup);
      alert(`${candidateStocks.length}개 종목을 '${normalizedGroup}' 그룹으로 저장했습니다.`);
    } catch (error) {
      console.error(error);
      alert('관심종목 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingReviewGroup(false);
    }
  };

  const getRowClassName = (stock: TableStock) => {
    const status = getStockStatus(stock.code);
    if (currentCompany.code === stock.code) return 'bg-blue-100';
    if (status === 'candidate') return 'bg-emerald-50';
    if (status === 'excluded') return 'bg-rose-50';
    return '';
  };

  const renderReviewBadge = (code: string) => {
    const status = getStockStatus(code);
    if (status === 'candidate') {
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">후보</span>;
    }
    if (status === 'excluded') {
      return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">제외</span>;
    }
    return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-400">미분류</span>;
  };

  const isFavorite = favorites.some((fav) => fav.code === currentCompany.code && fav.group === targetGroup);

  return (
    <div className="flex h-full overflow-hidden">
      <main className="flex flex-1 gap-3 overflow-hidden">
        <div className="app-card-strong flex w-[30%] min-w-[300px] max-w-[420px] flex-col overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-semibold text-slate-800">종목발굴</h3>
                  {indicesRS.kospi !== null && (
                    <span className="text-[10px] font-normal text-gray-400">
                      KOSPI {indicesRS.kospi} / KOSDAQ {indicesRS.kosdaq}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{reviewStocks.length}개</span>
                  <span>후보 {candidateCount}</span>
                  <span>제외 {excludedCount}</span>
                  <label className="flex items-center gap-1 font-semibold">
                    RS
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={minRS}
                      onChange={(e) => {
                        setMinRS(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="w-12 rounded-xl border border-[var(--border)] bg-white p-1 text-center outline-none focus:border-[var(--primary)]"
                    />
                    이상
                  </label>
                  <span>그룹</span>
                  <select
                    value={checkGroup}
                    onChange={(e) => setCheckGroup(e.target.value)}
                    className="max-w-[110px] rounded-xl border border-[var(--border)] bg-white p-1 outline-none"
                  >
                    {favGroups.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>
                <div className="relative mt-2 max-w-sm">
                  <input
                    type="text"
                    className="app-input text-sm font-semibold"
                    value={inputCompany}
                    onChange={handleSearchChange}
                    onFocus={() => inputCompany && setShowDropdown(true)}
                    placeholder="종목명 또는 코드 검색..."
                  />
                  {showDropdown && filteredCompanies.length > 0 && (
                    <ul className="absolute z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-md)]">
                      {filteredCompanies.map((company) => (
                        <li
                          key={company.code}
                          onClick={() => selectCompany(company)}
                          className="flex cursor-pointer justify-between border-b border-[var(--border)] p-2 text-sm last:border-none hover:bg-[var(--surface-muted)]"
                        >
                          <span className="font-bold text-gray-700">{company.name}</span>
                          <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-400">{company.code}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((page) => page - 1)}
                  className="rounded-xl border border-[var(--border)] bg-white px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  ◀
                </button>
                <input
                  type="text"
                  value={inputPage}
                  onChange={handlePageInput}
                  onKeyDown={handlePageSubmit}
                  className="w-10 rounded-xl border border-[var(--border)] p-1 text-center outline-none focus:border-[var(--primary)]"
                />
                <span className="text-gray-500">/ {totalPages}</span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((page) => page + 1)}
                  className="rounded-xl border border-[var(--border)] bg-white px-2 py-1 hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--text-subtle)]">
                <tr>
                  <th className="px-3 py-2">순위</th>
                  <th className="px-2 py-2">종목</th>
                  <th className="px-2 py-2 text-right">RS</th>
                  <th className="px-2 py-2 text-center">거래대금</th>
                  <th className="px-2 py-2 text-center">Templ.</th>
                  <th className="px-2 py-2 text-center">관심</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {tableLoading ? (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-[var(--text-subtle)]">로딩 중...</td>
                  </tr>
                ) : tableData.map((stock, index) => {
                  const isIncluded = favorites.some((fav) => fav.code === stock.code && fav.group === checkGroup);

                  return (
                    <tr
                      key={stock.code}
                      onClick={() => handleStockClick(stock)}
                      className={`cursor-pointer transition-colors hover:bg-[var(--surface-muted)] ${getRowClassName(stock)}`}
                    >
                      <td className="px-3 py-2 text-gray-500">{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <div>
                          <div className="font-semibold text-slate-900">{stock.name}</div>
                          <div className="text-[9px] text-[var(--text-subtle)]">{stock.code}</div>
                          </div>
                          {renderReviewBadge(stock.code)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-blue-600">{stock.rs_score}</td>
                      <td className="px-2 py-2 text-center font-medium text-gray-600">
                        {stock.rank_amount ? <span title="50일 평균 거래대금 순위 (0~99)">{stock.rank_amount}</span> : '-'}
                      </td>
                      <td className="px-2 py-2 text-center text-base">
                        {stock.is_template === null ? (
                          <span className="animate-pulse text-gray-300">●</span>
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

        <div className="app-card-strong relative flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 p-2">
            <FullscreenPanel>
              <div className="absolute left-3 top-3 right-24 z-10 flex flex-wrap items-start gap-2">
                <div className="rounded-2xl bg-white/92 px-3 py-2 shadow-[var(--shadow-sm)] backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-slate-950">{currentCompany.name}</span>
                    <span className="text-xs font-medium text-[var(--text-muted)]">{currentCompany.code}</span>
                    {currentReviewStock && renderReviewBadge(currentReviewStock.code)}
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                      {currentReviewIndex >= 0 ? `${currentReviewIndex + 1}/${reviewStocks.length}` : `${reviewStocks.length}개`}
                    </span>
                    <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                      {latestDate || '-'}
                    </span>
                    <div className="ml-1 flex items-center gap-1 rounded-[8px] border border-slate-200 bg-white px-1 py-1">
                      <button
                        type="button"
                        onClick={() => chartRef.current?.startDrawing('segment')}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        title="추세선"
                        aria-label="추세선"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <circle cx="6" cy="16" r="1.6" fill="currentColor" stroke="none" />
                          <circle cx="18" cy="8" r="1.6" fill="currentColor" stroke="none" />
                          <path d="M7.5 14.5L16.5 9.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => chartRef.current?.startDrawing('straightLine')}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        title="좌우 연장선"
                        aria-label="좌우 연장선"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <path d="M3 16L21 8" />
                          <path d="M3 16H5" />
                          <path d="M19 8H21" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => chartRef.current?.startDrawing('horizontalStraightLine')}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        title="수평선"
                        aria-label="수평선"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <path d="M4 12H20" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => chartRef.current?.startDrawing('parallelStraightLine')}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        title="평행선"
                        aria-label="평행선"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <path d="M5 16L11 10" />
                          <path d="M10 19L19 10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => chartRef.current?.startDrawing('verticalStraightLine')}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        title="수직선"
                        aria-label="수직선"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <path d="M12 4V20" />
                        </svg>
                      </button>
                      <div className="mx-0.5 h-4 w-px bg-slate-200" />
                      <button
                        type="button"
                        onClick={() => chartRef.current?.clearDrawings()}
                        className="flex h-7 w-7 items-center justify-center rounded-[5px] border border-slate-200 bg-white text-rose-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        title="그린 선 모두 지우기"
                        aria-label="그린 선 모두 지우기"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
                          <path d="M6 6L18 18" />
                          <path d="M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex rounded-xl border border-[var(--border)] bg-white p-[2px]">
                      <button
                        onClick={() => setTimeframe('daily')}
                        title="0"
                        className={`rounded-lg px-2 py-0.5 font-semibold ${timeframe === 'daily' ? 'bg-slate-950 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'}`}
                      >
                        일
                      </button>
                      <button
                        onClick={() => setTimeframe('weekly')}
                        title="0"
                        className={`rounded-lg px-2 py-0.5 font-semibold ${timeframe === 'weekly' ? 'bg-slate-950 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'}`}
                      >
                        주
                      </button>
                    </div>
                    <select
                      value={targetGroup}
                      onChange={(e) => setTargetGroup(e.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-white px-2 py-1 font-semibold text-gray-700 outline-none"
                    >
                      {favGroups.map((group) => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                    <button
                      onClick={toggleFavorite}
                      className={`px-1 text-xl transition-transform hover:scale-110 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                      title={`'${targetGroup}'에 ${isFavorite ? '삭제' : '추가'}`}
                    >
                      {isFavorite ? '⭐' : '☆'}
                    </button>
                    <button
                      onClick={() => handleArrowAction('ArrowLeft')}
                      disabled={!currentReviewStock}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ← 제외
                    </button>
                    <button
                      onClick={() => handleArrowAction('ArrowUp')}
                      disabled={currentReviewIndex <= 0}
                      className="rounded-lg border bg-white px-2.5 py-1.5 font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleArrowAction('ArrowDown')}
                      disabled={currentReviewIndex < 0 || currentReviewIndex >= reviewStocks.length - 1}
                      className="rounded-lg border bg-white px-2.5 py-1.5 font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleArrowAction('ArrowRight')}
                      disabled={!currentReviewStock}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      → 후보
                    </button>
                    <button
                      onClick={saveReviewCandidates}
                      disabled={savingReviewGroup || candidateCount === 0}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      저장
                    </button>
                  </div>
                  {(industries.length > 0 || themes.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {industries.map((industry) => (
                        <span key={industry} className="rounded-full bg-[var(--surface-accent)] px-2 py-0.5 text-[var(--primary)]">
                          {industry}
                        </span>
                      ))}
                      {(showAllThemes ? themes : themes.slice(0, 4)).map((theme) => (
                        <span key={theme} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                          {theme}
                        </span>
                      ))}
                      {themes.length > 4 && (
                        <button
                          onClick={() => setShowAllThemes((prev) => !prev)}
                          className="px-1 font-medium text-[var(--text-muted)] underline hover:text-slate-900"
                        >
                          {showAllThemes ? '접기' : `+${themes.length - 4}`}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    {typeof legendDisplay === 'string' ? (
                      <span className="text-xs text-gray-400">{legendDisplay}</span>
                    ) : (
                      <div className="flex flex-wrap gap-4 text-xs font-medium text-gray-700">
                        <div className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-yellow-500" />
                          <span>EMA(20): {legendDisplay.ema20}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-black" />
                          <span>WMA(150): {legendDisplay.wma150}</span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-gray-300 pl-2">
                          <span className="font-bold text-teal-600">Vol:</span>
                          <span>{legendDisplay.volume}</span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-gray-300 pl-2">
                          <span className="font-bold text-purple-600">RS:</span>
                          <span>{legendDisplay.rs}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {chartLoading ? (
                <div className="flex h-full items-center justify-center text-gray-400">차트 로딩 중...</div>
              ) : data.length > 0 ? (
                <StockChart ref={chartRef} data={data} showLegend={false} onLegendChange={setLegendData} />
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">데이터가 없습니다</div>
              )}
            </FullscreenPanel>
          </div>
        </div>
      </main>
    </div>
  );
}
