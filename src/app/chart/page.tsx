'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import BandChart, { BandSettings } from '@/components/BandChart';

type Company = { code: string; name: string; };

// ★ 재무 데이터 타입 정의
export type FinancialData = {
  year: number;
  eps: number;
  bps: number;
  ops: number; // 계산된 값
};

export default function BandChartPage() {
  const supabase = createClientComponentClient();
  
  // 데이터 상태
  const [stockData, setStockData] = useState<any[]>([]);
  // ★ 수정: 단일 객체가 아니라 배열로 관리
  const [financialHistory, setFinancialHistory] = useState<FinancialData[]>([]); 
  
  // UI 상태
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [inputCompany, setInputCompany] = useState('삼성전자');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  // 밴드 설정 상태
  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  const [multipliers, setMultipliers] = useState<string[]>(['10', '15', '20']);

  // 1. 초기 종목 목록 로드
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies').select('*').order('name').range(0, 9999);
      if (data) setCompanyList(data);
    };
    fetchCompanies();
  }, [supabase]);

  // 2. 종목 데이터 및 재무 데이터 가져오기
  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      // (1) 주가 데이터 (JSON)
      const { data: fileData } = await supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
      if (fileData) {
        const text = await fileData.text();
        setStockData(JSON.parse(text));
      } else {
        setStockData([]);
      }

      // (2) 재무 데이터 (DB) - ★ 전체 기간 가져오기
      const { data: finData } = await supabase
        .from('company_financials')
        .select('*')
        .eq('company_code', code)
        .order('year', { ascending: true }); // 과거부터 오름차순

      if (finData && finData.length > 0) {
        const history = finData.map((d: any) => ({
          year: d.year,
          eps: d.eps || 0,
          bps: d.bps || 0,
          // OPS 계산: 영업이익(억) * 1억 / 주식수 (예외처리 포함)
          ops: (d.op_income && d.shares_outstanding) 
               ? Math.floor(d.op_income * 100000000 / d.shares_outstanding) 
               : 0
        }));
        setFinancialHistory(history);
      } else {
        setFinancialHistory([]);
      }

    } catch (e) {
      console.error(e);
      setStockData([]);
      setFinancialHistory([]);
    }
  }, [supabase]);

  useEffect(() => {
    fetchDatAndFinancials(currentCompany.code);
  }, [currentCompany, fetchDatAndFinancials]);

  // 검색 로직
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputCompany(val);
    if (val.trim()) {
      setFilteredCompanies(companyList.filter(c => c.name.includes(val) || c.code.includes(val)));
      setShowDropdown(true);
    } else setShowDropdown(false);
  };
  const selectCompany = (c: Company) => {
    setCurrentCompany(c); setInputCompany(c.name); setShowDropdown(false);
  };

  // 재무 데이터 수정 핸들러 (연도별 수정 기능은 복잡하므로, 여기서는 '가장 최근 데이터'를 수정하면 미래 추정치로 반영하는 식의 UI가 필요하나, 
  // 일단 전체 데이터를 넘겨주는 구조로 변경함에 집중합니다.)

  const bandSettings: BandSettings = {
    type: bandType,
    financials: financialHistory, // ★ 전체 히스토리 전달
    multipliers: multipliers.map(m => parseFloat(m) || 0)
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-blue-800">📊 밴드 차트 분석</h1>
          <div className="relative w-64">
            <input type="text" className="w-full border p-2 rounded font-bold" value={inputCompany} onChange={handleSearchChange} placeholder="종목 검색..." />
            {showDropdown && (
              <ul className="absolute z-20 w-full bg-white border mt-1 rounded max-h-60 overflow-y-auto shadow-xl">
                {filteredCompanies.map(c => (
                  <li key={c.code} onClick={() => selectCompany(c)} className="p-2 hover:bg-gray-100 cursor-pointer">{c.name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex gap-6 text-lg">
          <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold">🗓️ 스케줄러</Link>
          <span className="text-blue-600 font-bold border-b-2 border-blue-600">📊 밴드 차트</span>
        </div>
      </header>

      <main className="flex-1 p-6 flex gap-6">
        {/* 왼쪽: 컨트롤 패널 */}
        <div className="w-80 bg-white p-6 rounded-xl shadow border h-fit">
          <h2 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">🛠️ 밴드 설정</h2>
          
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">지표 선택</label>
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {['PER', 'PBR', 'POR'].map(type => (
                <button
                  key={type}
                  onClick={() => setBandType(type as any)}
                  className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${bandType === type ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
             <label className="block text-sm font-bold text-gray-700 mb-2">멀티플 (배수) 설정</label>
             <div className="flex flex-col gap-2">
               {multipliers.map((m, idx) => (
                 <div key={idx} className="flex items-center gap-2">
                   <span className={`w-3 h-3 rounded-full ${idx===0?'bg-yellow-500':idx===1?'bg-green-500':'bg-blue-500'}`}></span>
                   <span className="text-sm w-12 text-gray-600 font-bold">Line {idx+1}</span>
                   <input 
                    type="number" 
                    className="flex-1 border p-1.5 rounded text-center"
                    value={m}
                    onChange={(e) => {
                      const newM = [...multipliers];
                      newM[idx] = e.target.value;
                      setMultipliers(newM);
                    }}
                   />
                   <span className="text-sm text-gray-500">배</span>
                 </div>
               ))}
             </div>
          </div>
          
          {/* 재무 데이터 테이블 (간략 보기) */}
          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-bold text-gray-700 mb-2">📅 연도별 데이터 ({bandType})</h3>
            <div className="max-h-60 overflow-y-auto text-xs border rounded bg-gray-50">
              <table className="w-full text-center">
                <thead className="bg-gray-100 font-bold text-gray-600 sticky top-0">
                  <tr>
                    <th className="p-2 border-b">연도</th>
                    <th className="p-2 border-b">값 (원)</th>
                  </tr>
                </thead>
                <tbody>
                  {financialHistory.length > 0 ? financialHistory.map((f) => (
                    <tr key={f.year} className="border-b last:border-none">
                      <td className="p-2">{f.year}</td>
                      <td className="p-2 font-mono">
                        {bandType === 'PER' ? f.eps.toLocaleString() : 
                         bandType === 'PBR' ? f.bps.toLocaleString() : 
                         f.ops.toLocaleString()}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={2} className="p-4 text-gray-400">데이터 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 오른쪽: 차트 영역 */}
        <div className="flex-1 bg-white p-6 rounded-xl shadow border flex flex-col min-h-[600px]">
          <div className="mb-4 flex justify-between items-end">
             <div>
               <h2 className="text-3xl font-bold text-gray-800">{currentCompany.name} <span className="text-xl text-gray-400 font-normal">({currentCompany.code})</span></h2>
             </div>
             <div className="text-right">
                <span className="text-sm font-bold bg-gray-100 px-2 py-1 rounded text-gray-600">
                   {bandType} Band Chart
                </span>
             </div>
          </div>
          
          <div className="flex-1 relative w-full border rounded-lg overflow-hidden bg-gray-50">
             {stockData.length > 0 ? (
               <BandChart data={stockData} settings={bandSettings} />
             ) : (
               <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 로딩 중...</div>
             )}
          </div>
        </div>
      </main>
    </div>
  );
}