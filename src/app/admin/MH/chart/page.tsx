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
import { runDetectors, type PatternResult } from '@/utils/patternDetectors';

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
  rank_amount?: number | null;
  patterns?: PatternResult[] | null;  // null = 로딩 중
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

type RsMomentumData = {
  currentRs: number;       // 최신 RS 지수
  rs5dAgo: number;         // 5일 전 RS
  rs20dAgo: number;        // 20일 전 RS
  change5d: number;        // 5일 변화량
  change20d: number;       // 20일 변화량
  streak: number;          // 연속 상승일 수
};

type PatternScanEntry = {
  code: string;
  name: string;
  rs_score: number;
  rank_amount?: number | null;
  patterns: PatternResult[];
  rsMomentum?: RsMomentumData | null;
};

type IndustryRelationRow = {
  industries?: { name?: string | null } | null;
};

type ThemeRelationRow = {
  themes?: { name?: string | null } | null;
};

const ITEMS_PER_PAGE = 20;
const REVIEW_LIMIT = 700;

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
  const [currentPatterns, setCurrentPatterns] = useState<PatternResult[]>([]);

  const [activeView, setActiveView] = useState<'list' | 'cup_handle' | 'vcp' | 'rs_momentum'>('list');
  const [patternScanEntries, setPatternScanEntries] = useState<PatternScanEntry[]>([]);
  const [patternScanProgress, setPatternScanProgress] = useState<{ done: number; total: number } | null>(null);

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

  // reviewStocks(날짜·minRS)가 바뀌면 이전 스캔 결과 초기화
  useEffect(() => {
    setPatternScanEntries([]);
    setPatternScanProgress(null);
  }, [latestDate, minRS]);

  const scanAllPatterns = useCallback(async () => {
    if (reviewStocks.length === 0 || patternScanProgress !== null) return;
    setPatternScanEntries([]);
    setPatternScanProgress({ done: 0, total: reviewStocks.length });

    const isRsMomentumMode = activeView === 'rs_momentum';
    const CHUNK = 10;
    const all: PatternScanEntry[] = [];

    for (let i = 0; i < reviewStocks.length; i += CHUNK) {
      const chunk = reviewStocks.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (stock) => {
          try {
            // RS 상승세 모드: RS 시계열 데이터만 조회
            if (isRsMomentumMode) {
              const { data: rsData } = await supabase
                .from('rs_rankings_v2')
                .select('date, score_weighted')
                .eq('code', stock.code)
                .order('date', { ascending: false })
                .limit(30);

              let rsMomentum: RsMomentumData | null = null;
              if (rsData && rsData.length >= 5) {
                const scores = rsData.map((r) => Number(r.score_weighted));
                const currentRs = scores[0];
                const rs5dAgo = scores.length >= 6 ? scores[5] : scores[scores.length - 1];
                const rs20dAgo = scores.length >= 21 ? scores[20] : scores[scores.length - 1];

                // 연속 상승일 계산: 최근부터 이전 일자 대비 RS가 상승한 연속 일수
                let streak = 0;
                for (let s = 0; s < scores.length - 1; s++) {
                  if (scores[s] > scores[s + 1]) streak++;
                  else break;
                }

                rsMomentum = {
                  currentRs,
                  rs5dAgo,
                  rs20dAgo,
                  change5d: currentRs - rs5dAgo,
                  change20d: currentRs - rs20dAgo,
                  streak,
                };
              }

              return {
                code: stock.code, name: stock.name, rs_score: stock.rs_score,
                rank_amount: stock.rank_amount, patterns: [] as PatternResult[],
                rsMomentum,
              };
            }

            // 일반 패턴 스캔 모드
            const { data: prices } = await supabase
              .from('daily_prices_v2')
              .select('open, high, low, close, volume')
              .eq('code', stock.code)
              .order('date', { ascending: false })
              .limit(500);

            if (!prices || prices.length < 75) {
              return { code: stock.code, name: stock.name, rs_score: stock.rs_score, rank_amount: stock.rank_amount, patterns: [] as PatternResult[] };
            }

            const ohlcv = [...prices].reverse().map((p) => ({
              open: Number(p.open) || Number(p.close),
              high: Number(p.high) || Number(p.close),
              low: Number(p.low) || Number(p.close),
              close: Number(p.close),
              volume: Number(p.volume) || 0,
            }));

            return { code: stock.code, name: stock.name, rs_score: stock.rs_score, rank_amount: stock.rank_amount, patterns: runDetectors(ohlcv) };
          } catch {
            return { code: stock.code, name: stock.name, rs_score: stock.rs_score, rank_amount: stock.rank_amount, patterns: [] as PatternResult[] };
          }
        })
      );

      all.push(...results);
      setPatternScanProgress({ done: Math.min(i + CHUNK, reviewStocks.length), total: reviewStocks.length });
      // 다음 청크 전 짧은 대기로 UI 업데이트 허용
      await new Promise((r) => setTimeout(r, 0));
    }

    setPatternScanEntries(all);
    setPatternScanProgress(null);
  }, [reviewStocks, supabase, patternScanProgress, activeView]);

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
            .select('open, high, low, close, volume')
            .eq('code', stock.code)
            .order('date', { ascending: false })
            .limit(500); // 65주 컵 + 선행 구간 커버 (≈100주)

          if (!prices || prices.length < 200) {
            return { code: stock.code, result: false, patterns: [] as PatternResult[] };
          }

          // 내림차순(최신→과거) 데이터로 트렌드템플릿 계산
          const closes = prices.map((price) => Number(price.close));
          const current = closes[0];

          const headSMA = (arr: number[], period: number) => {
            if (arr.length < period) return null;
            return arr.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
          };

          const ma50 = headSMA(closes, 50);
          const ma150 = headSMA(closes, 150);
          const ma200 = headSMA(closes, 200);
          const ma200PrevSlice = closes.slice(20, 220);
          const ma200Prev = ma200PrevSlice.length === 200
            ? ma200PrevSlice.reduce((acc, v) => acc + v, 0) / 200
            : null;

          const isMet = !!(ma50 && ma150 && ma200 && ma200Prev &&
            current > ma150 &&
            current > ma200 &&
            ma150 > ma200 &&
            ma200 > ma200Prev &&
            ma50 > ma150 &&
            ma50 > ma200 &&
            current > ma50 &&
            current >= Math.min(...closes.slice(0, 260)) * 1.3 &&
            current >= Math.max(...closes.slice(0, 260)) * 0.75 &&
            stock.rs_score >= 70
          );

          // 패턴 감지: 시간순(오래된→최신)으로 뒤집어서 전달
          const chronological = [...prices].reverse();
          const ohlcv = chronological.map((p) => ({
            open: Number(p.open) || Number(p.close),
            high: Number(p.high) || Number(p.close),
            low: Number(p.low) || Number(p.close),
            close: Number(p.close),
            volume: Number(p.volume) || 0,
          }));
          const patterns = runDetectors(ohlcv);

          return { code: stock.code, result: isMet, patterns };
        } catch {
          return { code: stock.code, result: false, patterns: [] as PatternResult[] };
        }
      })
    );

    setTableData((prev) => prev.map((item) => {
      const entry = results.find((r) => r.code === item.code);
      return entry ? { ...item, is_template: entry.result, patterns: entry.patterns } : item;
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
        patterns: null,
      }));

      const formattedTable = formatStocks(pagedRankRes.data || []);
      const formattedReview = formatStocks(reviewRankRes.data || []);

      if (pagedRankRes.count !== null) {
        setTotalPages(Math.max(1, Math.ceil(pagedRankRes.count / ITEMS_PER_PAGE)));
      }

      setTableData(formattedTable);
      setReviewStocks(formattedReview);

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
      setCurrentPatterns([]);
      return;
    }

    // 패턴 감지 — rawDailyData는 이미 시간순(오래된→최신)
    const ohlcv = rawDailyData.map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
    setCurrentPatterns(runDetectors(ohlcv));

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

  const renderPatternBadges = (patterns: PatternResult[] | null | undefined) => {
    if (patterns === null || patterns === undefined) {
      return <span className="animate-pulse text-gray-300">●</span>;
    }
    const detected = patterns.filter((p) => p.detected);
    if (detected.length === 0) return <span className="text-gray-200">‐</span>;
    return (
      <div className="flex flex-wrap gap-0.5">
        {detected.map((p) => (
          <span
            key={p.id}
            title={p.label}
            className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700"
          >
            {p.short}
          </span>
        ))}
      </div>
    );
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
                  <div className="flex rounded-lg border border-[var(--border)] bg-white p-[2px] text-[10px]">
                    {(['list', 'cup_handle', 'vcp', 'rs_momentum'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setActiveView(v)}
                        className={`rounded-md px-2 py-0.5 font-bold transition-colors ${activeView === v ? 'bg-amber-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                      >
                        {v === 'list' ? '목록' : v === 'cup_handle' ? 'C&H' : v === 'vcp' ? 'VCP' : 'RS↑'}
                      </button>
                    ))}
                  </div>
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

              {activeView === 'list' && (
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
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeView === 'list' ? (
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--text-subtle)]">
                  <tr>
                    <th className="px-3 py-2">순위</th>
                    <th className="px-2 py-2">종목</th>
                    <th className="px-2 py-2 text-right">RS</th>
                    <th className="px-2 py-2 text-center">거래대금</th>
                    <th className="px-2 py-2 text-center">관심</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {tableLoading ? (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-[var(--text-subtle)]">로딩 중...</td>
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
                          {isIncluded ? <span className="text-yellow-400">⭐</span> : <span className="text-gray-200">☆</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* 패턴 리스트 뷰 */
              <div className="flex flex-col h-full">
                {patternScanProgress !== null ? (
                  <div className="flex flex-col items-center justify-center gap-3 p-6">
                    <span className="text-sm font-medium text-slate-700">
                      스캔 중... {patternScanProgress.done} / {patternScanProgress.total}
                    </span>
                    <div className="h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-amber-400 transition-all"
                        style={{ width: `${(patternScanProgress.done / patternScanProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : patternScanEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <span className="text-sm text-gray-500">
                      {reviewStocks.length}개 종목에서<br />
                      <strong>{activeView === 'cup_handle' ? '컵앤핸들' : activeView === 'vcp' ? 'VCP' : 'RS 상승세'}</strong> {activeView === 'rs_momentum' ? '종목을 필터링합니다' : '패턴을 검색합니다'}
                    </span>
                    <button
                      onClick={scanAllPatterns}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600"
                    >
                      스캔 시작
                    </button>
                  </div>
                ) : (() => {
                  const patternId = activeView;
                  const matched = patternScanEntries.filter((e) =>
                    activeView === 'rs_momentum'
                      ? (e.rsMomentum != null && e.rsMomentum.currentRs >= 0 && (e.rsMomentum.change5d > 0 || e.rsMomentum.change20d > 0))
                      : e.patterns.some((p) => p.id === patternId && p.detected)
                  ).sort((a, b) => {
                    if (activeView === 'rs_momentum') {
                      // RS 지수가 높은 순서로 정렬
                      const aRs = a.rsMomentum?.currentRs ?? 0;
                      const bRs = b.rsMomentum?.currentRs ?? 0;
                      return bRs - aRs;
                    }
                    return 0;
                  });
                  return (
                    <div className="flex flex-col h-full">
                      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs text-gray-500">
                        <span>{matched.length}개 감지</span>
                        <button
                          onClick={scanAllPatterns}
                          className="text-[10px] text-amber-600 underline hover:text-amber-800"
                        >
                          재스캔
                        </button>
                      </div>
                      {matched.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                          감지된 종목 없음
                        </div>
                      ) : (
                        <table className="w-full border-collapse text-left">
                          <thead className="sticky top-0 z-10 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--text-subtle)]">
                            <tr>
                              {(activeView === 'cup_handle' || activeView === 'vcp' || activeView === 'rs_momentum') ? (
                                <th className="px-2 py-2" colSpan={4}>종목 / 조건</th>
                              ) : (
                                <>
                                  <th className="px-2 py-2">종목</th>
                                  <th className="px-2 py-2 text-right">RS</th>
                                  <th className="px-2 py-2 text-center">거래대금</th>
                                  <th className="px-2 py-2 text-center">관심</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-xs">
                            {matched.map((entry) => {
                              const isIncluded = favorites.some((fav) => fav.code === entry.code && fav.group === checkGroup);
                              const isActive = currentCompany.code === entry.code;
                              const meta = entry.patterns.find((p) => p.id === patternId)?.meta;
                              const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
                              return (
                                <tr
                                  key={entry.code}
                                  onClick={() => handleStockClick({ code: entry.code, name: entry.name, rank: entry.rs_score, rs_score: entry.rs_score, close: 0, marcap: 0 })}
                                  className={`cursor-pointer transition-colors hover:bg-[var(--surface-muted)] ${isActive ? 'bg-blue-100' : ''}`}
                                >
                                  <td className="px-2 py-2" colSpan={(activeView === 'cup_handle' || activeView === 'vcp' || activeView === 'rs_momentum') ? 4 : 1}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <div className="font-semibold text-slate-900">{entry.name}</div>
                                        <div className="text-[9px] text-[var(--text-subtle)]">{entry.code}</div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2 text-[10px]">
                                        <span className="font-bold text-blue-600">{entry.rs_score}</span>
                                        <span className="text-gray-400">{entry.rank_amount ?? '-'}</span>
                                        {isIncluded ? <span className="text-yellow-400">⭐</span> : <span className="text-gray-200">☆</span>}
                                      </div>
                                    </div>
                                    {activeView === 'cup_handle' && meta && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700"
                                          title="컵 왼쪽 이전 선행 상승률">
                                          선행 +{pct(meta.priorGain)}
                                        </span>
                                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700"
                                          title="컵 기간 (주)">
                                          컵 {meta.cupWeeks}주
                                        </span>
                                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700"
                                          title="컵 깊이 (좌림 대비 저점 하락률)">
                                          깊이 {pct(meta.cupDepth)}
                                        </span>
                                        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700"
                                          title="우측 림 / 좌측 림 비율 (80~110%)">
                                          우림 {pct(meta.rightRimRatio)}
                                        </span>
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${meta.vPenalty <= 1 ? 'bg-emerald-50 text-emerald-700' : meta.vPenalty <= 3 ? 'bg-yellow-50 text-yellow-700' : 'bg-rose-50 text-rose-700'}`}
                                          title="V자 페널티 (낮을수록 U자에 가까움)">
                                          V패널티 {meta.vPenalty.toFixed(1)}
                                        </span>
                                        <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-600"
                                          title="핸들 기간 (주)">
                                          핸들 {meta.handleWeeks}주
                                        </span>
                                        <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-600"
                                          title="우측 림 대비 핸들 하락률">
                                          핸들 하락 {pct(meta.handleDrop)}
                                        </span>
                                      </div>
                                    )}
                                    {activeView === 'vcp' && meta && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700"
                                          title="수축 사이클 수 (2~6T)">
                                          {meta.tCount}T
                                        </span>
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600"
                                          title="VCP 기간 (첫 고점 ~ 마지막 저점, 거래일 기준)">
                                          {meta.patternDays}일
                                        </span>
                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700"
                                          title="첫 번째 조정폭 (20~50%)">
                                          T1 -{pct(meta.t1Depth)}
                                        </span>
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${meta.lastDepth <= 0.08 ? 'bg-emerald-50 text-emerald-700' : meta.lastDepth <= 0.15 ? 'bg-yellow-50 text-yellow-700' : 'bg-rose-50 text-rose-700'}`}
                                          title="마지막 조정폭 (작을수록 tight)">
                                          T{meta.tCount} -{pct(meta.lastDepth)}
                                        </span>
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${meta.distFromPivot <= 0.05 ? 'bg-emerald-50 text-emerald-700' : meta.distFromPivot <= 0.10 ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-50 text-gray-600'}`}
                                          title="피벗 고점까지 남은 거리 (작을수록 돌파 근접)">
                                          피벗 -{pct(meta.distFromPivot)}
                                        </span>
                                      </div>
                                    )}
                                    {activeView === 'rs_momentum' && entry.rsMomentum && (() => {
                                      const m = entry.rsMomentum;
                                      const fmtChange = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
                                      return (
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${m.currentRs >= 0.3 ? 'bg-emerald-100 text-emerald-700' : m.currentRs >= 0.1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                                            title="현재 RS 지수">
                                            RS {m.currentRs.toFixed(2)}
                                          </span>
                                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${m.change5d > 0 ? 'bg-emerald-50 text-emerald-700' : m.change5d === 0 ? 'bg-gray-50 text-gray-600' : 'bg-rose-50 text-rose-700'}`}
                                            title="5일 전 대비 RS 변화">
                                            5일 {fmtChange(m.change5d)}
                                          </span>
                                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${m.change20d > 0 ? 'bg-emerald-50 text-emerald-700' : m.change20d === 0 ? 'bg-gray-50 text-gray-600' : 'bg-rose-50 text-rose-700'}`}
                                            title="20일 전 대비 RS 변화">
                                            20일 {fmtChange(m.change20d)}
                                          </span>
                                          {m.streak > 0 && (
                                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${m.streak >= 5 ? 'bg-amber-100 text-amber-700' : m.streak >= 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}
                                              title="RS 연속 상승일">
                                              🔥 {m.streak}일 연속↑
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  {activeView !== 'cup_handle' && activeView !== 'vcp' && activeView !== 'rs_momentum' && (
                                    <>
                                      <td className="px-2 py-2 text-right font-bold text-blue-600">{entry.rs_score}</td>
                                      <td className="px-2 py-2 text-center font-medium text-gray-600">{entry.rank_amount ?? '-'}</td>
                                      <td className="px-2 py-2 text-center text-base">
                                        {isIncluded ? <span className="text-yellow-400">⭐</span> : <span className="text-gray-200">☆</span>}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        <div className="app-card-strong relative flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 p-2">
            <FullscreenPanel>
              <div className="pointer-events-none absolute left-3 top-3 right-24 z-10 flex flex-wrap items-start gap-2">
                <div className="pointer-events-auto rounded-2xl bg-white/92 px-3 py-2 shadow-[var(--shadow-sm)] backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-slate-950">{currentCompany.name}</span>
                    <span className="text-xs font-medium text-[var(--text-muted)]">{currentCompany.code}</span>
                    {currentReviewStock && renderReviewBadge(currentReviewStock.code)}
                    {currentPatterns.filter((p) => p.detected).map((p) => (
                      <span
                        key={p.id}
                        title={p.label}
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                      >
                        {p.label}
                      </span>
                    ))}
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
