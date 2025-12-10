'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type Company = {
  code: string;
  name: string;
  marcap: number;
  avg_volume_50d?: number;
};

type SelectedStock = {
  code: string;
  name: string;
  marcap: number;
};

type SectorIndex = {
  id?: number;
  sector_name: string;
  stocks: SelectedStock[];
  created_at?: string;
};

export default function SectorIndexPage() {
  const supabase = createClientComponentClient();

  // 종목 검색 및 리스트
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // 선택한 종목들
  const [selectedStocks, setSelectedStocks] = useState<SelectedStock[]>([]);

  // 업종 정보
  const [sectorName, setSectorName] = useState('');

  // 저장된 업종 지수 목록
  const [savedSectors, setSavedSectors] = useState<SectorIndex[]>([]);
  const [selectedSector, setSelectedSector] = useState<SectorIndex | null>(null);

  // 전체 종목 불러오기 (50일 평균 거래대금 상위 40%, 상장 60일 이상)
  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      // 1. 최근 날짜 50개 가져오기
      const { data: recentDates } = await supabase
        .from('daily_prices_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(50);

      if (!recentDates || recentDates.length === 0) {
        throw new Error('거래대금 데이터를 불러올 수 없습니다.');
      }

      const dates = [...new Set(recentDates.map(d => d.date))].slice(0, 50);
      const latestDate = dates[0]; // 가장 최근 날짜

      // 2. 해당 날짜들의 거래대금 데이터 가져오기
      const { data: volumeData } = await supabase
        .from('daily_prices_v2')
        .select('code, close, volume')
        .in('date', dates);

      if (!volumeData || volumeData.length === 0) {
        throw new Error('거래대금 데이터를 불러올 수 없습니다.');
      }

      // 3. 종목별 평균 거래대금 계산 (close * volume)
      const volumeByCode = new Map<string, number[]>();

      volumeData.forEach(row => {
        const tradingValue = Number(row.close) * Number(row.volume);
        if (!volumeByCode.has(row.code)) {
          volumeByCode.set(row.code, []);
        }
        volumeByCode.get(row.code)!.push(tradingValue);
      });

      // 4. 평균 계산 및 정렬
      const avgVolumes = Array.from(volumeByCode.entries())
        .map(([code, values]) => ({
          code,
          avg_volume: values.reduce((sum, v) => sum + v, 0) / values.length
        }))
        .filter(item => item.code !== 'KOSPI' && item.code !== 'KOSDAQ')
        .sort((a, b) => b.avg_volume - a.avg_volume);

      // 5. 상위 40%만 선택
      const top40Percent = Math.ceil(avgVolumes.length * 0.4);
      const topStocks = avgVolumes.slice(0, top40Percent);
      const topCodes = topStocks.map(s => s.code);

      // 6. 각 종목의 첫 거래일 조회 (상장 60일 이상 필터링용)
      const { data: firstTradeDates } = await supabase
        .from('daily_prices_v2')
        .select('code, date')
        .in('code', topCodes)
        .order('date', { ascending: true });

      // 종목별 첫 거래일 맵 생성
      const firstDateByCode = new Map<string, string>();
      if (firstTradeDates) {
        firstTradeDates.forEach(row => {
          if (!firstDateByCode.has(row.code)) {
            firstDateByCode.set(row.code, row.date);
          }
        });
      }

      // 7. 상장 60일 이상 종목만 필터링
      const latestDateObj = new Date(latestDate);
      const sixtyDaysAgo = new Date(latestDateObj);
      sixtyDaysAgo.setDate(latestDateObj.getDate() - 60);

      const filtered60DaysStocks = topStocks.filter(stock => {
        const firstDate = firstDateByCode.get(stock.code);
        if (!firstDate) return false; // 거래 기록이 없으면 제외

        const firstDateObj = new Date(firstDate);
        return firstDateObj <= sixtyDaysAgo; // 첫 거래일이 60일 전 이전이어야 함
      });

      // 8. 회사 정보 가져오기
      const filteredCodes = filtered60DaysStocks.map(s => s.code);
      const { data: companiesData } = await supabase
        .from('companies')
        .select('code, name, marcap')
        .in('code', filteredCodes);

      if (companiesData) {
        const companiesWithVolume = companiesData.map(c => {
          const volumeInfo = filtered60DaysStocks.find(s => s.code === c.code);
          return {
            ...c,
            avg_volume_50d: volumeInfo?.avg_volume || 0
          };
        });

        // 거래대금 순으로 정렬
        companiesWithVolume.sort((a, b) => (b.avg_volume_50d || 0) - (a.avg_volume_50d || 0));

        setAllCompanies(companiesWithVolume);
        setFilteredCompanies(companiesWithVolume);
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      // 에러 발생시 기본 회사 목록만 불러오기 (시가총액 순)
      const { data: companiesData } = await supabase
        .from('companies')
        .select('code, name, marcap')
        .order('marcap', { ascending: false })
        .limit(1000);

      if (companiesData) {
        const companiesWithZeroVolume = companiesData.map(c => ({
          ...c,
          avg_volume_50d: 0
        }));
        setAllCompanies(companiesWithZeroVolume);
        setFilteredCompanies(companiesWithZeroVolume);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // 검색 필터링
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredCompanies(allCompanies);
    } else {
      const filtered = allCompanies.filter(
        c => c.name.includes(searchQuery) || c.code.includes(searchQuery)
      );
      setFilteredCompanies(filtered);
    }
  }, [searchQuery, allCompanies]);

  // 종목이 속한 업종들 가져오기
  const getSectorsForStock = (code: string): string[] => {
    return savedSectors
      .filter(sector => sector.stocks.some(stock => stock.code === code))
      .map(sector => sector.sector_name);
  };

  // 종목 선택/해제
  const toggleStock = (company: Company) => {
    const isSelected = selectedStocks.some(s => s.code === company.code);

    if (isSelected) {
      setSelectedStocks(prev => prev.filter(s => s.code !== company.code));
    } else {
      setSelectedStocks(prev => [...prev, {
        code: company.code,
        name: company.name,
        marcap: company.marcap
      }]);
    }
  };

  // 선택 초기화
  const clearSelection = () => {
    setSelectedStocks([]);
    setSectorName('');
  };

  // 업종 저장 (Supabase)
  const saveSector = async () => {
    if (!sectorName.trim()) {
      alert('업종 이름을 입력해주세요.');
      return;
    }

    if (selectedStocks.length === 0) {
      alert('최소 1개 이상의 종목을 선택해주세요.');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      // 1. sector_indices 테이블에 업종 정보 저장
      const { data: sectorData, error: sectorError } = await supabase
        .from('sector_indices')
        .insert({
          user_id: user.id,
          sector_name: sectorName
        })
        .select()
        .single();

      if (sectorError) throw sectorError;

      // 2. sector_stocks 테이블에 종목들 저장
      const stocksToInsert = selectedStocks.map(stock => ({
        sector_id: sectorData.id,
        company_code: stock.code,
        company_name: stock.name,
        marcap: stock.marcap
      }));

      const { error: stocksError } = await supabase
        .from('sector_stocks')
        .insert(stocksToInsert);

      if (stocksError) throw stocksError;

      alert(`${sectorName} 업종이 저장되었습니다. (${selectedStocks.length}개 종목)`);

      // 저장된 업종 목록 다시 불러오기
      fetchSavedSectors();
      clearSelection();
    } catch (error: any) {
      console.error('Error saving sector:', error);
      alert('업종 저장 중 오류가 발생했습니다: ' + error.message);
    }
  };

  // Supabase에서 저장된 업종 불러오기
  const fetchSavedSectors = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. 업종 목록 가져오기
      const { data: sectorsData, error: sectorsError } = await supabase
        .from('sector_indices')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (sectorsError) throw sectorsError;

      if (sectorsData && sectorsData.length > 0) {
        // 2. 각 업종별 종목들 가져오기
        const sectorsWithStocks = await Promise.all(
          sectorsData.map(async (sector) => {
            const { data: stocksData } = await supabase
              .from('sector_stocks')
              .select('*')
              .eq('sector_id', sector.id);

            return {
              id: sector.id,
              sector_name: sector.sector_name,
              created_at: sector.created_at,
              stocks: stocksData?.map(s => ({
                code: s.company_code,
                name: s.company_name,
                marcap: s.marcap
              })) || []
            };
          })
        );

        setSavedSectors(sectorsWithStocks);
      }
    } catch (error) {
      console.error('Error fetching saved sectors:', error);
    }
  }, [supabase]);

  useEffect(() => {
    fetchSavedSectors();
  }, [fetchSavedSectors]);

  // 저장된 업종 불러오기
  const loadSector = (sector: SectorIndex) => {
    setSectorName(sector.sector_name);
    setSelectedStocks(sector.stocks);
    setSelectedSector(sector);
  };

  // 저장된 업종 삭제
  const deleteSector = async (sectorId: number | undefined) => {
    if (!sectorId) return;

    if (confirm('정말 삭제하시겠습니까?')) {
      try {
        const { error } = await supabase
          .from('sector_indices')
          .delete()
          .eq('id', sectorId);

        if (error) throw error;

        // 목록 다시 불러오기
        fetchSavedSectors();
        alert('삭제되었습니다.');
      } catch (error: any) {
        console.error('Error deleting sector:', error);
        alert('삭제 중 오류가 발생했습니다: ' + error.message);
      }
    }
  };

  const formatMarcap = (marcap: number) => {
    const trillion = Math.floor(marcap / 1000000000000);
    const billion = Math.round((marcap % 1000000000000) / 100000000);
    if (trillion > 0) return `${trillion}조 ${billion}억`;
    return `${billion}억`;
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-6 py-4 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800">업종별 지수 관리</h1>
        <p className="text-sm text-gray-500 mt-1">종목을 선택하여 업종별 지수를 생성하세요</p>
      </div>

      <main className="flex-1 p-4 flex gap-4 overflow-hidden">
        {/* 왼쪽: 전체 종목 리스트 */}
        <div className="w-[35%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h2 className="text-lg font-bold text-gray-700 mb-3">종목 검색</h2>
            <input
              type="text"
              className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="종목명 또는 코드 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="text-xs text-gray-500 mt-2">
              {loading ? '로딩 중...' : `총 ${filteredCompanies.length}개 종목`}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
              • 50일 평균 거래대금 상위 40%<br/>
              • 상장 60일 이상 종목
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0">
                <tr>
                  <th className="px-2 py-2">종목명</th>
                  <th className="px-2 py-2 text-right">평균 거래대금</th>
                  <th className="px-2 py-2">업종</th>
                  <th className="px-2 py-2 text-center">선택</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-gray-400">
                      로딩 중...
                    </td>
                  </tr>
                ) : filteredCompanies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-gray-400">
                      검색 결과가 없습니다
                    </td>
                  </tr>
                ) : (
                  filteredCompanies.map((company) => {
                    const isSelected = selectedStocks.some(s => s.code === company.code);
                    const sectors = getSectorsForStock(company.code);
                    return (
                      <tr
                        key={company.code}
                        className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                          isSelected ? 'bg-blue-100' : ''
                        }`}
                        onClick={() => toggleStock(company)}
                      >
                        <td className="px-2 py-2">
                          <div className="font-bold text-gray-800 text-xs">{company.name}</div>
                          <div className="text-[9px] text-gray-400">{company.code}</div>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-blue-600 font-bold text-xs">
                          {formatMarcap(company.avg_volume_50d || 0)}
                        </td>
                        <td className="px-2 py-2">
                          {sectors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sectors.map((sector, idx) => (
                                <span key={idx} className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                  {sector}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[9px] text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleStock(company)}
                            className="w-4 h-4"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 중간: 선택한 종목 리스트 */}
        <div className="w-[35%] bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-blue-50">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold text-blue-800">선택한 종목</h2>
              <button
                onClick={clearSelection}
                className="text-xs px-3 py-1 bg-white border rounded hover:bg-gray-50"
              >
                초기화
              </button>
            </div>

            <input
              type="text"
              className="w-full border p-2 rounded text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none mb-2"
              placeholder="업종 이름 입력 (예: 반도체)"
              value={sectorName}
              onChange={(e) => setSectorName(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                onClick={saveSector}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700 transition-colors"
              >
                저장
              </button>
            </div>

            <div className="text-xs text-blue-700 mt-2 font-bold">
              선택된 종목: {selectedStocks.length}개
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {selectedStocks.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">
                왼쪽 목록에서 종목을 선택하세요
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-2">순번</th>
                    <th className="px-2 py-2">종목명</th>
                    <th className="px-2 py-2 text-right">시가총액</th>
                    <th className="px-2 py-2">업종</th>
                    <th className="px-2 py-2 text-center">삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {selectedStocks.map((stock, idx) => {
                    const sectors = getSectorsForStock(stock.code);
                    return (
                      <tr key={stock.code} className="hover:bg-gray-50">
                        <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                        <td className="px-2 py-2">
                          <div className="font-bold text-gray-800 text-xs">{stock.name}</div>
                          <div className="text-[9px] text-gray-400">{stock.code}</div>
                        </td>
                        <td className="px-2 py-2 text-right text-gray-600 text-xs">
                          {formatMarcap(stock.marcap)}
                        </td>
                        <td className="px-2 py-2">
                          {sectors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sectors.map((sector, idx) => (
                                <span key={idx} className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                  {sector}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[9px] text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => setSelectedStocks(prev => prev.filter(s => s.code !== stock.code))}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: 저장된 업종 목록 */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-green-50">
            <h2 className="text-lg font-bold text-green-800">저장된 업종 목록</h2>
            <div className="text-xs text-green-700 mt-1">
              {savedSectors.length}개 업종
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {savedSectors.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">
                저장된 업종이 없습니다
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {savedSectors.map((sector) => (
                  <div
                    key={sector.id}
                    className="p-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => loadSector(sector)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-gray-800">{sector.sector_name}</h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSector(sector.id);
                        }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        삭제
                      </button>
                    </div>
                    <div className="text-xs text-gray-500">
                      {sector.stocks.length}개 종목
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {sector.stocks.slice(0, 3).map(s => s.name).join(', ')}
                      {sector.stocks.length > 3 && ` 외 ${sector.stocks.length - 3}개`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
