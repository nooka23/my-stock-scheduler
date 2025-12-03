'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';

type DailyPrice = {
  date_str: string;
  code: string;
  close: number;
  rs_rating: number;
  companies: {
    name: string;
  } | null; 
  // 급상승 랭킹용 필드 추가
  rs_diff?: number;
  prev_rs?: number;
};

export default function DiscoveryPage() {
  const supabase = createClientComponentClient();
  
  // 탭 상태: 'TOP' | 'RISING'
  const [currentTab, setCurrentTab] = useState<'TOP' | 'RISING'>('TOP');
  
  // 급상승 탭 내부 서브탭: 'WEEKLY' | 'MONTHLY'
  const [risingPeriod, setRisingPeriod] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');

  // 전체 데이터와 현재 페이지 데이터 상태 분리
  const [allRankedStocks, setAllRankedStocks] = useState<DailyPrice[]>([]);
  const [displayedStocks, setDisplayedStocks] = useState<DailyPrice[]>([]);
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('1');
  const ITEMS_PER_PAGE = 20;

  const [referenceDate, setReferenceDate] = useState<string>(''); 
  const [comparisonDate, setComparisonDate] = useState<string>(''); // 비교 대상 날짜
  const [referenceClose, setReferenceClose] = useState<number | null>(null); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. 최신 날짜 가져오는 함수 (공통)
  const getLatestDate = async () => {
    const { data, error } = await supabase
      .from('daily_prices')
      .select('date_str')
      .order('date_str', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) throw new Error('최근 날짜를 가져올 수 없습니다.');
    return data.date_str;
  };

  // 2. 종목명 매핑 함수 (공통)
  const mapCompanyNames = async (stocks: any[]) => {
    const codes = stocks.map((s: any) => s.code);
    let companyNameMap = new Map();
    const chunkSize = 1000;
    
    for (let i = 0; i < codes.length; i += chunkSize) {
        const chunk = codes.slice(i, i + chunkSize);
        const { data: companiesData } = await supabase
        .from('companies')
        .select('code, name')
        .in('code', chunk);

        if (companiesData) {
            companiesData.forEach((c: any) => {
                companyNameMap.set(c.code, c.name);
            });
        }
    }
    
    return stocks.map((stock: any) => ({
        ...stock,
        companies: {
            name: companyNameMap.get(stock.code) || '알 수 없음'
        }
    }));
  };

  // 3. RS 랭킹 TOP 데이터 가져오기
  const fetchRankedStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const latestDate = await getLatestDate();
      setReferenceDate(latestDate);
      setComparisonDate(''); // TOP 탭에선 비교일 없음

      const { data: stocksData, error: stocksError } = await supabase
        .from('daily_prices')
        .select('*') 
        .eq('date_str', latestDate)
        .order('rs_rating', { ascending: false });

      if (stocksError) throw stocksError;

      if (stocksData && stocksData.length > 0) {
        const combinedData = await mapCompanyNames(stocksData);
        setAllRankedStocks(combinedData as DailyPrice[]);
        setReferenceClose(stocksData[0].close);
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

  // 4. RS 급상승 데이터 가져오기
  const fetchRisingStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const latestDate = await getLatestDate();
      setReferenceDate(latestDate);

      // 비교할 날짜 찾기 (영업일 고려)
      // 주간: 5일 전, 월간: 20일 전
      const daysAgo = risingPeriod === 'WEEKLY' ? 5 : 20;
      
      // 단순히 date calculation으로는 휴장일 제외가 어려우므로,
      // date_str 기준 내림차순으로 N번째 날짜를 DB에서 가져옴
      const { data: pastDateData, error: pastDateError } = await supabase
        .from('daily_prices')
        .select('date_str')
        .lt('date_str', latestDate) // 최신일보다 과거
        .order('date_str', { ascending: false })
        .range(daysAgo - 1, daysAgo - 1) // N번째 (0-index이므로 -1)
        .limit(1)
        .single(); // single() 사용 시 데이터 없으면 에러 발생할 수 있음 -> maybeSingle 사용 권장하지만 여기선 try-catch

      if (pastDateError || !pastDateData) {
        // 데이터 부족 시 가장 오래된 데이터라도 가져오거나 에러 처리
        throw new Error('비교할 과거 데이터가 충분하지 않습니다.');
      }
      
      const pastDate = pastDateData.date_str;
      setComparisonDate(pastDate);

      // 두 날짜의 데이터 가져오기 (병렬 처리)
      const currentPromise = supabase
        .from('daily_prices')
        .select('code, rs_rating, close')
        .eq('date_str', latestDate);

      const pastPromise = supabase
        .from('daily_prices')
        .select('code, rs_rating')
        .eq('date_str', pastDate);

      const [currRes, pastRes] = await Promise.all([currentPromise, pastPromise]);
      
      if (currRes.error) throw currRes.error;
      if (pastRes.error) throw pastRes.error;

      // 매핑 및 차이 계산
      const pastMap = new Map();
      pastRes.data?.forEach((p: any) => pastMap.set(p.code, p.rs_rating));

      let risingList = [];
      if (currRes.data) {
        for (const curr of currRes.data) {
            const prevRs = pastMap.get(curr.code);
            // 두 날짜 모두 RS 점수가 있어야 함
            if (curr.rs_rating !== null && prevRs !== null && prevRs !== undefined) {
                const diff = curr.rs_rating - prevRs;
                risingList.push({
                    ...curr,
                    date_str: latestDate,
                    rs_diff: diff,
                    prev_rs: prevRs
                });
            }
        }
      }

      // 급상승 순(diff 내림차순) 정렬
      risingList.sort((a, b) => b.rs_diff - a.rs_diff);

      if (risingList.length > 0) {
        const combinedData = await mapCompanyNames(risingList);
        setAllRankedStocks(combinedData as DailyPrice[]);
      } else {
        setAllRankedStocks([]);
      }

    } catch (err: any) {
      console.error("RISING 로딩 실패:", err.message);
      setError('급상승 데이터를 계산할 수 없습니다 (과거 데이터 부족 등).');
    } finally {
      setLoading(false);
    }
  }, [supabase, risingPeriod]);


  // 데이터 슬라이싱 및 페이지네이션 초기화
  useEffect(() => {
    setCurrentPage(1); // 탭이나 데이터 바뀌면 1페이지로
    setInputPage('1');
  }, [currentTab, risingPeriod]); // allRankedStocks가 바뀔 때마다가 아니라 탭 바뀔 때만 초기화 (데이터 로딩 시점 고려)

  useEffect(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedStocks(allRankedStocks.slice(startIndex, endIndex));
    setInputPage(currentPage.toString());
  }, [allRankedStocks, currentPage]);

  // 탭 변경 시 데이터 로치
  useEffect(() => {
    if (currentTab === 'TOP') {
      fetchRankedStocks();
    } else {
      fetchRisingStocks();
    }
  }, [currentTab, risingPeriod, fetchRankedStocks, fetchRisingStocks]);


  // 페이지네이션 핸들러들
  const handlePageChange = (newPage: number) => {
    const totalPages = Math.ceil(allRankedStocks.length / ITEMS_PER_PAGE);
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };
  const handleInputPageChange = (e: React.ChangeEvent<HTMLInputElement>) => setInputPage(e.target.value);
  const submitPageInput = () => {
    const pageNum = parseInt(inputPage);
    const totalPages = Math.ceil(allRankedStocks.length / ITEMS_PER_PAGE);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) setCurrentPage(pageNum);
    else setInputPage(currentPage.toString());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') submitPageInput(); };

  const totalPages = Math.ceil(allRankedStocks.length / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex flex-col gap-4 shadow-sm">
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-6">
            <h1 className="text-2xl font-bold text-blue-800">🔍 종목 발굴</h1>
            <nav className="flex gap-4 text-lg">
                <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">🗓️ 스케줄러</Link>
                <Link href="/chart" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">📊 밴드 차트 실험실 🏭️</Link>
                <span className="text-blue-600 font-bold border-b-2 border-blue-600 cursor-default">🔍 종목 발굴</span>
            </nav>
            </div>
        </div>
        
        {/* 메인 탭 */}
        <div className="flex gap-2">
            <button onClick={() => setCurrentTab('TOP')} className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-all ${currentTab === 'TOP' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                🏆 RS 랭킹 TOP
            </button>
            <button onClick={() => setCurrentTab('RISING')} className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-all ${currentTab === 'RISING' ? 'bg-red-500 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                🔥 RS 랭킹 급상승
            </button>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col gap-4">
        <div className="bg-white p-6 rounded-xl shadow-md border flex-1 relative flex flex-col">
          
          {/* 탭별 헤더 영역 */}
          <div className="flex flex-col mb-4">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 mb-1">
                        {currentTab === 'TOP' ? '🚀 RS 랭킹 TOP' : '🔥 RS 랭킹 급상승'}
                    </h2>
                    
                    {/* 급상승 탭일 때 서브탭 표시 */}
                    {currentTab === 'RISING' && (
                        <div className="flex gap-2 my-2">
                             <button 
                                onClick={() => setRisingPeriod('WEEKLY')}
                                className={`text-xs px-3 py-1 rounded-full border font-bold ${risingPeriod === 'WEEKLY' ? 'bg-red-100 text-red-700 border-red-300' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                             >
                                📅 주간 (5일 전 대비)
                             </button>
                             <button 
                                onClick={() => setRisingPeriod('MONTHLY')}
                                className={`text-xs px-3 py-1 rounded-full border font-bold ${risingPeriod === 'MONTHLY' ? 'bg-red-100 text-red-700 border-red-300' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                             >
                                🗓️ 월간 (20일 전 대비)
                             </button>
                        </div>
                    )}

                    <p className="text-gray-500 text-sm mt-1">
                        {currentTab === 'TOP' 
                            ? "최근 시장의 강세 종목들을 RS(Relative Strength) 지수 기준으로 정렬했습니다."
                            : `과거(${comparisonDate}) 대비 RS 랭킹 점수가 가장 많이 오른 종목들입니다.`
                        }
                    </p>
                </div>

                {/* 기준일 표시 */}
                {referenceDate && (
                    <div className="text-right">
                        <p className="text-sm text-gray-600">
                            기준일 : {referenceDate} (종가)
                        </p>
                        {currentTab === 'RISING' && comparisonDate && (
                             <p className="text-xs text-red-500 mt-1">
                                비교일 : {comparisonDate}
                             </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">총 {allRankedStocks.length}개 종목</p>
                    </div>
                )}
            </div>
          </div>

          {/* 로딩 및 에러 */}
          {loading && <div className="flex items-center justify-center h-full text-gray-500">데이터를 분석 중입니다...</div>}
          {error && <div className="flex items-center justify-center h-full text-red-500">오류: {error}</div>}
          {!loading && !error && allRankedStocks.length === 0 && <div className="flex items-center justify-center h-full text-gray-500">데이터가 없습니다.</div>}

          {/* 테이블 */}
          {!loading && !error && displayedStocks.length > 0 && (
            <>
              <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
                <table className="min-w-full divide-y divide-gray-200 sticky top-0">
                  <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">순위</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">종목명</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">코드</th>
                      
                      {/* 탭에 따라 컬럼 다르게 표시 */}
                      {currentTab === 'TOP' ? (
                           <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">RS 랭킹</th>
                      ) : (
                           <>
                             <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">RS 변화량</th>
                             <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">현재 RS</th>
                             <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">과거 RS</th>
                           </>
                      )}
                      
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">종가</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {displayedStocks.map((stock, index) => (
                      <tr key={stock.code} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">
                          {stock.companies?.name || '알 수 없음'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {stock.code}
                        </td>

                        {currentTab === 'TOP' ? (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-600">
                                {stock.rs_rating}
                            </td>
                        ) : (
                            <>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-red-600">
                                    +{stock.rs_diff}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">
                                    {stock.rs_rating}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
                                    {stock.prev_rs}
                                </td>
                            </>
                        )}

                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">
                          {stock.close?.toLocaleString()}원
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              <div className="flex justify-center items-center gap-2 mt-4 pt-4 border-t">
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 text-sm font-bold text-gray-600">&lt;</button>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-600">Page</span>
                  <input type="text" className="w-12 border rounded p-1 text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" value={inputPage} onChange={handleInputPageChange} onBlur={submitPageInput} onKeyDown={handleKeyDown} />
                  <span className="text-sm text-gray-600">of {totalPages}</span>
                </div>
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 text-sm font-bold text-gray-600">&gt;</button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}