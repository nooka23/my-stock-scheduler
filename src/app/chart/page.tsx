'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import BandChart, { BandSettings } from '@/components/BandChart';
import { User } from '@supabase/supabase-js';

type Company = { code: string; name: string; };

// [신규] 즐겨찾기 타입
type FavoriteStock = {
  code: string;
  name: string;
  group_name: string;
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

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

// 기본 멀티플 반환 함수
const getDefaultMultipliers = (type: 'PER' | 'PBR' | 'POR') => {
  if (type === 'PBR') return ['0.5', '1.0', '2.0'];
  return ['10', '15', '20'];
};

export default function BandChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

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

  // [신규] 즐겨찾기 상태 확장
  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);
  const [groups, setGroups] = useState<string[]>(['기본 그룹']);
  const [activeGroup, setActiveGroup] = useState<string>('기본 그룹');

  // 밴드 설정 상태
  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  
  const [multipliers, setMultipliers] = useState<string[]>(getDefaultMultipliers('PER'));

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

  // 1. 초기 종목 목록 로드
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase.from('companies').select('*').order('name').range(0, 9999);
      if (data) setCompanyList(data);
    };
    fetchCompanies();
  }, [supabase]);

  // [수정] 즐겨찾기 목록 불러오기 (그룹명 포함)
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
      setFavorites(loadedFavs);
      
      // 그룹 목록 추출 (기본 그룹은 항상 포함)
      const loadedGroups = Array.from(new Set(loadedFavs.map(f => f.group_name)));
      if (!loadedGroups.includes('기본 그룹')) loadedGroups.unshift('기본 그룹');
      setGroups(loadedGroups.sort());
    }
  }, [supabase]);

  // 초기 로드 시 즐겨찾기 가져오기
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  // [신규] 그룹 추가 핸들러
  const handleAddGroup = () => {
    const newGroup = prompt("새로운 그룹 이름을 입력하세요:");
    if (newGroup && !groups.includes(newGroup)) {
      setGroups([...groups, newGroup]);
      setActiveGroup(newGroup);
    }
  };

  // [수정] 즐겨찾기 토글 핸들러 (현재 활성화된 그룹 기준)
  const toggleFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('로그인이 필요한 기능입니다.');
      return;
    }

    // 현재 그룹에 이미 있는지 확인
    const isFavInGroup = favorites.some(f => f.code === currentCompany.code && f.group_name === activeGroup);

    if (isFavInGroup) {
      // 현재 그룹에서 삭제
      const { error } = await supabase
        .from('user_favorite_stocks')
        .delete()
        .eq('user_id', user.id)
        .eq('company_code', currentCompany.code)
        .eq('group_name', activeGroup); // 그룹명 조건 추가
      
      if (!error) {
        setFavorites(prev => prev.filter(f => !(f.code === currentCompany.code && f.group_name === activeGroup)));
      }
    } else {
      // 현재 그룹에 추가
      const { error } = await supabase
        .from('user_favorite_stocks')
        .insert({
          user_id: user.id,
          company_code: currentCompany.code,
          company_name: currentCompany.name,
          group_name: activeGroup // 현재 활성화된 그룹명 저장
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
          return data.multipliers.map((m: any) => String(m));
      }
      
      return defaults;
  }, [supabase]);

  // 2. 데이터 가져오기 (주가 + 재무 원본)
  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      // (1) 주가 데이터 조회 (v2 테이블)
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

          // [수정] 거래정지 등으로 시가/고가/저가가 0인 경우 종가로 대체하여 차트 왜곡 방지
          if (o === 0 && h === 0 && l === 0) {
            o = c;
            h = c;
            l = c;
          }

          return {
            time: row.date, // date 컬럼 사용
            open: o,
            high: h,
            low: l,
            close: c,
            volume: Number(row.volume),
          };
        });
      }
      
      setStockData(stockChartData);

      // (2) 재무 데이터 조회
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

  // 현재 종목이 활성화된 그룹에 있는지 여부
  const isFavorite = favorites.some(f => f.code === currentCompany.code && f.group_name === activeGroup);

  // 현재 그룹의 즐겨찾기 목록 필터링
  const currentGroupFavorites = favorites.filter(f => f.group_name === activeGroup);

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

        <div className="flex items-center gap-6">
          <nav className="flex gap-6 text-lg">
            <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold">🗓️ 스케줄러</Link>
            <Link href="/discovery" className="text-gray-400 hover:text-blue-600 font-bold">🔍 종목발굴</Link>
            <span className="text-blue-600 font-bold border-b-2 border-blue-600">📊 밴드 차트</span>
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
                   <button 
                     onClick={toggleFavorite} 
                     className={`text-xl focus:outline-none transition-transform hover:scale-110 ${isFavorite ? 'text-yellow-400' : 'text-gray-300'}`}
                     title={`${activeGroup}에 ${isFavorite ? '삭제' : '추가'}`}
                   >
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

            {/* [수정] 즐겨찾기 섹션 (그룹 탭 포함) */}
            <div className="bg-white p-6 rounded-xl shadow border">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span>⭐ 내 관심 종목</span>
                    </h3>
                    
                    {/* 그룹 탭 */}
                    <div className="flex gap-2 items-center overflow-x-auto max-w-[600px]">
                        {groups.map(group => (
                            <button
                                key={group}
                                onClick={() => setActiveGroup(group)}
                                className={`px-3 py-1 text-sm rounded-full font-bold whitespace-nowrap transition-all
                                    ${activeGroup === group 
                                        ? 'bg-blue-600 text-white shadow-md' 
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            >
                                {group}
                            </button>
                        ))}
                        <button 
                            onClick={handleAddGroup}
                            className="px-2 py-1 text-sm rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600 transition-all font-bold"
                            title="새 그룹 만들기"
                        >
                            +
                        </button>
                    </div>
                </div>

                {currentGroupFavorites.length > 0 ? (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                        {currentGroupFavorites.map(fav => (
                            <div 
                                key={`${fav.code}-${fav.group_name}`} 
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
                        '{activeGroup}' 그룹에 관심 종목을 추가해보세요. (상단 별 ⭐ 클릭)
                    </div>
                )}
            </div>
        </div>
      </main>
    </div>
  );
}