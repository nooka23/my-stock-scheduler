'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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

type GameState = 'idle' | 'playing' | 'answered';

type RankingItem = {
  code: string;
  name: string;
  baseDate: string;
  basePrice: number;
  maxPrice: number;
  returnRate: number;
};

export default function GamePage() {
  const supabase = createClientComponentClient();

  const [gameState, setGameState] = useState<GameState>('idle');
  const [data, setData] = useState<ChartData[]>([]);
  const [fullData, setFullData] = useState<ChartData[]>([]);
  const [rawDailyData, setRawDailyData] = useState<ChartData[]>([]);
  const [rawFullData, setRawFullData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<{ name: string; code: string } | null>(null);
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [userAnswer, setUserAnswer] = useState<boolean | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<boolean | null>(null);
  const [resultMessage, setResultMessage] = useState<string>('');
  const [priceChange, setPriceChange] = useState<number>(0);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');
  const [problemCount, setProblemCount] = useState<number>(0);

  // 랭킹 탭 관련 상태
  const [currentTab, setCurrentTab] = useState<'game' | 'ranking' | 'check' | 'browse'>('game');
  const [rankingData, setRankingData] = useState<RankingItem[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [selectedRankingItem, setSelectedRankingItem] = useState<RankingItem | null>(null);
  const [rankingStartDate, setRankingStartDate] = useState('2021-01-01');
  const [rankingEndDate, setRankingEndDate] = useState('2024-12-31');
  const [rankingMinReturn, setRankingMinReturn] = useState(200);
  const [rankingLimit, setRankingLimit] = useState(100);
  const [rankingError, setRankingError] = useState<string | null>(null);

  // 차트 확인 탭 관련 상태
  const [checkSearchTerm, setCheckSearchTerm] = useState('');
  const [checkSearchResults, setCheckSearchResults] = useState<{code: string, name: string}[]>([]);
  const [checkSelectedCompany, setCheckSelectedCompany] = useState<{code: string, name: string} | null>(null);
  const [checkData, setCheckData] = useState<ChartData[]>([]);
  const [rawCheckData, setRawCheckData] = useState<ChartData[]>([]); // Added this
  const [checkTimeframe, setCheckTimeframe] = useState<'daily' | 'weekly'>('daily');
  const [checkLoading, setCheckLoading] = useState(false);
  const [browseCompanies, setBrowseCompanies] = useState<{ code: string; name: string }[]>([]);
  const [browseCurrent, setBrowseCurrent] = useState<{ code: string; name: string } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseStatuses, setBrowseStatuses] = useState<Record<string, 'keep' | 'skip'>>({});
  const [browseStatusLoaded, setBrowseStatusLoaded] = useState(false);

  // 1년 수익률 100% 이상 종목 조회
  const loadRankingData = useCallback(async () => {
    setRankingLoading(true);
    setRankingError(null);
    try {
      const { data, error } = await supabase.rpc('get_high_return_rankings', {
        start_date: rankingStartDate,
        end_date: rankingEndDate,
        min_return: rankingMinReturn,
        limit_n: rankingLimit
      });

      if (error) {
        setRankingError(error.message);
        setRankingData([]);
        return;
      }

      const results = (data ?? []).map((row: any) => ({
        code: row.code,
        name: row.name,
        baseDate: row.base_date,
        basePrice: Number(row.base_price),
        maxPrice: Number(row.max_price),
        returnRate: Number(row.return_rate)
      })) as RankingItem[];

      setRankingData(results);
    } catch (e) {
      console.error('Ranking load failed:', e);
      setRankingError('Ranking load failed.');
    } finally {
      setRankingLoading(false);
    }
  }, [supabase, rankingStartDate, rankingEndDate, rankingMinReturn, rankingLimit]);

  // 랭킹 탭 선택 시 데이터 로드
  useEffect(() => {
    if (currentTab === 'ranking') {
      loadRankingData();
    }
  }, [currentTab, loadRankingData]);

  // 트렌드 템플릿 체크 함수
  const checkTrendTemplate = async (code: string, selectedDate: string): Promise<boolean> => {
    try {
      // 선택된 날짜 기준으로 과거 265일 데이터 조회
      const { data: prices } = await supabase
        .from('daily_prices_v2')
        .select('close, date')
        .eq('code', code)
        .lte('date', selectedDate)
        .order('date', { ascending: false })
        .limit(265);

      if (!prices || prices.length < 200) return false;

      const closes = prices.map(p => p.close);
      const current = closes[0];

      // 이동평균 계산
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

      if (!ma50 || !ma150 || !ma200 || !ma200_prev) return false;

      const year_slice = closes.slice(0, 260);
      const high_52 = Math.max(...year_slice);
      const low_52 = Math.min(...year_slice);

      // 트렌드 템플릿 8가지 조건
      const c1 = current > ma150 && current > ma200;
      const c2 = ma150 > ma200;
      const c3 = ma200 > ma200_prev;
      const c4 = ma50 > ma150 && ma50 > ma200;
      const c5 = current > ma50;
      const c6 = current >= (low_52 * 1.30);
      const c7 = current >= (high_52 * 0.75);
      const c8 = true; // RS는 이미 80 이상으로 필터링됨

      return c1 && c2 && c3 && c4 && c5 && c6 && c7 && c8;

    } catch (e) {
      console.error('트렌드 템플릿 체크 실패:', e);
      return false;
    }
  };

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
    });

    return Array.from(weeklyMap.values());
  };

  // 무작위 종목 선택
  const selectRandomStock = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = new Date('2021-01-01');
      const endDate = new Date('2024-12-31');

      let attempts = 0;
      const maxAttempts = 100; // 최대 시도 횟수 (트렌드 템플릿 조건 추가로 증가)

      while (attempts < maxAttempts) {
        attempts++;

        // 1. 무작위 날짜 선택 (2021-01-01 ~ 2024-12-31)
        const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime());
        const randomDate = new Date(randomTime);
        const randomDateStr = randomDate.toISOString().split('T')[0];

        // 2. 해당 날짜에 RS 80 이상인 종목 조회
        const { data: rsData } = await supabase
          .from('rs_rankings_with_volume')
          .select('code, date, rank_weighted')
          .eq('date', randomDateStr)
          .gte('rank_weighted', 80);

        if (!rsData || rsData.length === 0) {
          // 해당 날짜에 데이터가 없으면 다시 시도
          continue;
        }

        // 3. 무작위로 종목 선택
        const randomIndex = Math.floor(Math.random() * rsData.length);
        const selected = rsData[randomIndex];

        // 4. 트렌드 템플릿 체크
        const isTrendTemplate = await checkTrendTemplate(selected.code, selected.date);
        if (!isTrendTemplate) {
          continue; // 트렌드 템플릿 미충족 시 다시 시도
        }

        // 5. 회사 정보 조회
        const { data: companyData } = await supabase
          .from('companies')
          .select('name')
          .eq('code', selected.code)
          .single();

        if (!companyData) {
          continue; // 회사 정보 없으면 다시 시도
        }

        setCurrentCompany({ code: selected.code, name: companyData.name });
        setCutoffDate(selected.date);

        // 6. 차트 데이터 로드 (cutoff 날짜까지만)
        await loadChartData(selected.code, selected.date);

        // 7. 문제 카운터 증가
        setProblemCount(prev => prev + 1);

        setGameState('playing');
        return; // 성공하면 종료
      }

      // 최대 시도 횟수 초과
      alert('조건에 맞는 종목을 찾을 수 없습니다. 다시 시도해주세요.');

    } catch (e) {
      console.error(e);
      alert('종목 선택 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 차트 데이터 로드
  const loadChartData = async (code: string, cutoff: string, showFullRange: boolean = false) => {
    try {
      // 날짜 범위 결정
      let endDate: string;
      if (showFullRange) {
        // 랭킹 차트: 가장 최근 날짜까지
        endDate = '2025-12-31'; // 충분히 미래 날짜
      } else {
        // 게임 차트: 1년 후까지만
        const cutoffDateObj = new Date(cutoff);
        const oneYearLater = new Date(cutoffDateObj);
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        endDate = oneYearLater.toISOString().split('T')[0];
      }

      // 전체 데이터 로드
      const dbPromise = supabase.from('daily_prices_v2')
        .select('date, open, high, low, close, volume')
        .eq('code', code)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .limit(1500);

      const rsPromise = supabase.from('rs_rankings_with_volume')
        .select('date, rank_weighted')
        .eq('code', code)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .limit(1500);

      const [dbRes, rsRes] = await Promise.all([dbPromise, rsPromise]);

      const dataMap = new Map();

      dbRes.data?.forEach(row => {
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

      rsRes.data?.forEach(row => {
          if (!row.date) return;
          const existing = dataMap.get(row.date);
          if (existing) {
              dataMap.set(row.date, { ...existing, rs: row.rank_weighted });
          }
      });

      const sorted = Array.from(dataMap.values()).sort((a: any, b: any) =>
        new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      // cutoff 날짜까지만 필터링
      const filteredData = sorted.filter(d => d.time <= cutoff);
      const displayRawData = showFullRange ? sorted : filteredData;

      // Raw data (used for timeframe changes)
      setRawDailyData(displayRawData);
      setRawFullData(sorted);

      const processedData = processChartData(timeframe === 'weekly' ? convertToWeekly(displayRawData) : displayRawData);
      const processedFullData = processChartData(timeframe === 'weekly' ? convertToWeekly(sorted) : sorted);

      if (showFullRange) {
        setData(processedData);
        setFullData(processedData);
      } else {
        // 게임 차트: cutoff까지만 표시
        setData(processedData);
        setFullData(processedFullData);

        // 정답 계산 (cutoff 날짜 가격과 1년 후 최고가 비교)
        const cutoffPrice = sorted.find(d => d.time === cutoff)?.close || 0;
        const oneYearData = sorted.filter(d => d.time > cutoff && d.time <= endDate);
        const maxPriceInYear = Math.max(...oneYearData.map(d => d.high), 0);

        const changePercent = ((maxPriceInYear - cutoffPrice) / cutoffPrice) * 100;
        setPriceChange(changePercent);
        setCorrectAnswer(changePercent >= 50);
      }

    } catch (e) {
      console.error(e);
      alert('차트 데이터 로드 중 오류가 발생했습니다.');
    }
  };

  // 차트 데이터 처리 (지표 계산)

  const browseStatusKey = 'admin_game_browse_status';

  const browseKeepCount = useMemo(
    () => Object.values(browseStatuses).filter(status => status === 'keep').length,
    [browseStatuses]
  );
  const browseSkipCount = useMemo(
    () => Object.values(browseStatuses).filter(status => status === 'skip').length,
    [browseStatuses]
  );
  const browseAvailableCount = useMemo(
    () => browseCompanies.filter(company => !browseStatuses[company.code]).length,
    [browseCompanies, browseStatuses]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      setBrowseStatusLoaded(true);
      return;
    }
    try {
      const stored = localStorage.getItem(browseStatusKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, 'keep' | 'skip'>;
        setBrowseStatuses(parsed);
      }
    } catch {
      setBrowseStatuses({});
    } finally {
      setBrowseStatusLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(browseStatusKey, JSON.stringify(browseStatuses));
  }, [browseStatuses]);

  const loadBrowseCompanies = useCallback(async () => {
    if (browseCompanies.length > 0) return browseCompanies;
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('code, name')
        .range(0, 9999);

      if (error) {
        setBrowseError(error.message);
        return [];
      }

      const list = data ?? [];
      setBrowseCompanies(list);
      return list;
    } catch (e) {
      console.error('Browse companies load failed:', e);
      setBrowseError('Browse companies load failed.');
      return [];
    } finally {
      setBrowseLoading(false);
    }
  }, [supabase, browseCompanies.length]);

  const pickRandomBrowse = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(null);

    const list = browseCompanies.length > 0 ? browseCompanies : await loadBrowseCompanies();
    const available = list.filter(company => !browseStatuses[company.code]);
    if (available.length === 0) {
      setBrowseError('No available companies.');
      setBrowseCurrent(null);
      setBrowseLoading(false);
      return;
    }

    const next = available[Math.floor(Math.random() * available.length)];
    setBrowseCurrent(next);
    await loadChartData(next.code, '2021-01-01', true);
    setBrowseLoading(false);
  }, [browseCompanies, browseStatuses, loadBrowseCompanies, loadChartData]);

  const markBrowseStatus = (status: 'keep' | 'skip') => {
    if (!browseCurrent) return;
    setBrowseStatuses(prev => ({ ...prev, [browseCurrent.code]: status }));
    setBrowseCurrent(null);
  };

  useEffect(() => {
    if (currentTab !== 'browse' || !browseStatusLoaded) return;
    loadBrowseCompanies();
    if (!browseCurrent) {
      pickRandomBrowse();
    }
  }, [currentTab, browseStatusLoaded, loadBrowseCompanies, pickRandomBrowse, browseCurrent]);

  const processChartData = (rawData: ChartData[]): ChartData[] => {
    if (rawData.length === 0) return [];

    let ema, wma;

    ema = calculateEMA(rawData, 20); // EMA는 일봉/주봉 모두 20기간으로 유지

    if (timeframe === 'weekly') {
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

  // timeframe 변경 시 데이터 재처리
  useEffect(() => {
    if (rawDailyData.length === 0) return;

    const currentData = timeframe === 'weekly' ? convertToWeekly(rawDailyData) : rawDailyData;
    const fullCurrentData = timeframe === 'weekly' ? convertToWeekly(rawFullData) : rawFullData;

    const processedData = processChartData(currentData);
    const processedFullData = processChartData(fullCurrentData);

    if (gameState === 'answered') {
      setData(processedFullData);
    } else {
      setData(processedData);
    }
    setFullData(processedFullData);
  }, [timeframe, rawDailyData, rawFullData, gameState]);

  // 검색 핸들러
  const handleCheckSearch = async (term: string) => {
    setCheckSearchTerm(term);
    if (term.length < 1) {
      setCheckSearchResults([]);
      return;
    }
    
    const { data } = await supabase
      .from('companies')
      .select('code, name')
      .ilike('name', `%${term}%`)
      .limit(10);
      
    if (data) setCheckSearchResults(data);
  };

  // 종목 선택 핸들러
  const handleCheckSelect = (company: { code: string, name: string }) => {
    setCheckSelectedCompany(company);
    setCheckSearchResults([]);
    setCheckSearchTerm(company.name);
    loadCheckChartData(company.code);
  };

  // 차트 데이터 로드 (Check 탭용)
  const loadCheckChartData = async (code: string) => {
    setCheckLoading(true);
    try {
        // Fetch data
        const dbPromise = supabase.from('daily_prices_v2')
            .select('date, open, high, low, close, volume')
            .eq('code', code)
            .order('date', { ascending: false })
            .limit(2000);

        const rsPromise = supabase.from('rs_rankings_with_volume')
            .select('date, rank_weighted')
            .eq('code', code)
            .order('date', { ascending: false })
            .limit(2000);

        const [dbRes, rsRes] = await Promise.all([dbPromise, rsPromise]);

        const dataMap = new Map();

        dbRes.data?.forEach(row => {
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

        rsRes.data?.forEach(row => {
            if (!row.date) return;
            const existing = dataMap.get(row.date);
            if (existing) {
                dataMap.set(row.date, { ...existing, rs: row.rank_weighted });
            }
        });

        const sorted = Array.from(dataMap.values()).sort((a: any, b: any) =>
            new Date(a.time).getTime() - new Date(b.time).getTime()
        );

        setRawCheckData(sorted);
        
        const processed = processCheckChartData(
            checkTimeframe === 'weekly' ? convertToWeekly(sorted) : sorted, 
            checkTimeframe
        );
        setCheckData(processed);

    } catch (e) {
        console.error(e);
        alert('데이터 로드 실패');
    } finally {
        setCheckLoading(false);
    }
  };

  // 데이터 처리 (Check 탭용)
  const processCheckChartData = (rawData: ChartData[], tf: 'daily' | 'weekly'): ChartData[] => {
    if (rawData.length === 0) return [];

    const ema = calculateEMA(rawData, 20);
    const wma = calculateWMA(rawData, tf === 'weekly' ? 30 : 150);
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

  // Check 탭 timeframe 변경 효과
  useEffect(() => {
    if (rawCheckData.length === 0) return;
    const currentData = checkTimeframe === 'weekly' ? convertToWeekly(rawCheckData) : rawCheckData;
    const processed = processCheckChartData(currentData, checkTimeframe);
    setCheckData(processed);
  }, [checkTimeframe, rawCheckData]);

  // 답변 제출
  const handleAnswer = async (answer: boolean) => {
    setUserAnswer(answer);
    setGameState('answered');

    // 전체 차트 표시
    setData(fullData);

    // 결과 메시지 생성
    const isCorrect = answer === correctAnswer;
    const msg = isCorrect
      ? `정답입니다! 1년 내 최대 상승률: ${priceChange.toFixed(2)}%`
      : `오답입니다. 1년 내 최대 상승률: ${priceChange.toFixed(2)}%`;
    setResultMessage(msg);
  };

  // 다음 문제
  const handleNext = async () => {
    // 상태 초기화
    setData([]);
    setFullData([]);
    setRawDailyData([]);
    setRawFullData([]);
    setCurrentCompany(null);
    setCutoffDate('');
    setUserAnswer(null);
    setCorrectAnswer(null);
    setResultMessage('');
    setPriceChange(0);
    setTimeframe('daily'); // 일봉으로 리셋
    setGameState('idle');

    // 바로 다음 문제 시작
    await selectRandomStock();
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      <div className="bg-white border-b shrink-0">
        <div className="flex justify-between items-center p-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800">주식 상승 예측 게임</h1>
            {currentTab === 'game' && problemCount > 0 && (
              <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg font-bold text-sm">
                문제 #{problemCount}
              </div>
            )}
            {currentTab === 'game' && currentCompany && (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-blue-600">{currentCompany.name}</span>
                <span className="text-sm text-gray-500">({currentCompany.code})</span>
                <span className="text-sm text-gray-400">기준일: {cutoffDate}</span>
              </div>
            )}
            {currentTab === 'ranking' && selectedRankingItem && (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-blue-600">{selectedRankingItem.name}</span>
                <span className="text-sm text-gray-500">({selectedRankingItem.code})</span>
                <span className="text-sm text-gray-400">기준일: {selectedRankingItem.baseDate}</span>
              </div>
            )}
          </div>

          {currentTab === 'game' && gameState === 'idle' && (
            <button
              onClick={selectRandomStock}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-bold transition-colors"
            >
              {loading ? '로딩 중...' : '게임 시작'}
            </button>
          )}

          {currentTab === 'game' && gameState === 'answered' && (
            <button
              onClick={handleNext}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold transition-colors"
            >
              다음 문제
            </button>
          )}

          {currentTab === 'ranking' && selectedRankingItem && (
            <button
              onClick={() => setSelectedRankingItem(null)}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold transition-colors"
            >
              목록으로
            </button>
          )}
        </div>

        <div className="flex gap-2 px-4 pb-2">
          <button
            onClick={() => setCurrentTab('game')}
            className={`px-6 py-2 font-bold rounded-t-lg transition-colors ${
              currentTab === 'game'
                ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            게임 플레이
          </button>
          <button
            onClick={() => setCurrentTab('ranking')}
            className={`px-6 py-2 font-bold rounded-t-lg transition-colors ${
              currentTab === 'ranking'
                ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            100% 이상 수익률 랭킹
          </button>
          <button
            onClick={() => setCurrentTab('browse')}
            className={`px-6 py-2 font-bold rounded-t-lg transition-colors ${
              currentTab === 'browse'
                ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setCurrentTab('check')}
            className={`px-6 py-2 font-bold rounded-t-lg transition-colors ${
              currentTab === 'check'
                ? 'bg-gray-50 text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            차트 확인
          </button>
        </div>
      </div>

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        {currentTab === 'game' && gameState === 'idle' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-700 mb-4">주식 상승 예측 게임</h2>
              <p className="text-gray-500 mb-2">무작위로 선택된 종목의 차트를 보고</p>
              <p className="text-gray-500 mb-8">1년 안에 50% 이상 상승했는지 맞춰보세요!</p>
              <p className="text-sm text-gray-400 mb-2">게임 조건:</p>
              <ul className="text-sm text-gray-400 text-left inline-block">
                <li>• 기준 날짜: 2021-01-01 ~ 2024-12-31 중 무작위 선택</li>
                <li>• RS 지수: 80점 이상</li>
                <li>• 미너비니 트렌드 템플릿 충족 종목</li>
                <li>• 과거 데이터는 모두 확인 가능</li>
                <li>• 기준일 이후 차트는 정답 확인 후 공개</li>
              </ul>
            </div>
          </div>
        )}

        {currentTab === 'game' && gameState === 'playing' && (
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-700">
                  이 종목은 {cutoffDate} 이후 1년 안에 50% 이상 상승했을까요?
                </h3>
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

              <div className="flex-1 relative w-full h-full min-h-0 bg-white">
                {data.length > 0 ? (
                  <StockChart data={data} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    차트 로딩 중...
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => handleAnswer(true)}
                className="px-8 py-4 bg-red-500 text-white rounded-xl hover:bg-red-600 font-bold text-lg transition-colors shadow-lg"
              >
                50% 이상 상승했다
              </button>
              <button
                onClick={() => handleAnswer(false)}
                className="px-8 py-4 bg-blue-500 text-white rounded-xl hover:bg-blue-600 font-bold text-lg transition-colors shadow-lg"
              >
                50% 미만 상승
              </button>
            </div>
          </div>
        )}

        {currentTab === 'game' && gameState === 'answered' && (
          <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-bold text-gray-700">전체 차트</h3>
                <div className={`text-xl font-bold ${userAnswer === correctAnswer ? 'text-green-600' : 'text-red-600'}`}>
                  {resultMessage}
                </div>
              </div>
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

            <div className="flex-1 relative w-full h-full min-h-0 bg-white">
              {data.length > 0 ? (
                <StockChart data={data} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  차트 로딩 중...
                </div>
              )}
            </div>
          </div>
        )}

        {currentTab === 'ranking' && !selectedRankingItem && (
          <div className="flex-1 bg-white rounded-xl shadow border overflow-hidden flex flex-col">
            <div className="p-4 border-b">
              <h2 className="text-xl font-bold text-gray-800">High Return Rankings</h2>
              <p className="text-sm text-gray-500 mt-1">One-year peak return ranking (filters applied)</p>
              <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Start</span>
                  <input
                    type="date"
                    value={rankingStartDate}
                    onChange={(e) => setRankingStartDate(e.target.value)}
                    className="px-2 py-1 border rounded-md"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">End</span>
                  <input
                    type="date"
                    value={rankingEndDate}
                    onChange={(e) => setRankingEndDate(e.target.value)}
                    className="px-2 py-1 border rounded-md"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Min %</span>
                  <select
                    value={rankingMinReturn}
                    onChange={(e) => setRankingMinReturn(Number(e.target.value))}
                    className="px-2 py-1 border rounded-md"
                  >
                    <option value={100}>100%</option>
                    <option value={200}>200%</option>
                    <option value={300}>300%</option>
                    <option value={500}>500%</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Limit</span>
                  <select
                    value={rankingLimit}
                    onChange={(e) => setRankingLimit(Number(e.target.value))}
                    className="px-2 py-1 border rounded-md"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
                <button
                  onClick={loadRankingData}
                  disabled={rankingLoading}
                  className="px-3 py-2 bg-blue-500 text-white rounded-md font-bold hover:bg-blue-600 disabled:opacity-50"
                >
                  Reload
                </button>
              </div>
              {rankingError && (
                <div className="mt-2 text-sm text-red-600">{rankingError}</div>
              )}

            </div>

            <div className="flex-1 overflow-y-auto">
              {rankingLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <p className="text-lg mb-2">Loading ranking...</p>
                    <p className="text-sm">Computing one-year peak returns on the server.</p>
                  </div>
                </div>
              ) : rankingData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p className="text-lg">데이터가 없습니다.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left">순위</th>
                      <th className="px-4 py-3 text-left">종목명</th>
                      <th className="px-4 py-3 text-left">종목코드</th>
                      <th className="px-4 py-3 text-left">기준일</th>
                      <th className="px-4 py-3 text-right">기준가</th>
                      <th className="px-4 py-3 text-right">최고가</th>
                      <th className="px-4 py-3 text-right">수익률</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rankingData.map((item, idx) => (
                      <tr
                        key={`${item.code}-${item.baseDate}`}
                        onClick={() => {
                          setSelectedRankingItem(item);
                          loadChartData(item.code, item.baseDate, true); // 전체 기간 표시
                        }}
                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-bold text-gray-600">{idx + 1}</td>
                        <td className="px-4 py-3 font-bold text-gray-800">{item.name}</td>
                        <td className="px-4 py-3 text-gray-500">{item.code}</td>
                        <td className="px-4 py-3 text-gray-600">{item.baseDate}</td>
                        <td className="px-4 py-3 text-right font-mono">{item.basePrice.toLocaleString()}원</td>
                        <td className="px-4 py-3 text-right font-mono">{item.maxPrice.toLocaleString()}원</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">
                          +{item.returnRate.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {currentTab === 'ranking' && selectedRankingItem && (
          <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-bold text-gray-700">차트 분석</h3>
                <div className="text-sm text-gray-500">
                  기준가: {selectedRankingItem.basePrice.toLocaleString()}원 →
                  최고가: {selectedRankingItem.maxPrice.toLocaleString()}원
                  <span className="ml-2 font-bold text-red-600">
                    (+{selectedRankingItem.returnRate.toFixed(2)}%)
                  </span>
                </div>
              </div>
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

            <div className="flex-1 relative w-full h-full min-h-0 bg-white">
              {data.length > 0 ? (
                <StockChart data={data} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  차트 로딩 중...
                </div>
              )}
            </div>
          </div>
        )}


        {currentTab === 'browse' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="bg-white p-4 rounded-xl shadow border">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-700">Random Browse</h3>
                  <p className="text-sm text-gray-500 mt-1">Full-range chart per company.</p>
                  <div className="text-sm text-gray-500 mt-1">
                    Available: {browseAvailableCount} | Revisit: {browseKeepCount} | Skip: {browseSkipCount}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={pickRandomBrowse}
                    disabled={browseLoading}
                    className="px-3 py-2 bg-blue-500 text-white rounded-md font-bold hover:bg-blue-600 disabled:opacity-50"
                  >
                    Next Random
                  </button>
                  <button
                    onClick={() => markBrowseStatus('keep')}
                    disabled={!browseCurrent}
                    className="px-3 py-2 bg-green-500 text-white rounded-md font-bold hover:bg-green-600 disabled:opacity-50"
                  >
                    Revisit
                  </button>
                  <button
                    onClick={() => markBrowseStatus('skip')}
                    disabled={!browseCurrent}
                    className="px-3 py-2 bg-gray-500 text-white rounded-md font-bold hover:bg-gray-600 disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setBrowseStatuses({})}
                    className="px-3 py-2 border rounded-md font-bold text-gray-600 hover:bg-gray-50"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {browseError && (
                <div className="mt-2 text-sm text-red-600">{browseError}</div>
              )}
            </div>

            <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-700">
                  {browseCurrent ? `${browseCurrent.name} (${browseCurrent.code})` : 'No company selected'}
                </h3>
                <div className="flex bg-white rounded border border-gray-200 p-[2px]">
                  <button
                    onClick={() => setTimeframe('daily')}
                    className={`px-3 py-1 text-sm font-bold rounded ${timeframe === 'daily' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setTimeframe('weekly')}
                    className={`px-3 py-1 text-sm font-bold rounded ${timeframe === 'weekly' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    Weekly
                  </button>
                </div>
              </div>

              <div className="flex-1 relative w-full h-full min-h-0 bg-white">
                {browseLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    Loading...
                  </div>
                ) : data.length > 0 ? (
                  <StockChart data={data} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    Pick a random company to view the chart.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentTab === 'check' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
             {/* Search Bar */}
             <div className="bg-white p-4 rounded-xl shadow border relative">
                <input
                  type="text"
                  value={checkSearchTerm}
                  onChange={(e) => handleCheckSearch(e.target.value)}
                  placeholder="종목명 검색..."
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {checkSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                    {checkSearchResults.map(company => (
                      <div
                        key={company.code}
                        onClick={() => handleCheckSelect(company)}
                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                      >
                        <span className="font-bold text-gray-700">{company.name}</span>
                        <span className="text-sm text-gray-400">{company.code}</span>
                      </div>
                    ))}
                  </div>
                )}
             </div>

             {/* Chart Area */}
             <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center">
                   <div className="flex items-center gap-4">
                      <h3 className="text-lg font-bold text-gray-700">
                        {checkSelectedCompany ? `${checkSelectedCompany.name} (${checkSelectedCompany.code})` : '종목을 선택해주세요'}
                      </h3>
                   </div>
                   <div className="flex bg-white rounded border border-gray-200 p-[2px]">
                      <button
                        onClick={() => setCheckTimeframe('daily')}
                        className={`px-3 py-1 text-sm font-bold rounded ${checkTimeframe === 'daily' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      >
                        일봉
                      </button>
                      <button
                        onClick={() => setCheckTimeframe('weekly')}
                        className={`px-3 py-1 text-sm font-bold rounded ${checkTimeframe === 'weekly' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      >
                        주봉
                      </button>
                   </div>
                </div>
                
                <div className="flex-1 relative w-full h-full min-h-0 bg-white">
                  {checkLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                      로딩 중...
                    </div>
                  ) : checkData.length > 0 ? (
                    <StockChart data={checkData} showOHLC={true} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                      종목을 검색하여 선택해주세요.
                    </div>
                  )}
                </div>
             </div>
          </div>
        )}
      </main>
    </div>
  );
}
