'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import BandChart, { BandSettings } from '@/components/BandChart';

type Company = { code: string; name: string; };

type FavoriteStock = {
  code: string;
  name: string;
  group_name: string;
};

export type FinancialData = {
  year: number;
  net_income: number;
  equity: number; 
  op_income: number;
  shares: number;
  eps: number;
  bps: number;
  ops: number;
};

const getDefaultMultipliers = (type: 'PER' | 'PBR' | 'POR') => {
  if (type === 'PBR') return ['0.5', '1.0', '2.0'];
  return ['10', '15', '20'];
};

export default function BandChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  const [stockData, setStockData] = useState<any[]>([]);
  
  const [serverFinancials, setServerFinancials] = useState<FinancialData[]>([]);
  const [userFinancials, setUserFinancials] = useState<FinancialData[]>([]);
  const [financialHistory, setFinancialHistory] = useState<FinancialData[]>([]);

  const [viewMode, setViewMode] = useState<'server' | 'user'>('server');
  const [isSaving, setIsSaving] = useState(false);

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [inputCompany, setInputCompany] = useState('삼성전자');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);
  const [groups, setGroups] = useState<string[]>(['기본 그룹']);
  const [activeGroup, setActiveGroup] = useState<string>('기본 그룹');
  const [showFavorites, setShowFavorites] = useState(false);

  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  
  const [multipliers, setMultipliers] = useState<string[]>(getDefaultMultipliers('PER'));

  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies')
        .select('*')
        .order('name')
        .neq('code', 'KOSPI')
        .neq('code', 'KOSDAQ')
        .range(0, 9999);
      if (data) setCompanyList(data);
    };
    fetchCompanies();
  }, [supabase]);

  const loadFavorites = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('user_favorite_stocks')
      .select('company_code, company_name, group_name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (data) {
      const loadedFavs = data.map(item => ({
        code: item.company_code,
        name: item.company_name,
        group_name: item.group_name || '기본 그룹'
      }));
      
      // --- 그룹 순서 적용 ---
      let uniqueGroups = Array.from(new Set(loadedFavs.map(f => f.group_name)));
      if (!uniqueGroups.includes('기본 그룹')) uniqueGroups.unshift('기본 그룹');

      const savedGroupOrder = typeof window !== 'undefined' ? localStorage.getItem('groupOrder') : null;
      let combinedGroups = [...uniqueGroups]; // Groups found in DB
      
      if (savedGroupOrder) {
          try {
              const orderFromStorage: string[] = JSON.parse(savedGroupOrder);
              // Add groups from localStorage that are not in DB
              orderFromStorage.forEach(g => {
                  if (!combinedGroups.includes(g)) {
                      combinedGroups.push(g);
                  }
              });
          } catch (e) {
              console.error("Failed to parse group order from localStorage", e);
          }
      }
      
      // Sort combined groups based on localStorage order, or alphabetically if not in localStorage
      combinedGroups = combinedGroups.sort((a, b) => {
          const orderFromStorage: string[] = savedGroupOrder ? JSON.parse(savedGroupOrder) : [];
          const indexA = orderFromStorage.indexOf(a);
          const indexB = orderFromStorage.indexOf(b);

          if (a === '기본 그룹') return -1;
          if (b === '기본 그룹') return 1;

          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return a.localeCompare(b); // Fallback to alphabetical
      });
      setGroups(combinedGroups);
      
      setFavorites(loadedFavs);
    }
  }, [supabase]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const toggleFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요한 기능입니다.');
      return;
    }

    const isFavInGroup = favorites.some(f => f.code === currentCompany.code && f.group_name === activeGroup);

    if (isFavInGroup) {
      const { error } = await supabase
        .from('user_favorite_stocks')
        .delete()
        .eq('user_id', user.id)
        .eq('company_code', currentCompany.code)
        .eq('group_name', activeGroup);
      
      if (!error) {
        setFavorites(prev => prev.filter(f => !(f.code === currentCompany.code && f.group_name === activeGroup)));
      }
    } else {
      const { error } = await supabase
        .from('user_favorite_stocks')
        .insert({
          user_id: user.id,
          company_code: currentCompany.code,
          company_name: currentCompany.name,
          group_name: activeGroup
        });
      
      if (!error) {
        setFavorites(prev => [{ 
            code: currentCompany.code, 
            name: currentCompany.name, 
            group_name: activeGroup 
        }, ...prev]);
      }
    }
  };

  const loadUserFinancials = useCallback(async (code: string, serverData: FinancialData[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return serverData; 

      const { data: customData } = await supabase
          .from('user_custom_financials')
          .select('*')
          .eq('user_id', user.id)
          .eq('company_code', code);

      if (!customData || customData.length === 0) return serverData; 

      const getLastKnownShares = (year: number) => {
          let latestYear = -Infinity;
          let latestShares = 0;
          serverData.forEach(item => {
              if (item.year <= year && item.shares > 0 && item.year > latestYear) {
                  latestYear = item.year;
                  latestShares = item.shares;
              }
          });
          return latestShares;
      };

      const years = new Set<number>([
          ...serverData.map(item => item.year),
          ...customData.map((item: any) => Number(item.year))
      ]);

      return Array.from(years).sort((a, b) => a - b).map(year => {
          const serverItem = serverData.find(item => item.year === year);
          const custom = customData.find((c: any) => Number(c.year) === year);

          const baseItem: FinancialData = serverItem ? { ...serverItem } : {
              year,
              net_income: 0,
              equity: 0,
              op_income: 0,
              shares: getLastKnownShares(year),
              eps: 0,
              bps: 0,
              ops: 0
          };

          if (custom) {
              if (custom.net_income !== null) baseItem.net_income = Number(custom.net_income);
              if (custom.equity !== null) baseItem.equity = Number(custom.equity);
              if (custom.op_income !== null) baseItem.op_income = Number(custom.op_income);
          }

          if (baseItem.shares > 0) {
              baseItem.eps = Math.floor(baseItem.net_income / baseItem.shares);
              baseItem.bps = Math.floor(baseItem.equity / baseItem.shares);
              baseItem.ops = Math.floor(baseItem.op_income / baseItem.shares);
          } else {
              baseItem.eps = 0;
              baseItem.bps = 0;
              baseItem.ops = 0;
          }

          return baseItem;
      });
  }, [supabase]);

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
          return data.multipliers.map((m: any) => String(m));
      }
      
      return defaults;
  }, [supabase]);

  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      const { data: priceData, error: priceError } = await supabase
        .from('daily_prices_v2')
        .select('date, open, high, low, close, volume')
        .eq('code', code)
        .order('date', { ascending: true });

      if (priceError) throw priceError;

      let stockChartData: any[] = [];

      if (priceData && priceData.length > 0) {
        stockChartData = priceData.map(row => {
          let o = Number(row.open);
          let h = Number(row.high);
          let l = Number(row.low);
          const c = Number(row.close);

          if (o === 0 && h === 0 && l === 0) {
            o = c;
            h = c;
            l = c;
          }

          return {
            time: row.date,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: Number(row.volume),
          };
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

  useEffect(() => {
    const loadAll = async () => {
      const serverData = await fetchDatAndFinancials(currentCompany.code);
      setServerFinancials(serverData);
      
      const userData = await loadUserFinancials(currentCompany.code, serverData);
      setUserFinancials(userData);

      if (viewMode === 'server') setFinancialHistory(serverData);
      else if (viewMode === 'user') setFinancialHistory(userData);
      
      const savedMultipliers = await loadUserChartSettings(currentCompany.code, bandType);
      setMultipliers(savedMultipliers);
    };
    loadAll();
  }, [currentCompany, bandType, fetchDatAndFinancials, loadUserFinancials, loadUserChartSettings]);

  useEffect(() => {
      if (viewMode === 'server') setFinancialHistory(serverFinancials);
      else if (viewMode === 'user') setFinancialHistory(userFinancials);
  }, [viewMode, serverFinancials, userFinancials]);


  const handleFinancialChange = (year: number, newValInBillions: string) => {
    if (viewMode !== 'user') return;

    const val = parseFloat(newValInBillions);
    if (isNaN(val)) return;

    const newValInWon = val * 100000000;

    const getUpdatedList = (list: FinancialData[]) => {
      const getLastKnownShares = (items: FinancialData[], targetYear: number) => {
        let latestYear = -Infinity;
        let latestShares = 0;
        items.forEach(item => {
          if (item.year <= targetYear && item.shares > 0 && item.year > latestYear) {
            latestYear = item.year;
            latestShares = item.shares;
          }
        });
        return latestShares;
      };

      const existingItem = list.find(item => item.year === year);

      if (existingItem) {
        // 기존 연도 수정
        return list.map(item => {
          if (item.year !== year) return item;

          const newItem = { ...item };
          const shares = newItem.shares > 0 ? newItem.shares : getLastKnownShares(list, year);
          if (shares > 0) newItem.shares = shares;

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
        });
      } else {
        // 새로운 연도 추가
        const shares = getLastKnownShares(list, year);
        const newItem: FinancialData = {
          year: year,
          net_income: bandType === 'PER' ? newValInWon : 0,
          equity: bandType === 'PBR' ? newValInWon : 0,
          op_income: bandType === 'POR' ? newValInWon : 0,
          shares: shares,
          eps: bandType === 'PER' && shares > 0 ? Math.floor(newValInWon / shares) : 0,
          bps: bandType === 'PBR' && shares > 0 ? Math.floor(newValInWon / shares) : 0,
          ops: bandType === 'POR' && shares > 0 ? Math.floor(newValInWon / shares) : 0
        };

        return [...list, newItem].sort((a, b) => a.year - b.year);
      }
    };

    setUserFinancials(prev => getUpdatedList(prev));
    setFinancialHistory(prev => getUpdatedList(prev));
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
    if (val.trim()) { setFilteredCompanies(companyList.filter(c => c.name.includes(val) || c.code.includes(val))); setShowDropdown(true); } else setShowDropdown(false);
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

  const latestClosePrice = stockData.length > 0 ? stockData[stockData.length - 1].close : 0;

  const getBaseValueForYear = (financialData: FinancialData, type: 'PER' | 'PBR' | 'POR') => {
    if (type === 'PER') return financialData.eps;
    if (type === 'PBR') return financialData.bps;
    return financialData.ops;
  };

  const calculateTargetInfo = useCallback((year: number) => {
    const data = financialHistory.find(f => f.year === year);
    if (!data) return { price: 0, yield: 0, label: `${year} Target` };

    const baseVal = getBaseValueForYear(data, bandType);
    const targetMult = parseFloat(multipliers[2]) || 0;
    const targetPrice = baseVal * targetMult;
    
    let yieldVal = 0;
    if (latestClosePrice > 0 && targetPrice > 0) {
      yieldVal = ((targetPrice - latestClosePrice) / latestClosePrice) * 100;
    }

    return { price: targetPrice, yield: yieldVal, label: `${year} Target` };
  }, [financialHistory, bandType, multipliers, latestClosePrice]);


  const target26 = calculateTargetInfo(2026);
  const target27 = calculateTargetInfo(2027);

  const isFavorite = favorites.some(f => f.code === currentCompany.code && f.group_name === activeGroup);
  const currentGroupFavorites = useMemo(() => {
    const filtered = favorites.filter(f => f.group_name === activeGroup);
    
    if (typeof window === 'undefined') return filtered;

    const savedStockOrderJson = localStorage.getItem(`stockOrder_${activeGroup}`);
    if (!savedStockOrderJson) return filtered;

    try {
        const orderCodes: string[] = JSON.parse(savedStockOrderJson);
        return filtered.sort((a, b) => {
            const indexA = orderCodes.indexOf(a.code);
            const indexB = orderCodes.indexOf(b.code);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0; 
        });
    } catch (e) {
        console.error("Failed to parse stock order from localStorage", e);
        return filtered;
    }
  }, [favorites, activeGroup]);

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header removed - now using Sidebar */}

      <main className="flex-1 p-6 flex gap-6 overflow-hidden relative">
        {/* === [1] 좌측: 밴드 설정 패널 === */}
        <div className="w-96 bg-white p-6 rounded-xl shadow border h-full flex flex-col overflow-y-auto">
          {/* 종목 검색 */}
          <div className="mb-4 relative">
            <input
              type="text"
              className="w-full border p-2 rounded font-bold"
              value={inputCompany}
              onChange={handleSearchChange}
              placeholder="종목 검색..."
            />
            {showDropdown && (
              <ul className="absolute z-20 w-full bg-white border mt-1 rounded max-h-60 overflow-y-auto shadow-xl">
                {filteredCompanies.map(c => (
                  <li
                    key={c.code}
                    onClick={() => selectCompany(c)}
                    className="p-2 hover:bg-gray-100 cursor-pointer"
                  >
                    {c.name} ({c.code})
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex mb-4 border bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('server')}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${viewMode === 'server' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              🏢 서버
            </button>
            <button
              onClick={() => setViewMode('user')}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${viewMode === 'user' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              ✏️ 편집
            </button>
          </div>

          <>
                <h2 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2 flex justify-between items-center">
                    <span>🛠️ 밴드 설정</span>
                    {viewMode === 'user' && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">편집 모드</span>}
                </h2>

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
                            {[2023, 2024, 2025, 2026, 2027].map((year) => {
                                // financialHistory에서 해당 연도 데이터 찾기
                                const item = financialHistory.find(f => f.year === year);

                                let valInWon = 0;
                                if (item) {
                                    if (bandType === 'PER') valInWon = item.net_income;
                                    else if (bandType === 'PBR') valInWon = item.equity;
                                    else if (bandType === 'POR') valInWon = item.op_income;
                                }

                                const valInBillions = Math.round(valInWon / 100000000).toLocaleString();
                                const yearLabel = year >= 2025 ? `${year}(E)` : `${year}`;

                                return (
                                <tr key={year} className="border-b last:border-none">
                                    <td className="p-2 border-r bg-gray-50 font-bold text-center w-16">{yearLabel}</td>
                                    <td className="p-1">
                                    <input
                                        type="text"
                                        readOnly={viewMode === 'server'}
                                        className={`w-full text-right p-1 outline-none font-mono border border-transparent rounded transition-all font-bold
                                            ${viewMode === 'server' ? 'bg-transparent text-gray-500 cursor-default' : 'bg-white focus:border-green-400 focus:bg-green-50 text-gray-800'}`}
                                        value={valInBillions}
                                        onChange={(e) => {
                                            const rawValue = e.target.value.replace(/,/g, '');
                                            handleFinancialChange(year, rawValue);
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

                <div className="mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-2">멀티플 (배수) 설정</label>
                    <div className="flex flex-col gap-2">
                    {multipliers.map((m, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${idx===0?'bg-yellow-500':idx===1?'bg-green-500':'bg-blue-500'}`}></span>
                        <span className="text-sm w-12 text-gray-600 font-bold">{idx === 2 ? 'Target' : `Line ${idx+1}`}</span>
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

                {/* [삭제됨] 하단 계산된 지표 테이블 */}
          </>
        </div>

        {/* === [2] 중앙: 차트 영역 === */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* Header style control bar */}
            <div className="bg-white p-6 rounded-xl shadow border flex flex-col h-full">
              <div className="mb-4 flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-bold text-gray-800">
                      {currentCompany.name}
                      <span className="text-xl text-gray-400 font-normal ml-2">({currentCompany.code})</span>
                    </h2>
                    <button
                      onClick={toggleFavorite}
                      className={`text-2xl focus:outline-none transition-transform hover:scale-110 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                      title={`${activeGroup}에 ${isFavorite ? '삭제' : '추가'}`}
                    >
                      {isFavorite ? '⭐' : '☆'}
                    </button>
                  </div>

                  {/* 관심종목 토글 버튼 */}
                  <button
                    onClick={() => setShowFavorites(!showFavorites)}
                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${showFavorites ? 'bg-yellow-500 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {showFavorites ? '✕ 관심종목 닫기' : '⭐ 관심종목'}
                  </button>
                </div>

                {/* 목표가 및 수익률 표시 */}
                <div className="flex gap-4 text-sm">
                  <div className="flex gap-2 items-center bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">
                    <span className="font-bold text-blue-800">{target26.label}:</span>
                    <span className="font-mono text-gray-800">{target26.price.toLocaleString()}원</span>
                    <span className={`font-bold ${target26.yield > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                      ({target26.yield > 0 ? '+' : ''}{target26.yield.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex gap-2 items-center bg-purple-50 px-3 py-1 rounded-lg border border-purple-100">
                    <span className="font-bold text-purple-800">{target27.label}:</span>
                    <span className="font-mono text-gray-800">{target27.price.toLocaleString()}원</span>
                    <span className={`font-bold ${target27.yield > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                      ({target27.yield > 0 ? '+' : ''}{target27.yield.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
              <div className="mb-2 text-gray-500 text-sm flex-shrink-0">
                 {financialHistory.length > 0 && `최신 ${labels.output}: ${currentBaseValue.toLocaleString()}원`} × [{multipliers.join(', ')}] 배
              </div>

              <div className="flex-1 w-full border rounded-lg overflow-hidden bg-gray-50 min-h-0 relative">
                 {stockData.length > 0 ? (
                   <div className="absolute inset-0">
                     <BandChart data={stockData} settings={bandSettings} />
                   </div>
                 ) : (
                   <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 로딩 중...</div>
                 )}
              </div>
            </div>
        </div>

        {/* === [3] 우측: 관심 종목 패널 (토글 가능) === */}
        {showFavorites && (
          <div className="w-80 bg-white p-4 rounded-xl shadow border h-full flex flex-col overflow-hidden transition-all duration-300">
            <h2 className="text-lg font-bold mb-3 text-gray-800 border-b pb-2">
              ⭐ 관심 종목
            </h2>

            {/* 그룹 탭 */}
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 border-b shrink-0">
              {groups.map(group => (
                <button
                  key={group}
                  onClick={() => setActiveGroup(group)}
                  className={`px-3 py-1 text-xs rounded-full font-bold whitespace-nowrap transition-all
                    ${activeGroup === group
                      ? 'bg-yellow-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  {group} ({favorites.filter(f => f.group_name === group).length})
                </button>
              ))}
            </div>

            {/* 종목 리스트 */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              {currentGroupFavorites.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {currentGroupFavorites.map(fav => (
                    <li
                      key={`${fav.code}-${fav.group_name}`}
                      onClick={() => selectCompany({ name: fav.name, code: fav.code })}
                      className={`p-2 rounded-lg border cursor-pointer transition-all
                        ${currentCompany.code === fav.code ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                    >
                      <div className="font-bold text-gray-800 text-sm">{fav.name}</div>
                      <div className="text-xs text-gray-400">{fav.code}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-xs border-2 border-dashed rounded-lg bg-gray-50">
                  <span>종목이 없습니다.</span>
                  <span>차트에서 별(⭐)을 눌러 추가하세요.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
