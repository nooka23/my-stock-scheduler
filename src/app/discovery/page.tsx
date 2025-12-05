'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';

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

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

export default function DiscoveryPage() {
  const supabase = createClientComponentClient();
  
  // 탭 상태: 'TOP' | 'RISING'
  const [currentTab, setCurrentTab] = useState<'TOP' | 'RISING'>('TOP');
  
  // 급상승 탭 내부 서브탭: 'WEEKLY' | 'MONTHLY'
  const [risingPeriod, setRisingPeriod] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');

  // [신규] 필터링 상태
  const [excludeHighRise, setExcludeHighRise] = useState(false); // 90점 이상 상승 제외
  const [minRs50, setMinRs50] = useState(false);       // 현재 RS 50 이상

  // 전체 데이터와 현재 페이지 데이터 상태 분리
  const [allRankedStocks, setAllRankedStocks] = useState<DailyPrice[]>([]);
  const [displayedStocks, setDisplayedStocks] = useState<DailyPrice[]>([]);
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('1');
  const ITEMS_PER_PAGE = 20;

  const [referenceDate, setReferenceDate] = useState<string>(''); 
  const [comparisonDate, setComparisonDate] = useState<string>(''); // 비교 대상 날짜
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<MyProfile | null>(null);

  // [신규] 유저 프로필 가져오기
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('nickname, is_admin')
          .eq('id', session.user.id)
          .single();
        setUserProfile(data as MyProfile);
      }
    };
    getUser();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // 2. 종목명 및 시가총액 매핑 함수
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

  // 3. RS 랭킹 TOP 데이터 가져오기
  const fetchRankedStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 최신 날짜 가져오기
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

      // 2. 랭킹 데이터 가져오기 (세부 랭킹 포함)
      const { data: rankData, error: rankError } = await supabase
        .from('rs_rankings_v2')
        .select('*') 
        .eq('date', latestDate)
        .order('rank_weighted', { ascending: false });

      if (rankError) throw rankError;

      if (rankData && rankData.length > 0) {
        // 3. 종가 데이터 가져오기
        const codes = rankData.map((r: any) => r.code);
        const { data: priceData } = await supabase
            .from('daily_prices_v2')
            .select('code, close')
            .eq('date', latestDate)
            .in('code', codes);
            
        const priceMap = new Map();
        priceData?.forEach((p: any) => priceMap.set(p.code, p.close));

        // 4. 데이터 병합
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

  // 4. RS 급상승 데이터 가져오기
  const fetchRisingStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 최신 날짜 가져오기
      const { data: dateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();
      
      if (!dateData) throw new Error('랭킹 데이터가 없습니다.');
      const latestDate = dateData.date;
      setReferenceDate(latestDate);

      // 2. 과거 날짜 찾기 (rs_rankings_v2 기준)
      const daysAgo = risingPeriod === 'WEEKLY' ? 5 : 20;
      
      const { data: pastDateData } = await supabase
        .from('rs_rankings_v2')
        .select('date')
        .lt('date', latestDate)
        .eq('code', '005930') // 삼성전자 기준 (데이터가 확실히 있는 종목)
        .order('date', { ascending: false })
        .range(daysAgo - 1, daysAgo - 1)
        .limit(1)
        .maybeSingle();

      if (!pastDateData) throw new Error('비교할 과거 데이터가 부족합니다.');
      const pastDate = pastDateData.date;
      setComparisonDate(pastDate);

      // 3. 두 날짜의 랭킹 데이터 가져오기
      const { data: currData } = await supabase
        .from('rs_rankings_v2')
        .select('code, rank_weighted')
        .eq('date', latestDate);

      const { data: pastData } = await supabase
        .from('rs_rankings_v2')
        .select('code, rank_weighted')
        .eq('date', pastDate);

      if (!currData || !pastData) throw new Error('랭킹 조회 실패');

      // 4. 비교 및 Diff 계산
      const pastMap = new Map();
      pastData.forEach((p: any) => pastMap.set(p.code, p.rank_weighted));

      let risingList: any[] = [];
      const codes: string[] = [];

      currData.forEach((curr: any) => {
          const prevRank = pastMap.get(curr.code);
          if (prevRank !== undefined && prevRank !== null) {
              const diff = curr.rank_weighted - prevRank;
              if (diff > 0) { // 상승한 종목만 (또는 전체 다 보여주고 정렬)
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

      // 5. 종가 가져오기
      if (codes.length > 0) {
          // 종가 조회 (한번에 가져오기엔 많을 수 있으니 risingList가 너무 많으면 잘라야 함)
          // 여기서는 상위 100개만 먼저 추려서 종가 조회하는 게 효율적일 수 있음
          risingList.sort((a: any, b: any) => b.rs_diff - a.rs_diff);
          
          // 상위 200개만 표시한다고 가정 (UI 성능 고려)
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


  // 데이터 슬라이싱 및 페이지네이션 초기화 (필터 적용)
  useEffect(() => {
    setCurrentPage(1); 
    setInputPage('1');
  }, [currentTab, risingPeriod, excludeHighRise, minRs50]); 

  useEffect(() => {
    // 1. 필터링 적용
    let filtered = allRankedStocks;

    if (minRs50) {
        filtered = filtered.filter(s => (s.rs_rating || 0) >= 50);
    }

    if (excludeHighRise && currentTab === 'RISING') {
        filtered = filtered.filter(s => (s.rs_diff || 0) < 90);
    }

    // 2. 페이지네이션 적용
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedStocks(filtered.slice(startIndex, endIndex));
    setInputPage(currentPage.toString());
  }, [allRankedStocks, currentPage, excludeHighRise, minRs50, currentTab]);

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (currentTab === 'TOP') {
      fetchRankedStocks();
    } else {
      fetchRisingStocks();
    }
  }, [currentTab, risingPeriod, fetchRankedStocks, fetchRisingStocks]);


  // 페이지네이션 핸들러들
  const handlePageChange = (newPage: number) => {
    const totalPages = Math.ceil(getFilteredCount() / ITEMS_PER_PAGE);
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };
  const handleInputPageChange = (e: React.ChangeEvent<HTMLInputElement>) => setInputPage(e.target.value);
  const submitPageInput = () => {
    const pageNum = parseInt(inputPage);
    const totalPages = Math.ceil(getFilteredCount() / ITEMS_PER_PAGE);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) setCurrentPage(pageNum);
    else setInputPage(currentPage.toString());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') submitPageInput(); };

  // 필터링된 전체 개수 (페이지네이션 계산용)
  const getFilteredCount = () => {
      let filtered = allRankedStocks;
      if (minRs50) filtered = filtered.filter(s => (s.rs_rating || 0) >= 50);
      if (excludeHighRise && currentTab === 'RISING') filtered = filtered.filter(s => (s.rs_diff || 0) < 90);
      return filtered.length;
  };
  const totalPages = Math.ceil(getFilteredCount() / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex flex-col gap-4 shadow-sm">
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-6">
            <h1 className="text-2xl font-bold text-blue-800">🔍 종목 발굴</h1>
            </div>

            <div className="flex items-center gap-6">
              <nav className="flex gap-4 text-lg">
                  <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">🗓️ 스케줄러</Link>
                  <Link href="/chart" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">📊 밴드 차트 실험실 🏭️</Link>
                  <span className="text-blue-600 font-bold border-b-2 border-blue-600 cursor-default">🔍 종목 발굴</span>
              </nav>

              {userProfile && (
                 <div className="flex items-center gap-3 border-l pl-6">
                   <span className="text-sm text-gray-600">
                     <b>{userProfile.nickname}</b>님
                     {userProfile.is_admin && <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 px-1 rounded border border-purple-200">ADMIN</span>}
                   </span>
                   
                   {userProfile.is_admin && (
                     <div className="flex gap-2">
                       <button onClick={() => window.location.href='/admin/chart'} className="text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded hover:bg-purple-200 font-bold border border-purple-200">
                         📈 분석(Admin)
                       </button>
                       <button onClick={() => window.location.href='/admin'} className="text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-bold">
                         ⚙️ 관리자
                       </button>
                     </div>
                   )}
                   
                   <button onClick={handleLogout} className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">로그아웃</button>
                 </div>
              )}
            </div>
        </div>
        
        {/* 메인 탭 및 필터 */}
        <div className="flex justify-between items-end">
            <div className="flex gap-2">
                <button onClick={() => setCurrentTab('TOP')} className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-all ${currentTab === 'TOP' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    🏆 RS 랭킹 TOP
                </button>
                <button onClick={() => setCurrentTab('RISING')} className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-all ${currentTab === 'RISING' ? 'bg-red-500 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    🔥 RS 랭킹 급상승
                </button>
            </div>

            {/* 필터 체크박스 */}
            <div className="flex gap-4 mb-2">
                {currentTab === 'RISING' && (
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none hover:bg-gray-50 px-2 py-1 rounded">
                        <input 
                            type="checkbox" 
                            checked={excludeHighRise} 
                            onChange={(e) => setExcludeHighRise(e.target.checked)}
                            className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                        />
                        🚀 90점 이상 상승 제외
                    </label>
                )}
                <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none hover:bg-gray-50 px-2 py-1 rounded">
                    <input 
                        type="checkbox" 
                        checked={minRs50} 
                        onChange={(e) => setMinRs50(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    💪 현재 RS 50 이상
                </label>
            </div>
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
                        <p className="text-xs text-gray-400 mt-1">총 {getFilteredCount()}개 종목</p>
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">순위</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">종목명</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">코드</th>
                      
                      {currentTab === 'TOP' ? (
                           <>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">통합 RS</th>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase whitespace-nowrap">3M</th>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase whitespace-nowrap">6M</th>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase whitespace-nowrap">12M</th>
                           </>
                      ) : (
                           <>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">RS 변화</th>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">현재 RS</th>
                             <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">과거 RS</th>
                           </>
                      )}
                      
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">종가</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">시가총액(억)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {displayedStocks.map((stock, index) => (
                      <tr key={stock.code} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-bold">
                          {stock.companies?.name || '알 수 없음'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {stock.code}
                        </td>

                        {currentTab === 'TOP' ? (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-blue-600 text-base">
                                    {stock.rs_rating}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                    {stock.rank_3m ?? '-'}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                    {stock.rank_6m ?? '-'}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                    {stock.rank_12m ?? '-'}
                                </td>
                            </>
                        ) : (
                            <>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-red-600">
                                    +{stock.rs_diff}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                                    {stock.rs_rating}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-400">
                                    {stock.prev_rs}
                                </td>
                            </>
                        )}

                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {stock.close?.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-800">
                          {stock.marcap ? Math.round(stock.marcap / 100000000).toLocaleString() : '-'}
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
