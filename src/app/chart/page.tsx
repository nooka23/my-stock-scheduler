'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import BandChart, { BandSettings } from '@/components/BandChart';

type Company = { code: string; name: string; };

export type FinancialData = {
  year: number;
  net_income: number; // 당기순이익 (원)
  equity: number;     // 자본총계 (원)
  op_income: number;  // 영업이익 (원)
  shares: number;     // 주식수
  eps: number;
  bps: number;
  ops: number;
};

// 기본 멀티플 반환 함수
const getDefaultMultipliers = (type: 'PER' | 'PBR' | 'POR') => {
  if (type === 'PBR') return ['0.5', '1.0', '2.0'];
  return ['10', '15', '20'];
};

export default function BandChartPage() {
  const supabase = createClientComponentClient();
  
  // 데이터 상태
  const [stockData, setStockData] = useState<any[]>([]);
  const [financialHistory, setFinancialHistory] = useState<FinancialData[]>([]); 
  
  // UI 상태
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [inputCompany, setInputCompany] = useState('삼성전자');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  // 밴드 설정 상태
  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  
  // ★ [변경] isUserMode를 false로 고정 (서버 원본 보기 전용)
  const isUserMode = false; 
  
  const [multipliers, setMultipliers] = useState<string[]>(getDefaultMultipliers('PER'));

  // 1. 초기 종목 목록 로드
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies').select('*').order('name').range(0, 9999);
      if (data) setCompanyList(data);
    };
    fetchCompanies();
  }, [supabase]);

  // 2. 데이터 가져오기 (주가 + 재무 원본)
  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      // (1) 주가 데이터
      const { data: fileData } = await supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
      if (fileData) {
        setStockData(JSON.parse(await fileData.text()));
      } else {
        setStockData([]);
      }

      // (2) 재무 데이터 (전체 기간)
      const { data: finData } = await supabase
        .from('company_financials')
        .select('*')
        .eq('company_code', code)
        .order('year', { ascending: true });

      if (finData && finData.length > 0) {
        const history: FinancialData[] = finData.map((d: any) => ({
          year: d.year,
          net_income: d.net_income || 0,
          equity: d.equity || 0,
          op_income: d.op_income || 0,
          shares: d.shares_outstanding || 1,
          
          eps: d.eps || 0,
          bps: d.bps || 0,
          ops: (d.op_income && d.shares_outstanding) 
               ? Math.floor(d.op_income / d.shares_outstanding)
               : 0
        }));
        
        // 데이터 보정
        history.forEach(h => {
           if (h.shares > 0) {
             if (!h.eps) h.eps = Math.floor(h.net_income / h.shares);
             if (!h.bps) h.bps = Math.floor(h.equity / h.shares);
             if (!h.ops) h.ops = Math.floor(h.op_income / h.shares);
           }
        });

        return history;
      }
      return [];
    } catch (e) {
      console.error(e);
      setStockData([]);
      return [];
    }
  }, [supabase]);


  // 3. 통합 로드 로직 (단순화됨: 무조건 원본 데이터 로드)
  useEffect(() => {
    const loadAll = async () => {
      // 서버 원본 데이터 로드
      const originalData = await fetchDatAndFinancials(currentCompany.code);
      setFinancialHistory(originalData);
      
      // 멀티플은 탭 바뀔 때마다 기본값으로 초기화 (사용자가 조절은 가능)
      setMultipliers(getDefaultMultipliers(bandType));
    };
    loadAll();
  }, [currentCompany, bandType, fetchDatAndFinancials]);


  // 검색 핸들러
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setInputCompany(val);
    if (val.trim()) { setFilteredCompanies(companyList.filter(c => c.name.includes(val) || c.code.includes(val))); setShowDropdown(true); } else setShowDropdown(false);
  };
  const selectCompany = (c: Company) => { setCurrentCompany(c); setInputCompany(c.name); setShowDropdown(false); };

  // 렌더링 준비
  const getTabLabel = () => {
    if (bandType === 'PER') return { input: '당기순이익', unit: '억원', output: 'EPS' };
    if (bandType === 'PBR') return { input: '자본총계', unit: '억원', output: 'BPS' };
    return { input: '영업이익', unit: '억원', output: 'OPS' };
  };
  const labels = getTabLabel();

  const bandSettings: BandSettings = {
    type: bandType,
    financials: financialHistory,
    multipliers: multipliers.map(m => parseFloat(m) || 0)
  };
  
  const latestData = financialHistory.length > 0 ? financialHistory[financialHistory.length - 1] : null;
  const currentBaseValue = latestData ? (bandType === 'PER' ? latestData.eps : bandType === 'PBR' ? latestData.bps : latestData.ops) : 0;

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

      <main className="flex-1 p-6 flex gap-6 overflow-hidden">
        {/* 컨트롤 패널 */}
        <div className="w-96 bg-white p-6 rounded-xl shadow border h-full flex flex-col relative transition-all overflow-y-auto">
          <h2 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2 flex justify-between items-center">
             <span>🛠️ 밴드 설정</span>
             {/* ★ 현재 모드 표시 (고정) */}
             <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">🏢 서버 원본 보기</span>
          </h2>

          {/* 지표 탭 */}
          <div className="mb-6">
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

          {/* 연도별 데이터 입력 (읽기 전용) */}
          <div className="mb-6">
             <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-gray-700">📅 연도별 {labels.input} (단위: {labels.unit})</label>
             </div>
             <div className="border rounded-lg overflow-hidden bg-gray-50">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50 text-blue-800 font-bold">
                    <tr><th className="p-2 border-r border-blue-100 w-16 text-center">연도</th><th className="p-2 text-center">{labels.input}</th></tr>
                  </thead>
                </table>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {financialHistory.map((item) => {
                        let valInWon = 0;
                        if (bandType === 'PER') valInWon = item.net_income;
                        else if (bandType === 'PBR') valInWon = item.equity;
                        else if (bandType === 'POR') valInWon = item.op_income;
                        
                        const valInBillions = (valInWon / 100000000).toFixed(0); 

                        return (
                          <tr key={item.year} className="border-b last:border-none">
                            <td className="p-2 border-r bg-gray-50 font-bold text-center w-16">{item.year}</td>
                            <td className="p-1">
                              {/* ★ 읽기 전용 입력창 */}
                              <input 
                                type="number" 
                                readOnly={true} 
                                className="w-full text-right p-1 outline-none font-mono bg-transparent text-gray-600 cursor-default"
                                value={valInBillions}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
             </div>
          </div>

          {/* 멀티플 설정 (수정 가능) */}
          <div className="mb-6">
             <label className="block text-sm font-bold text-gray-700 mb-2">멀티플 (배수) 설정</label>
             <div className="flex flex-col gap-2">
               {multipliers.map((m, idx) => (
                 <div key={idx} className="flex items-center gap-2">
                   <span className={`w-3 h-3 rounded-full ${idx===0?'bg-yellow-500':idx===1?'bg-green-500':'bg-blue-500'}`}></span>
                   <span className="text-sm w-12 text-gray-600 font-bold">Line {idx+1}</span>
                   <input 
                    type="number" 
                    className="flex-1 border p-1.5 rounded text-center font-medium outline-none focus:border-blue-500 bg-white"
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
          
          {/* ★ 저장 버튼 제거됨 */}
          <div className="bg-blue-50 p-3 rounded text-xs text-blue-600 text-center font-medium mb-6">
            💡 현재는 서버 데이터 조회만 가능합니다.
          </div>

          {/* 계산 결과 */}
          <div className="border-t pt-4 flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-bold text-gray-700 mb-2">📉 계산된 지표 ({bandType}, {labels.output})</h3>
            <div className="overflow-y-auto text-xs border rounded bg-gray-50 flex-1">
              <table className="w-full text-center">
                <thead className="bg-gray-100 font-bold text-gray-600 sticky top-0">
                  <tr><th className="p-2 border-b">연도</th><th className="p-2 border-b">{labels.output} (원)</th></tr>
                </thead>
                <tbody>
                  {financialHistory.length > 0 ? financialHistory.map((f) => (
                    <tr key={f.year} className="border-b last:border-none hover:bg-white">
                      <td className="p-2">{f.year}</td>
                      <td className="p-2 font-mono font-bold text-blue-900">
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

        {/* 차트 영역 */}
        <div className="flex-1 bg-white p-6 rounded-xl shadow border flex flex-col min-h-[600px]">
          <div className="mb-4 flex justify-between items-end">
             <div>
               <h2 className="text-3xl font-bold text-gray-800">{currentCompany.name} <span className="text-xl text-gray-400 font-normal">({currentCompany.code})</span></h2>
               <p className="text-gray-500 text-sm mt-1">
                 {financialHistory.length > 0 && `최신 ${labels.output}: ${currentBaseValue.toLocaleString()}원`} × [{multipliers.join(', ')}] 배
               </p>
             </div>
             <div className="text-right">
                <span className="text-sm font-bold px-2 py-1 rounded bg-gray-200 text-gray-600">
                   🏢 Server {bandType} Band
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