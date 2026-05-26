'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@/lib/supabase-browser';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

type IndexType = 'theme' | 'industry';

type ThemeIndustry = {
  id: number;
  code: string;
  name: string;
};

type IndexData = {
  date: string;
  index_value: number;
  daily_return: number;
};

type TradingMetricData = {
  date: string;
  trading_value_ratio: number;
  weighted_return: number;
  avg_surge_ratio: number;
  surge_count: number;
  total_stock_count: number;
};

type ChartData = {
  date: string;
  index_value?: number;
  trading_ratio?: number;
  weighted_return?: number;
  surge_ratio?: number;
};

export default function SectorIndexPage() {
  const supabase = createClientComponentClient();

  const [indexType, setIndexType] = useState<IndexType>('industry');
  const [allItems, setAllItems] = useState<ThemeIndustry[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [period, setPeriod] = useState<number>(90); // 기본 3개월

  const [indexData, setIndexData] = useState<IndexData[]>([]);
  const [tradingData, setTradingData] = useState<TradingMetricData[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);

  const [loading, setLoading] = useState(false);
  const [interpretation, setInterpretation] = useState<string>('');

  // 업종/테마 목록 로드
  useEffect(() => {
    const fetchItems = async () => {
      const table = indexType === 'theme' ? 'themes' : 'industries';
      const { data, error } = await supabase
        .from(table)
        .select('id, code, name')
        .order('name');

      if (data && !error) {
        setAllItems(data);
        if (data.length > 0 && !selectedItemId) {
          setSelectedItemId(data[0].id);
        }
      }
    };

    fetchItems();
  }, [indexType, supabase]);

  // 선택한 업종/테마의 데이터 로드
  useEffect(() => {
    if (!selectedItemId) return;

    const fetchData = async () => {
      setLoading(true);

      try {
        // 기간 계산
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - period);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // 1. 가격 지수 데이터 로드
        const indexTable = indexType === 'theme' ? 'theme_indices' : 'industry_indices';
        const idColumn = indexType === 'theme' ? 'theme_id' : 'industry_id';

        const { data: indexRes, error: indexErr } = await supabase
          .from(indexTable)
          .select('date, index_value, daily_return')
          .eq(idColumn, selectedItemId)
          .gte('date', startDateStr)
          .lte('date', endDateStr)
          .order('date', { ascending: true });

        if (indexErr) throw indexErr;
        setIndexData(indexRes || []);

        // 2. 거래대금 지표 데이터 로드
        const tradingTable = indexType === 'theme' ? 'theme_trading_metrics' : 'industry_trading_metrics';

        const { data: tradingRes, error: tradingErr } = await supabase
          .from(tradingTable)
          .select('date, trading_value_ratio, weighted_return, avg_surge_ratio, surge_count, total_stock_count')
          .eq(idColumn, selectedItemId)
          .gte('date', startDateStr)
          .lte('date', endDateStr)
          .order('date', { ascending: true });

        if (tradingErr) throw tradingErr;
        setTradingData(tradingRes || []);

        // 3. 차트 데이터 병합
        mergeChartData(indexRes || [], tradingRes || []);

        // 4. 해석 생성
        generateInterpretation(indexRes || [], tradingRes || []);

      } catch (err) {
        console.error('데이터 로드 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedItemId, period, indexType, supabase]);

  const mergeChartData = (indexData: IndexData[], tradingData: TradingMetricData[]) => {
    const dateMap = new Map<string, ChartData>();

    // 가격 지수 데이터 병합
    indexData.forEach(item => {
      dateMap.set(item.date, {
        date: item.date,
        index_value: item.index_value
      });
    });

    // 거래대금 지표 데이터 병합
    tradingData.forEach(item => {
      const existing = dateMap.get(item.date) || { date: item.date };
      dateMap.set(item.date, {
        ...existing,
        trading_ratio: item.trading_value_ratio,
        weighted_return: item.weighted_return,
        surge_ratio: item.avg_surge_ratio
      });
    });

    const merged = Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    setChartData(merged);
  };

  const generateInterpretation = (indexData: IndexData[], tradingData: TradingMetricData[]) => {
    if (indexData.length === 0 || tradingData.length === 0) {
      setInterpretation('데이터가 부족합니다.');
      return;
    }

    // 최근 데이터
    const latestIndex = indexData[indexData.length - 1];
    const latestTrading = tradingData[tradingData.length - 1];

    // 이전 데이터 (비교용)
    const prevIndex = indexData.length > 5 ? indexData[indexData.length - 6] : indexData[0];
    const prevTrading = tradingData.length > 5 ? tradingData[tradingData.length - 6] : tradingData[0];

    // 가격 추세
    const priceChange = latestIndex.index_value - prevIndex.index_value;
    const priceDirection = priceChange > 0 ? '상승' : priceChange < 0 ? '하락' : '보합';

    // 거래대금 비중 변화
    const ratioChange = latestTrading.trading_value_ratio - prevTrading.trading_value_ratio;
    const ratioDirection = ratioChange > 0.1 ? '증가' : ratioChange < -0.1 ? '감소' : '보합';

    // 가중 수익률
    const weightedReturn = latestTrading.weighted_return;
    const returnDirection = weightedReturn > 0 ? '양수' : weightedReturn < 0 ? '음수' : '0';

    // 급증 비율
    const surgeRatio = latestTrading.avg_surge_ratio;
    const surgeLevel = surgeRatio > 2 ? '과열' : surgeRatio > 1.5 ? '높음' : '정상';

    // 해석 생성
    let text = '';

    if (priceDirection === '상승' && ratioDirection === '증가' && weightedReturn > 0) {
      text = '🟢 강한 자금 유입: 가격 상승 + 거래대금 증가 + 양의 수익률';
    } else if (priceDirection === '상승' && ratioDirection === '감소') {
      text = '🟡 추세 약화 신호: 가격은 오르지만 거래대금 감소';
    } else if (priceDirection === '하락' && ratioDirection === '증가') {
      text = '🔴 약세 속 관심 증가: 가격은 내리지만 거래대금 증가 (반등 가능성)';
    } else if (priceDirection === '하락' && ratioDirection === '감소') {
      text = '🔴 자금 이탈: 가격 하락 + 거래대금 감소';
    } else {
      text = '⚪ 중립: 뚜렷한 방향성 없음';
    }

    text += `\n\n📊 현재 상태:\n`;
    text += `- 지수: ${latestIndex.index_value.toFixed(2)} (${priceDirection})\n`;
    text += `- 거래대금 비중: ${latestTrading.trading_value_ratio.toFixed(2)}% (${ratioDirection})\n`;
    text += `- 가중 수익률: ${weightedReturn.toFixed(2)}% (${returnDirection})\n`;
    text += `- 급증 수준: ${surgeLevel} (${surgeRatio.toFixed(2)}배)`;

    setInterpretation(text);
  };

  const selectedItem = allItems.find(item => item.id === selectedItemId);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            업종/테마 지수 분석
          </h1>
          <p className="text-gray-600">
            커스텀 지수로 업종/테마별 추세와 자금 흐름 파악
          </p>
        </div>

        {/* 컨트롤 패널 */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 유형 선택 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                유형
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setIndexType('industry')}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all ${
                    indexType === 'industry'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  업종
                </button>
                <button
                  onClick={() => setIndexType('theme')}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all ${
                    indexType === 'theme'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  테마
                </button>
              </div>
            </div>

            {/* 항목 선택 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {indexType === 'industry' ? '업종' : '테마'} 선택
              </label>
              <select
                value={selectedItemId || ''}
                onChange={(e) => setSelectedItemId(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {allItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 기간 선택 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                기간
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPeriod(7)}
                  className={`px-3 py-2 text-sm rounded ${
                    period === 7 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  1주
                </button>
                <button
                  onClick={() => setPeriod(30)}
                  className={`px-3 py-2 text-sm rounded ${
                    period === 30 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  1개월
                </button>
                <button
                  onClick={() => setPeriod(90)}
                  className={`px-3 py-2 text-sm rounded ${
                    period === 90 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  3개월
                </button>
                <button
                  onClick={() => setPeriod(180)}
                  className={`px-3 py-2 text-sm rounded ${
                    period === 180 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  6개월
                </button>
                <button
                  onClick={() => setPeriod(365)}
                  className={`px-3 py-2 text-sm rounded ${
                    period === 365 ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  1년
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 해석 요약 */}
        {interpretation && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              📈 {selectedItem?.name} 분석
            </h2>
            <pre className="text-gray-700 whitespace-pre-wrap font-medium">
              {interpretation}
            </pre>
          </div>
        )}

        {/* 로딩 상태 */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-blue-500 text-lg font-bold animate-pulse">
              데이터 로딩 중...
            </div>
          </div>
        )}

        {/* 차트 영역 */}
        {!loading && chartData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 1. 단순 가격 지수 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                1. 단순 가격 지수 (등가중)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="index_value"
                    stroke="#2563eb"
                    name="지수"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 2. 거래대금 비중 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                2. 거래대금 비중 (%)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="trading_ratio"
                    stroke="#10b981"
                    name="거래대금 비중 (%)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 3. 거래대금 가중 수익률 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                3. 거래대금 가중 수익률 (%)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="weighted_return"
                    fill="#f59e0b"
                    name="가중 수익률 (%)"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 4. 거래대금 급증 비율 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                4. 거래대금 급증 비율 (배수)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="surge_ratio"
                    stroke="#ef4444"
                    name="평균 급증 비율 (배)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* 데이터 없음 */}
        {!loading && chartData.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-gray-400 text-lg">
              선택한 {indexType === 'industry' ? '업종' : '테마'}의 데이터가 없습니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
