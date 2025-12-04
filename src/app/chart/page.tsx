'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import BandChart, { BandSettings } from '@/components/BandChart';

type Company = { code: string; name: string; };

// [신규] 즐겨찾기 타입
type FavoriteStock = {
  code: string;
  name: string;
};

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
  
  // 상태 관리 분리
  const [serverFinancials, setServerFinancials] = useState<FinancialData[]>([]); // 원본
  const [userFinancials, setUserFinancials] = useState<FinancialData[]>([]);     // 사용자 커스텀
  const [financialHistory, setFinancialHistory] = useState<FinancialData[]>([]); // 현재 표시용
  
  const [viewMode, setViewMode] = useState<'server' | 'user'>('server');
  const [isSaving, setIsSaving] = useState(false);

  // UI 상태
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [inputCompany, setInputCompany] = useState('삼성전자');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  // [신규] 즐겨찾기 상태
  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);

  // 밴드 설정 상태
  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  
  const [multipliers, setMultipliers] = useState<string[]>(getDefaultMultipliers('PER'));

  // 1. 초기 종목 목록 로드
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies').select('*').order('name').range(0, 9999);
      if (data) setCompanyList(data);
    };
    fetchCompanies();
  }, [supabase]);

  // [신규] 즐겨찾기 목록 불러오기
  const loadFavorites = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('user_favorite_stocks')
      .select('company_code, company_name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (data) {
      setFavorites(data.map(item => ({
        code: item.company_code,
        name: item.company_name
      })));
    }
  }, [supabase]);

  // 초기 로드 시 즐겨찾기 가져오기
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // [신규] 즐겨찾기 토글 핸들러
  const toggleFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요한 기능입니다.');
      return;
    }

    const isFav = favorites.some(f => f.code === currentCompany.code);

    if (isFav) {
      // 삭제
      const { error } = await supabase
        .from('user_favorite_stocks')
        .delete()
        .eq('user_id', user.id)
        .eq('company_code', currentCompany.code);
      
      if (!error) {
        setFavorites(prev => prev.filter(f => f.code !== currentCompany.code));
      }
    } else {
      // 추가
      const { error } = await supabase
        .from('user_favorite_stocks')
        .insert({
          user_id: user.id,
          company_code: currentCompany.code,
          company_name: currentCompany.name
        });
      
      if (!error) {
        setFavorites(prev => [{ code: currentCompany.code, name: currentCompany.name }, ...prev]);
      }
    }
  };

  // 사용자 커스텀 데이터 불러오기 및 병합
  const loadUserFinancials = useCallback(async (code: string, serverData: FinancialData[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return serverData; 

      const { data: customData } = await supabase
          .from('user_custom_financials')
          .select('*')
          .eq('user_id', user.id)
          .eq('company_code', code);

      if (!customData || customData.length === 0) return serverData; 

      return serverData.map(item => {
          const custom = customData.find((c: any) => c.year === item.year);
          if (custom) {
              const newItem = { ...item };
              
              if (custom.net_income !== null && Number(custom.net_income) !== 0) newItem.net_income = Number(custom.net_income);
              if (custom.equity !== null && Number(custom.equity) !== 0) newItem.equity = Number(custom.equity);
              if (custom.op_income !== null && Number(custom.op_income) !== 0) newItem.op_income = Number(custom.op_income);

              if (newItem.shares > 0) {
                  newItem.eps = Math.floor(newItem.net_income / newItem.shares);
                  newItem.bps = Math.floor(newItem.equity / newItem.shares);
                  newItem.ops = Math.floor(newItem.op_income / newItem.shares);
              }
              return newItem;
          }
          return item;
      });
  }, [supabase]);

  // 사용자 차트 설정 불러오기
  const loadUserChartSettings = useCallback(async (code: string, type: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const defaults = getDefaultMultipliers(type as any);
      
      if (!user) return defaults;

      const { data, error } = await supabase
          .from('user_chart_settings')
          .select('multipliers')
          .eq('user_id', user.id)
          .eq('company_code', code)
          .eq('band_type', type)
          .maybeSingle();

      if (error) {
          console.error("Error loading chart settings:", error);
          return defaults;
      }

      if (data && data.multipliers) {
          console.log(`Loaded settings for ${type}:`, data.multipliers);
          return data.multipliers.map((m: any) => String(m));
      }
      
      return defaults;
  }, [supabase]);

  // 2. 데이터 가져오기 (주가 + 재무 원본)
  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      const jsonPromise = supabase.storage.from('stocks').download(`${code}.json?t=${Date.now()}`);
      const dbPromise = supabase
        .from('daily_prices')
        .select('date_str, open, high, low, close, volume, rs_rating') 
        .eq('code', code)
        .order('date_str', { ascending: false }) 
        .limit(60); 

      const [jsonResult, dbResult] = await Promise.all([jsonPromise, dbPromise]);

      let stockChartData: any[] = [];

      if (jsonResult.data) {
        const textData = await jsonResult.data.text();
        const parsedJson = JSON.parse(textData);
        stockChartData = parsedJson.map((item: any) => ({
          time: item.time,
          open: Number(item.open) || 0,
          high: Number(item.high) || 0,
          low: Number(item.low) || 0,
          close: Number(item.close) || 0,
          volume: Number(item.volume) || 0,
          rs: item.rs !== null ? Number(item.rs) : undefined 
        }));
      }

      if (dbResult.data && dbResult.data.length > 0) {
        const dataMap = new Map();
        stockChartData.forEach(item => {
            if (item.time) dataMap.set(item.time, {
                ...item,
                open: Number(item.open),
                high: Number(item.high),
                low: Number(item.low),
                close: Number(item.close),
                volume: Number(item.volume),
                rs: item.rs !== null ? Number(item.rs) : undefined
            });
        });

        dbResult.data.forEach(row => {
            const time = row.date_str;
            if (!time) return;

            const existing = dataMap.get(time) || {};
            const merged = { ...existing, time };

            if (row.open !== null) merged.open = Number(row.open);
            else if (merged.open === undefined) merged.open = 0;

            if (row.high !== null) merged.high = Number(row.high);
            else if (merged.high === undefined) merged.high = 0;

            if (row.low !== null) merged.low = Number(row.low);
            else if (merged.low === undefined) merged.low = 0;

            if (row.close !== null) merged.close = Number(row.close);
            else if (merged.close === undefined) merged.close = 0;

            if (row.volume !== null) merged.volume = Number(row.volume);
            else if (merged.volume === undefined) merged.volume = 0;

            if (row.rs_rating !== null) merged.rs = Number(row.rs_rating);
            
            dataMap.set(time, merged);
        });

        stockChartData = Array.from(dataMap.values()).sort((a: any, b: any) => {
            return new Date(a.time).getTime() - new Date(b.time).getTime();
        });
      }
      
      setStockData(stockChartData);

      const { data: finData } = await supabase
        .from('company_financials')
        .select('*')
        .eq('company_code', code)
        .order('year', { ascending: true });

      if (finData && finData.length > 0) {
        const maxAllowedYear = new Date().getFullYear() + 10;
        const validData = finData.filter((d: any) => d.year <= maxAllowedYear);

        console.log("🔍 Loaded Financial Data (Raw):", validData);

        let lastKnownShares = 0;
        
        const history: FinancialData[] = validData.map((d: any) => {
          const parseVal = (v: any) => {
              if (v === null || v === undefined) return 0;
              const s = String(v).replace(/,/g, '');
              return Number(s) || 0;
          };

          let shares = parseVal(d.shares_outstanding);
          
          if (shares > 0) {
              lastKnownShares = shares;
          } else if (lastKnownShares > 0) {
              shares = lastKnownShares;
          }

          const UNIT_MULTIPLIER = 100000000; 

          return {
            year: d.year,
            net_income: parseVal(d.net_income) * UNIT_MULTIPLIER,
            equity: parseVal(d.equity) * UNIT_MULTIPLIER,
            op_income: parseVal(d.op_income) * UNIT_MULTIPLIER,
            shares: shares,
            
            eps: (shares > 0) ? Math.floor((parseVal(d.net_income) * UNIT_MULTIPLIER) / shares) : 0,
            bps: (shares > 0) ? Math.floor((parseVal(d.equity) * UNIT_MULTIPLIER) / shares) : 0,
            ops: (shares > 0 && d.op_income) 
                 ? Math.floor((parseVal(d.op_income) * UNIT_MULTIPLIER) / shares)
                 : 0
          };
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


  // 통합 로드 로직
  useEffect(() => {
    const loadAll = async () => {
      const serverData = await fetchDatAndFinancials(currentCompany.code);
      setServerFinancials(serverData);
      
      const userData = await loadUserFinancials(currentCompany.code, serverData);
      setUserFinancials(userData);

      if (viewMode === 'server') setFinancialHistory(serverData);
      else setFinancialHistory(userData);
      
      const savedMultipliers = await loadUserChartSettings(currentCompany.code, bandType);
      setMultipliers(savedMultipliers);
    };
    loadAll();
  }, [currentCompany, bandType, fetchDatAndFinancials, loadUserFinancials, loadUserChartSettings]);

  useEffect(() => {
      if (viewMode === 'server') setFinancialHistory(serverFinancials);
      else setFinancialHistory(userFinancials);
  }, [viewMode, serverFinancials, userFinancials]);


  const handleFinancialChange = (year: number, newValInBillions: string) => {
    if (viewMode === 'server') return; 

    const val = parseFloat(newValInBillions);
    if (isNaN(val)) return; 

    const newValInWon = val * 100000000; 

    setFinancialHistory(prev => prev.map(item => {
      if (item.year !== year) return item;

      const newItem = { ...item };
      const shares = newItem.shares;

      // 현재 탭 모드에 따라 값 업데이트
      if (bandType === 'PER') {
        newItem.net_income = newValInWon;
        if (shares > 0) newItem.eps = Math.floor(newItem.net_income / shares);
      } else if (bandType === 'PBR') {
        newItem.equity = newValInWon;
        if (shares > 0) newItem.bps = Math.floor(newItem.equity / shares);
      } else if (bandType === 'POR') {
        newItem.op_income = newValInWon;
        if (shares > 0) newItem.ops = Math.floor(newItem.op_income / shares);
      }
      return newItem;
    }));
  };

  const saveAllSettings = async () => {
      if (viewMode !== 'user') return;
      setIsSaving(true);
      try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) { alert('로그인이 필요합니다.'); return; }

          const upsertFinancials = userFinancials.map(item => ({
              user_id: user.id,
              company_code: currentCompany.code,
              year: item.year,
              net_income: item.net_income,
              equity: item.equity,
              op_income: item.op_income,
              updated_at: new Date().toISOString()
          }));

          const financialRes = await supabase
              .from('user_custom_financials')
              .upsert(upsertFinancials, { onConflict: 'user_id, company_code, year' });

          if (financialRes.error) throw financialRes.error;

          console.log("Saving settings:", { 
              company: currentCompany.code, 
              type: bandType, 
              multipliers 
          });

          const settingRes = await supabase
              .from('user_chart_settings')
              .upsert({
                  user_id: user.id,
                  company_code: currentCompany.code,
                  band_type: bandType,
                  multipliers: multipliers, 
                  updated_at: new Date().toISOString()
              }, { onConflict: 'user_id,company_code,band_type' });

          if (settingRes.error) throw settingRes.error;

          alert('재무 데이터와 차트 설정이 모두 저장되었습니다.');
      } catch (e) {
          console.error(e);
          alert('저장 중 오류가 발생했습니다.');
      } finally {
          setIsSaving(false);
      }
  };


  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setInputCompany(val);
    if (val.trim()) { 
      const lowerVal = val.toLowerCase();
      setFilteredCompanies(companyList.filter(c => 
        c.name.toLowerCase().includes(lowerVal) || c.code.toLowerCase().includes(lowerVal)
      )); 
      setShowDropdown(true); 
    } else setShowDropdown(false);
  };
  const selectCompany = (c: Company) => { setCurrentCompany(c); setInputCompany(c.name); setShowDropdown(false); };

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

  const isFavorite = favorites.some(f => f.code === currentCompany.code);

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
          <Link href="/discovery" className="text-gray-400 hover:text-blue-600 font-bold">🔍 종목발굴</Link>
          <span className="text-blue-600 font-bold border-b-2 border-blue-600">📊 밴드 차트</span>
        </div>
      </header>

      <main className="flex-1 p-6 flex gap-6 overflow-hidden">
        {/* 컨트롤 패널 */}
        <div className="w-96 bg-white p-6 rounded-xl shadow border h-full flex flex-col relative transition-all overflow-y-auto">
          
          <div className="flex mb-4 border bg-gray-100 p-1 rounded-lg">
             <button 
                onClick={() => setViewMode('server')}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${viewMode === 'server' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
             >
                🏢 서버 원본
             </button>
             <button 
                onClick={() => setViewMode('user')}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${viewMode === 'user' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
             >
                ✏️ 나만의 데이터
             </button>
          </div>

          <h2 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2 flex justify-between items-center">
             <span>🛠️ 밴드 설정</span>
             {viewMode === 'user' && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">편집 모드</span>}
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

          {/* 연도별 데이터 입력 */}
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
                        
                        const valInBillions = Math.round(valInWon / 100000000).toLocaleString(); 

                        return (
                          <tr key={item.year} className="border-b last:border-none">
                            <td className="p-2 border-r bg-gray-50 font-bold text-center w-16">{item.year}</td>
                            <td className="p-1">
                              <input 
                                type="text" 
                                readOnly={viewMode === 'server'}
                                className={`w-full text-right p-1 outline-none font-mono border border-transparent rounded transition-all font-bold 
                                    ${viewMode === 'server' ? 'bg-transparent text-gray-500 cursor-default' : 'bg-white focus:border-green-400 focus:bg-green-50 text-gray-800'}`}
                                value={valInBillions}
                                onChange={(e) => {
                                    const rawValue = e.target.value.replace(/,/g, '');
                                    handleFinancialChange(item.year, rawValue);
                                }}
                                placeholder="0"
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

          {/* 멀티플 설정 */}
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
          
          {viewMode === 'user' && (
              <button
                onClick={saveAllSettings}
                disabled={isSaving}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg shadow-md transition-all mb-4 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isSaving ? '저장 중...' : '💾 나만의 데이터 저장하기'}
              </button>
          )}
          
          {viewMode === 'server' && (
              <div className="bg-blue-50 p-3 rounded text-xs text-blue-600 text-center font-medium mb-6">
                💡 서버 데이터는 수정할 수 없습니다. <br/> '나만의 데이터' 탭에서 편집하세요.
              </div>
          )}

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
        <div className="flex-1 flex flex-col gap-6">
            <div className="bg-white p-6 rounded-xl shadow border flex flex-col min-h-[600px]">
              <div className="mb-4 flex justify-between items-end">
                 <div className="flex items-center gap-3">
                   <h2 className="text-3xl font-bold text-gray-800">{currentCompany.name} <span className="text-xl text-gray-400 font-normal">({currentCompany.code})</span></h2>
                   {/* [신규] 즐겨찾기 별 버튼 */}
                   <button onClick={toggleFavorite} className="text-xl focus:outline-none transition-transform hover:scale-110">
                     {isFavorite ? '⭐' : '☆'}
                   </button>
                 </div>
                 <div className="text-right">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${viewMode==='server' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                       {viewMode === 'server' ? '🏢 Server Data' : '✏️ Custom Data'}
                    </span>
                 </div>
              </div>
              <div className="mb-2 text-gray-500 text-sm">
                 {financialHistory.length > 0 && `최신 ${labels.output}: ${currentBaseValue.toLocaleString()}원`} × [{multipliers.join(', ')}] 배
              </div>
              
              <div className="flex-1 relative w-full border rounded-lg overflow-hidden bg-gray-50">
                 {stockData.length > 0 ? (
                   <BandChart data={stockData} settings={bandSettings} />
                 ) : (
                   <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 로딩 중...</div>
                 )}
              </div>
            </div>

            {/* [신규] 즐겨찾기 섹션 */}
            <div className="bg-white p-6 rounded-xl shadow border">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span>⭐ 내 관심 종목</span>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500">{favorites.length}개</span>
                </h3>
                {favorites.length > 0 ? (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                        {favorites.map(fav => (
                            <div 
                                key={fav.code} 
                                onClick={() => selectCompany({ name: fav.name, code: fav.code })}
                                className={`min-w-[120px] p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md flex flex-col items-center
                                    ${currentCompany.code === fav.code ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                            >
                                <span className="font-bold text-gray-800">{fav.name}</span>
                                <span className="text-xs text-gray-500">{fav.code}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed">
                        관심 있는 종목의 ⭐ 버튼을 눌러 추가해보세요.
                    </div>
                )}
            </div>
        </div>
      </main>
    </div>
  );
}