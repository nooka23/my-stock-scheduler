'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import StockChart from '@/components/StockChart';
import {
  calculateEMA,
  calculateWMA,
  calculateKeltner,
  calculateMACD
} from '@/utils/indicators';

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rs?: number;
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

type FinancialData = {
  year: number;
  net_income: number;
  equity: number;
  op_income: number;
  shares: number;
  revenue: number; 
};

type FavoriteStock = {
  code: string;
  name: string;
  group_name: string;
};

export default function SecondaryFilteringPage() {
  const supabase = createClientComponentClient();
  
  // --- State ---
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [stockList, setStockList] = useState<FavoriteStock[]>([]);
  const [currentStock, setCurrentStock] = useState<FavoriteStock | null>(null);

  const [dailyData, setDailyData] = useState<ChartData[]>([]);
  const [weeklyData, setWeeklyData] = useState<ChartData[]>([]);
  
  // Financial Data State
  const [serverFinancials, setServerFinancials] = useState<FinancialData[]>([]);
  const [userFinancials, setUserFinancials] = useState<FinancialData[]>([]);
  const [financials, setFinancials] = useState<FinancialData[]>([]); // Currently displayed
  const [viewMode, setViewMode] = useState<'server' | 'user'>('server');
  const [isSaving, setIsSaving] = useState(false);
  
  const [chartLoading, setChartLoading] = useState(false);
  const [targetGroup, setTargetGroup] = useState<string>('');

  // --- Initial Load: Groups ---
  useEffect(() => {
    const fetchGroups = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('user_favorite_stocks')
        .select('group_name')
        .eq('user_id', user.id);

      if (data) {
        const uniqueGroups = Array.from(new Set(data.map(d => d.group_name))).sort();
        setGroups(uniqueGroups);
        if (uniqueGroups.length > 0) {
            setSelectedGroup(uniqueGroups[0]);
        }
      }
    };
    fetchGroups();
  }, [supabase]);

  // --- Fetch Stocks for Group ---
  useEffect(() => {
      const fetchStocks = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !selectedGroup) return;
  
        const { data } = await supabase
          .from('user_favorite_stocks')
          .select('company_code, company_name, group_name')
          .eq('user_id', user.id)
          .eq('group_name', selectedGroup)
          .order('company_name'); 
  
        if (data) {
          setStockList(data.map(d => ({
              code: d.company_code,
              name: d.company_name,
              group_name: d.group_name
          })));
        } else {
            setStockList([]);
        }
      };
      fetchStocks();
  }, [supabase, selectedGroup]);

  // --- Helper: Convert to Weekly ---
  const convertToWeekly = (dailyData: ChartData[]): ChartData[] => {
    if (dailyData.length === 0) return [];
    
    const weeklyMap = new Map<string, ChartData>();
    const sortedDaily = [...dailyData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    sortedDaily.forEach(day => {
        const date = new Date(day.time);
        const dayOfWeek = date.getDay(); 
        const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); 
        const monday = new Date(date.setDate(diff));
        const weekKey = monday.toISOString().split('T')[0];

        if (!weeklyMap.has(weekKey)) {
            weeklyMap.set(weekKey, {
                ...day,
                time: weekKey,
                volume: 0,
                high: -Infinity,
                low: Infinity
            });
        }

        const weekData = weeklyMap.get(weekKey)!;
        weekData.high = Math.max(weekData.high, day.high);
        weekData.low = Math.min(weekData.low, day.low);
        weekData.close = day.close; 
        weekData.volume += day.volume;
    });

    return Array.from(weeklyMap.values());
  };

  // --- Helper: Process Indicators ---
  const processIndicators = (data: ChartData[], timeframe: 'daily' | 'weekly') => {
      const ema = calculateEMA(data, 20);
      let wma;
      if (timeframe === 'weekly') {
          wma = calculateWMA(data, 30); 
      } else {
          wma = calculateWMA(data, 150);
      }
      const keltner = calculateKeltner(data, 20, 2.25);
      const macd = calculateMACD(data, 3, 10, 16);

      return data.map((d, i) => ({
          ...d,
          ema20: ema[i],
          wma150: wma[i],
          keltner: keltner[i],
          macd: macd[i]
      }));
  };

  // --- Fetch Data for Selected Stock ---
  const fetchStockDetails = useCallback(async (code: string) => {
    setChartLoading(true);
    try {
        const { data: { user } } = await supabase.auth.getUser();

        // 1. Price Data
        const { data: priceData } = await supabase
            .from('daily_prices_v2')
            .select('date, open, high, low, close, volume')
            .eq('code', code)
            .order('date', { ascending: true }); 
            
        // 2. RS Data 
        const { data: rsData } = await supabase
            .from('rs_rankings_with_volume')
            .select('date, rank_weighted')
            .eq('code', code)
            .order('date', { ascending: true });
            
        const rsMap = new Map(rsData?.map(r => [r.date, r.rank_weighted]));
        
        let rawDaily: ChartData[] = [];
        if (priceData) {
            rawDaily = priceData.map(p => {
                let o = Number(p.open); let h = Number(p.high); let l = Number(p.low); const c = Number(p.close);
                if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }
                return {
                    time: p.date,
                    open: o, high: h, low: l, close: c,
                    volume: Number(p.volume),
                    rs: rsMap.get(p.date)
                };
            });
        }

        setDailyData(processIndicators(rawDaily, 'daily'));
        const rawWeekly = convertToWeekly(rawDaily);
        setWeeklyData(processIndicators(rawWeekly, 'weekly'));

        // 3. Financials (Server + User Custom)
        const { data: serverFin } = await supabase
            .from('company_financials')
            .select('*')
            .eq('company_code', code)
            .gte('year', 2023)
            .lte('year', 2027)
            .order('year');

        let baseFin: FinancialData[] = [];
        
        // Base from Server
        if (serverFin) {
            baseFin = serverFin.map(f => ({
                year: f.year,
                net_income: Number(f.net_income),
                equity: Number(f.equity),
                op_income: Number(f.op_income),
                revenue: Number(f.revenue || 0),
                shares: Number(f.shares_outstanding)
            }));
        }
        setServerFinancials(baseFin);

        // Prepare User Data (Clone Server Data then Override)
        let mergedUserFin: FinancialData[] = JSON.parse(JSON.stringify(baseFin));

        // Override with User Custom
        if (user) {
            const { data: userFin } = await supabase
                .from('user_custom_financials')
                .select('*')
                .eq('user_id', user.id)
                .eq('company_code', code)
                .gte('year', 2023)
                .lte('year', 2027);
            
            if (userFin) {
                userFin.forEach(u => {
                    const idx = mergedUserFin.findIndex(m => m.year === u.year);
                    if (idx >= 0) {
                        if (u.net_income) mergedUserFin[idx].net_income = Number(u.net_income) / 100000000;
                        if (u.op_income) mergedUserFin[idx].op_income = Number(u.op_income) / 100000000;
                        if (u.equity) mergedUserFin[idx].equity = Number(u.equity) / 100000000;
                        if (u.revenue) mergedUserFin[idx].revenue = Number(u.revenue) / 100000000;
                    } else {
                        // New year from user data
                        mergedUserFin.push({
                            year: u.year,
                            net_income: Number(u.net_income || 0) / 100000000,
                            equity: Number(u.equity || 0) / 100000000,
                            op_income: Number(u.op_income || 0) / 100000000,
                            revenue: Number(u.revenue || 0) / 100000000,
                            shares: 0
                        });
                    }
                });
            }
        }
        mergedUserFin.sort((a,b) => a.year - b.year);
        setUserFinancials(mergedUserFin);

        // Initial Display
        // Note: We use viewMode state (which persists across stocks) or default to server?
        // Let's keep viewMode persistence.
        setFinancials(viewMode === 'server' ? baseFin : mergedUserFin);

    } catch (e) {
        console.error(e);
    } finally {
        setChartLoading(false);
    }
  }, [supabase]); // viewMode added to deps would cause loop if we update financials there. Better handle in useEffect.

  // Update displayed financials when viewMode or source data changes
  useEffect(() => {
    if (viewMode === 'server') {
        setFinancials(serverFinancials);
    } else {
        setFinancials(userFinancials);
    }
  }, [viewMode, serverFinancials, userFinancials]);

  useEffect(() => {
      if (currentStock) {
          fetchStockDetails(currentStock.code);
          setTargetGroup(groups[0] || '기본 그룹');
      } else {
          setDailyData([]);
          setWeeklyData([]);
          setFinancials([]);
      }
  }, [currentStock, fetchStockDetails, groups]);


    // --- Financial Editing Handlers ---
    const handleFinancialChange = (year: number, field: keyof FinancialData, valueStr: string) => {
        if (viewMode !== 'user') return;
        
        // Remove commas
        const rawVal = valueStr.replace(/,/g, '');
        const val = parseFloat(rawVal);
        
        setUserFinancials(prev => {
            const exists = prev.find(p => p.year === year);
            if (exists) {
                return prev.map(p => p.year === year ? { ...p, [field]: isNaN(val) ? 0 : val } : p);
            } else {
                // Should not happen usually if we initialized properly, but just in case
                return [...prev, { 
                    year, 
                    net_income: 0, equity: 0, op_income: 0, revenue: 0, shares: 0,
                    [field]: isNaN(val) ? 0 : val 
                }].sort((a,b) => a.year - b.year);
            }
        });
    };

    const handleSaveUserFinancials = async () => {
        if (!currentStock || viewMode !== 'user') return;
        setIsSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { alert('로그인이 필요합니다.'); return; }

            // Upsert Data (Convert Billions -> Won)
            const upsertData = userFinancials.map(f => ({
                user_id: user.id,
                company_code: currentStock.code,
                year: f.year,
                net_income: f.net_income * 100000000,
                op_income: f.op_income * 100000000,
                equity: f.equity * 100000000,
                revenue: f.revenue * 100000000,
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase
                .from('user_custom_financials')
                .upsert(upsertData, { onConflict: 'user_id, company_code, year' });

            if (error) throw error;
            alert('재무 데이터가 저장되었습니다.');
        } catch (e) {
            console.error(e);
            alert('저장 중 오류가 발생했습니다.');
        } finally {
            setIsSaving(false);
        }
    };


    // --- Action: Add to Group ---
    const handleAddtoGroup = async () => {
        if (!currentStock || !targetGroup) return;
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { alert('로그인이 필요합니다.'); return; }
  
        const { data: existingFav } = await supabase
            .from('user_favorite_stocks')
            .select('id')
            .eq('user_id', user.id)
            .eq('company_code', currentStock.code)
            .eq('group_name', targetGroup);
  
        if (existingFav && existingFav.length > 0) {
            alert(`'${currentStock.name}'은(는) 이미 '${targetGroup}' 그룹에 추가되어 있습니다.`);
            return;
        }
  
        const confirmAdd = confirm(`'${currentStock.name}'을(를) '${targetGroup}' 그룹에 추가하시겠습니까?`);
        if (!confirmAdd) return;
        
        try {
            const { error: insError } = await supabase
              .from('user_favorite_stocks')
              .insert({
                  user_id: user.id,
                  company_code: currentStock.code,
                  company_name: currentStock.name,
                  group_name: targetGroup
              });
              
            if (insError) throw insError;
  
            alert(`'${currentStock.name}'이(가) '${targetGroup}' 그룹에 추가되었습니다.`);
            
            if (!groups.includes(targetGroup)) {
              setGroups(prev => [...prev, targetGroup].sort());
            }
        } catch (e) {
            console.error(e);
            alert("추가 중 오류가 발생했습니다.");
        }
    };
  
    // --- Action: Delete from Group ---
    const handleDeleteFromGroup = async () => {
        if (!currentStock || !selectedGroup) return;

        const confirmDelete = confirm(`정말로 '${currentStock.name}'을(를) '${selectedGroup}' 그룹에서 제외하시겠습니까?`);
        if (!confirmDelete) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { alert('로그인이 필요합니다.'); return; }

        try {
            const { error } = await supabase
                .from('user_favorite_stocks')
                .delete()
                .eq('user_id', user.id)
                .eq('company_code', currentStock.code)
                .eq('group_name', selectedGroup);

            if (error) throw error;

            alert("제외되었습니다.");
            setStockList(prev => prev.filter(s => s.code !== currentStock.code));
            setCurrentStock(null);

        } catch (e) {
            console.error(e);
            alert("제외 중 오류가 발생했습니다.");
        }
    };
  
    return (
      <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white p-4 border-b flex justify-between items-center shadow-sm shrink-0">
            <h1 className="text-xl font-bold text-gray-800">📊 2차 필터링</h1>
        </div>
  
        <main className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Stock List */}
          <aside className="w-64 bg-white border-r flex flex-col">
              <div className="p-4 border-b bg-gray-50">
                  <label className="text-xs font-bold text-gray-500 block mb-1">관심 그룹 선택</label>
                  <select 
                      className="w-full border rounded p-2 text-sm font-bold"
                      value={selectedGroup}
                      onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
              </div>
              <div className="flex-1 overflow-y-auto">
                  {stockList.length === 0 ? (
                      <div className="p-4 text-center text-gray-400 text-sm">종목이 없습니다.</div>
                  ) : (
                      <ul>
                          {stockList.map(stock => (
                              <li 
                                  key={stock.code}
                                  onClick={() => setCurrentStock(stock)}
                                  className={`px-4 py-3 border-b cursor-pointer hover:bg-blue-50 transition-colors ${currentStock?.code === stock.code ? 'bg-blue-100 border-l-4 border-l-blue-500' : ''}`}
                              >
                                  <div className="font-bold text-gray-800">{stock.name}</div>
                                  <div className="text-xs text-gray-500">{stock.code}</div>
                              </li>
                          ))}
                      </ul>
                  )}
              </div>
          </aside>
  
          {/* Main Content */}
          <section className="flex-1 flex flex-col bg-gray-50 min-w-0">
              {currentStock ? (
                  <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
                      {/* Top Bar: Title & Add to Group */}
                      <div className="bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center">
                          <div className="flex items-baseline gap-2">
                              <h2 className="text-2xl font-bold text-gray-900">{currentStock.name}</h2>
                              <span className="text-gray-500 font-medium">({currentStock.code})</span>
                              <button 
                                  onClick={handleDeleteFromGroup}
                                  className="ml-2 bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded font-bold transition-colors"
                              >
                                  탈락
                              </button>
                          </div>
                          
                          <div className="flex items-center gap-2">
                               <div className="text-red-500 font-bold mr-4 animate-pulse">
                                  🔥 체크: 업종이 상승하나? 거래량은 확인했나?
                               </div>
                               
                               <div className="flex items-center bg-gray-100 p-1 rounded">
                                  <span className="text-xs font-bold text-gray-600 mr-2 ml-1">다른 그룹에 추가:</span>
                                  <select 
                                      className="border rounded p-1 text-sm mr-2"
                                      value={targetGroup}
                                      onChange={(e) => setTargetGroup(e.target.value)}
                                  >
                                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                                  </select>
                                  <button 
                                      onClick={handleAddtoGroup}
                                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded font-bold transition-colors"
                                  >
                                      추가
                                  </button>
                               </div>
                          </div>
                      </div>

                    {/* Charts Area */}
                    <div className="flex-1 flex gap-4 min-h-[400px]">
                        {/* Daily Chart */}
                        <div className="flex-1 bg-white rounded-xl shadow-sm border flex flex-col overflow-hidden">
                            <div className="p-2 border-b bg-gray-50 font-bold text-gray-700 text-center text-sm">일봉 (Daily)</div>
                            <div className="flex-1 relative">
                                {chartLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">로딩 중...</div>
                                ) : (
                                    <StockChart data={dailyData} showLegend={false} />
                                )}
                            </div>
                        </div>
                        {/* Weekly Chart */}
                        <div className="flex-1 bg-white rounded-xl shadow-sm border flex flex-col overflow-hidden">
                            <div className="p-2 border-b bg-gray-50 font-bold text-gray-700 text-center text-sm">주봉 (Weekly)</div>
                            <div className="flex-1 relative">
                                {chartLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">로딩 중...</div>
                                ) : (
                                    <StockChart data={weeklyData} showLegend={false} />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Financials Table */}
                    <div className="bg-white rounded-xl shadow-sm border p-4">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-800">📊 실적 추정 (2024~2027)</h3>
                                <div className="flex bg-gray-100 rounded-lg p-0.5 ml-2">
                                    <button 
                                        onClick={() => setViewMode('server')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'server' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
                                    >
                                        🏢 서버
                                    </button>
                                    <button 
                                        onClick={() => setViewMode('user')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'user' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500'}`}
                                    >
                                        ✏️ 편집
                                    </button>
                                </div>
                            </div>
                            
                            {viewMode === 'user' && (
                                <button 
                                    onClick={handleSaveUserFinancials}
                                    disabled={isSaving}
                                    className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1.5 rounded font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                                >
                                    {isSaving ? '저장 중...' : '💾 저장하기'}
                                </button>
                            )}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-right border-collapse">
                                <thead className="bg-gray-100 text-gray-600">
                                    <tr>
                                        <th className="p-2 border text-center">연도</th>
                                        <th className="p-2 border">매출액 (억원)</th>
                                        <th className="p-2 border">영업이익 (억원)</th>
                                        <th className="p-2 border">당기순이익 (억원)</th>
                                        <th className="p-2 border">매출 성장률 (%)</th>
                                        <th className="p-2 border">영업이익 성장률 (%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {financials.length === 0 ? (
                                        <tr><td colSpan={6} className="p-4 text-center text-gray-400">데이터가 없습니다.</td></tr>
                                    ) : (
                                        financials.filter(f => f.year >= 2024).map(f => {
                                            const prev = financials.find(p => p.year === f.year - 1);
                                            
                                            // Growth Calc
                                            let revGrowth = '-';
                                            if (prev && prev.revenue && f.revenue) {
                                                revGrowth = ((f.revenue - prev.revenue) / prev.revenue * 100).toFixed(1);
                                            }
                                
                                            let opGrowth = '-';
                                            if (prev && prev.op_income && f.op_income) {
                                                const denom = Math.abs(prev.op_income);
                                                if (denom > 0) {
                                                    opGrowth = ((f.op_income - prev.op_income) / denom * 100).toFixed(1);
                                                }
                                            }
                                
                                            // Style
                                            const getStyle = (val: string) => {
                                                if (val === '-') return 'text-gray-500';
                                                const num = parseFloat(val);
                                                if (isNaN(num)) return 'text-gray-500';

                                                let bgClass = '';
                                                if (num > 0) {
                                                    if (num >= 50) bgClass = 'bg-green-500';
                                                    else if (num >= 40) bgClass = 'bg-green-400';
                                                    else if (num >= 30) bgClass = 'bg-green-300';
                                                    else if (num >= 20) bgClass = 'bg-green-200';
                                                    else if (num >= 10) bgClass = 'bg-green-100';
                                                    else bgClass = 'bg-green-50';
                                                } else if (num < 0) {
                                                    const abs = Math.abs(num);
                                                    if (abs >= 50) bgClass = 'bg-red-500';
                                                    else if (abs >= 40) bgClass = 'bg-red-400';
                                                    else if (abs >= 30) bgClass = 'bg-red-300';
                                                    else if (abs >= 20) bgClass = 'bg-red-200';
                                                    else if (abs >= 10) bgClass = 'bg-red-100';
                                                    else bgClass = 'bg-red-50';
                                                }
                                                return `text-black ${bgClass}`;
                                            };

                                            const renderInput = (field: keyof FinancialData, val: number, colorClass: string) => {
                                                if (viewMode === 'server') {
                                                    return <span className={`font-bold ${colorClass}`}>{val.toLocaleString()}</span>;
                                                }
                                                return (
                                                    <input 
                                                        type="text" 
                                                        value={val.toLocaleString()} 
                                                        onChange={(e) => handleFinancialChange(f.year, field, e.target.value)}
                                                        className={`w-full text-right p-1 border rounded outline-none focus:border-blue-500 font-bold ${colorClass}`}
                                                    />
                                                );
                                            };
                                
                                            return (
                                                <tr key={f.year} className="border-b hover:bg-gray-50">
                                                    <td className="p-2 border text-center font-bold">{f.year}</td>
                                                    <td className="p-2 border text-right">
                                                        {renderInput('revenue', f.revenue, 'text-gray-800')}
                                                    </td>
                                                    <td className="p-2 border text-right">
                                                        {renderInput('op_income', f.op_income, 'text-blue-600')}
                                                    </td>
                                                    <td className="p-2 border text-right">
                                                        {renderInput('net_income', f.net_income, 'text-green-600')}
                                                    </td>
                                                    <td className={`p-2 border text-right font-medium ${getStyle(revGrowth)}`}>
                                                        {revGrowth}%
                                                    </td>
                                                    <td className={`p-2 border text-right font-medium ${getStyle(opGrowth)}`}>
                                                        {opGrowth}%
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2">
                    <div className="text-4xl">👈</div>
                    <div>좌측 목록에서 종목을 선택해주세요.</div>
                </div>
            )}
        </section>
      </main>
    </div>
  );
}
