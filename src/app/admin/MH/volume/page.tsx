'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type MomentumStock = {
  code: string;
  avg_20d: number;
  avg_50d: number;
  ratio: number;
  companies: {
    name: string;
  } | null;
};

export default function VolumeDiscoveryPage() {
  const supabase = createClientComponentClient();
  
  const [momentumStocks, setMomentumStocks] = useState<MomentumStock[]>([]);
  const [displayedMomentum, setDisplayedMomentum] = useState<MomentumStock[]>([]);
  
  const [currentMomentumPage, setCurrentMomentumPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  const [momentumLoading, setMomentumLoading] = useState(true);
  const [momentumError, setMomentumError] = useState<string | null>(null);

  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    setCurrentDate(`${year}-${month}-${day}`);
  }, []);

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

  const fetchMomentumStocks = useCallback(async () => {
    setMomentumLoading(true);
    setMomentumError(null);
    try {
        // 상위 40% 필터 (top_percent: 0.4), 최소 비율 1.5배 (min_ratio: 1.5)
        const { data, error } = await supabase.rpc('get_volume_momentum_rank', { min_ratio: 1.5, top_percent: 0.4 });

        if (error) throw error;

        if (data && data.length > 0) {
            const filteredData = data.filter((item: any) => item.code !== 'KOSPI' && item.code !== 'KOSDAQ');
            const mappedData = await mapCompanyNames(filteredData);
            setMomentumStocks(mappedData);
        } else {
            setMomentumStocks([]);
        }
    } catch (err: any) {
        console.error("Momentum Data Load Error:", err.message);
        setMomentumError(err.message || '모멘텀 데이터를 불러오는데 실패했습니다.');
    } finally {
        setMomentumLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
      fetchMomentumStocks();
  }, [fetchMomentumStocks]);

  useEffect(() => {
    const startIndex = (currentMomentumPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    setDisplayedMomentum(momentumStocks.slice(startIndex, endIndex));
  }, [momentumStocks, currentMomentumPage]);

  const totalMomentumPages = Math.ceil(momentumStocks.length / ITEMS_PER_PAGE);

  const formatMoney = (amount: number) => {
      const trillion = Math.floor(amount / 1000000000000);
      const billion = Math.round((amount % 1000000000000) / 100000000);
      if (trillion > 0) return `${trillion}조 ${billion}억`;
      return `${billion}억`;
  };

  const handleStockClick = (code: string) => {
    console.log("Clicked:", code);
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <main className="flex-1 p-4 flex flex-col overflow-hidden">
        
        {/* 거래대금 급증 (모멘텀) 테이블 */}
        <div className="flex-1 bg-white rounded-xl shadow border flex flex-col overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
                <h2 className="text-lg font-bold text-purple-800">🚀 거래대금 급증 (20일/50일)</h2>
                <div className="text-[10px] text-gray-500 mt-1 flex justify-between">
                    <span>조건: 50일평균 상위 40% & 20일평균 {'>'} 50일평균 × 1.5배</span>
                    <span>총 {momentumStocks.length}개 종목</span>
                </div>
                {momentumError && <div className="mt-2 text-xs text-red-500 font-bold bg-red-50 p-2 rounded">{momentumError}</div>}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-[10px] text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-2 py-2 font-medium w-10">순위</th>
                            <th className="px-2 py-2 font-medium">종목명</th>
                            <th className="px-2 py-2 font-medium text-center">증가율</th>
                            <th className="px-2 py-2 font-medium text-right">20일 평균</th>
                            <th className="px-2 py-2 font-medium text-right">50일 평균</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs">
                        {!momentumLoading && displayedMomentum.map((stock, idx) => (
                            <tr 
                                key={stock.code} 
                                className="cursor-pointer hover:bg-purple-50 transition-colors"
                                onClick={() => handleStockClick(stock.code)}
                            >
                                <td className="px-2 py-2 text-gray-500 text-center">{(currentMomentumPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                <td className="px-2 py-2 font-bold text-gray-800 truncate">
                                    {stock.companies?.name}
                                    <div className="text-[9px] text-gray-400 font-normal">{stock.code}</div>
                                </td>
                                <td className="px-2 py-2 text-center font-bold text-purple-600">
                                    {stock.ratio.toFixed(2)}배
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-gray-600">
                                    {formatMoney(stock.avg_20d)}
                                </td>
                                <td className="px-2 py-2 text-right font-mono text-gray-400">
                                    {formatMoney(stock.avg_50d)}
                                </td>
                            </tr>
                        ))}
                        {momentumLoading && <tr><td colSpan={5} className="p-4 text-center text-gray-400 text-xs">로딩 중...</td></tr>}
                        {!momentumLoading && momentumStocks.length === 0 && (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-400 text-xs">조건을 만족하는 종목이 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {/* 페이지네이션 */}
            {totalMomentumPages > 1 && (
                <div className="p-2 border-t bg-gray-50 flex justify-center items-center gap-2 text-[10px]">
                    <button onClick={() => setCurrentMomentumPage(p => Math.max(1, p - 1))} disabled={currentMomentumPage === 1} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&lt;</button>
                    <span className="text-gray-600 font-bold">{currentMomentumPage} / {totalMomentumPages}</span>
                    <button onClick={() => setCurrentMomentumPage(p => Math.min(totalMomentumPages, p + 1))} disabled={currentMomentumPage === totalMomentumPages} className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50">&gt;</button>
                </div>
            )}
        </div>

      </main>
    </div>
  );
}
