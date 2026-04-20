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

type FinancialsV2Row = {
  year: number;
  quarter: number;
  reprt_code: string;
  fs_div: string; // 'CFS' = 연결, 'OFS' = 별도
  is_consolidated: boolean;
  revenue: number | null;
  cost_of_sales: number | null;
  operating_income: number | null;
  selling_general_administrative_expenses: number | null;
  net_income: number | null;
  assets_total: number | null;
  current_assets: number | null;
  noncurrent_assets: number | null;
  cash_and_cash_equivalents: number | null;
  trade_receivables: number | null;
  inventories: number | null;
  liabilities_total: number | null;
  current_liabilities: number | null;
  noncurrent_liabilities: number | null;
  equity_total: number | null;
  operating_cash_flow: number | null;
  investing_cash_flow: number | null;
  financing_cash_flow: number | null;
};

const getDefaultMultipliers = (type: 'PER' | 'PBR' | 'POR') => {
  if (type === 'PBR') return ['0.5', '1.0', '2.0'];
  return ['10', '15', '20'];
};

const fmt = (val: number | null, unit = 1): string => {
  if (val === null || val === undefined) return '-';
  const n = Math.round(val / unit);
  return n.toLocaleString();
};

const pct = (current: number | null, prev: number | null): number | null => {
  if (current === null || prev === null || prev === 0) return null;
  return ((current - prev) / Math.abs(prev)) * 100;
};

function GrowthBadge({ val }: { val: number | null }) {
  if (val === null) return null;
  const isPos = val >= 0;
  return (
    <span className={`text-xs font-semibold ml-1 ${isPos ? 'text-red-500' : 'text-blue-500'}`}>
      {isPos ? '▲' : '▼'}{Math.abs(val).toFixed(1)}%
    </span>
  );
}

function FinTable({
  title,
  rows,
  years,
  data,
}: {
  title: string;
  rows: { label: string; key: keyof FinancialsV2Row }[];
  years: number[];
  data: FinancialsV2Row[];
}) {
  const UNIT = 100_000_000;
  const getRow = (year: number) => data.find(d => d.year === year) ?? null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-slate-700 mb-2 px-1">{title}</h3>
      <div className="border border-[var(--border)] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--surface-accent)] text-[var(--primary-strong)]">
              <th className="p-2.5 text-left font-semibold w-44 border-r border-blue-100 text-xs">
                항목 <span className="font-normal text-[var(--text-subtle)]">(억원)</span>
              </th>
              {years.map((y) => (
                <th key={y} className="p-2.5 text-right font-semibold text-xs">{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.key} className={`border-t border-[var(--border)] ${ri % 2 === 0 ? 'bg-white' : 'bg-[var(--surface-muted)]'}`}>
                <td className="p-2.5 text-xs font-semibold text-slate-600 border-r border-[var(--border)]">{row.label}</td>
                {years.map((y, yi) => {
                  const cur = getRow(y)?.[row.key] as number | null ?? null;
                  const prev = yi > 0 ? (getRow(years[yi - 1])?.[row.key] as number | null ?? null) : null;
                  const growth = pct(cur, prev);
                  return (
                    <td key={y} className="p-2.5 text-right font-mono text-xs">
                      <span className={cur !== null && cur < 0 ? 'text-blue-600' : 'text-slate-800'}>
                        {fmt(cur, UNIT)}
                      </span>
                      {yi > 0 && <GrowthBadge val={growth} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CompanyAnalysisPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  // ─── 탭 ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'stockInfo' | 'bandChart'>('stockInfo');

  // ─── 공통: 종목 검색 + 관심종목 ─────────────────────────────────────────
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [inputCompany, setInputCompany] = useState('삼성전자');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);
  const [groups, setGroups] = useState<string[]>(['기본 그룹']);
  const [activeGroup, setActiveGroup] = useState<string>('기본 그룹');
  const [showFavorites, setShowFavorites] = useState(false);

  // ─── 종목정보 탭 ─────────────────────────────────────────────────────────
  const [financialsV2, setFinancialsV2] = useState<FinancialsV2Row[]>([]);
  const [isConsolidated, setIsConsolidated] = useState(true);
  const [loadingV2, setLoadingV2] = useState(false);

  // ─── 밴드차트 탭 ─────────────────────────────────────────────────────────
  const [stockData, setStockData] = useState<any[]>([]);
  const [serverFinancials, setServerFinancials] = useState<FinancialData[]>([]);
  const [userFinancials, setUserFinancials] = useState<FinancialData[]>([]);
  const [financialHistory, setFinancialHistory] = useState<FinancialData[]>([]);
  const [viewMode, setViewMode] = useState<'server' | 'user'>('server');
  const [isSaving, setIsSaving] = useState(false);
  const [bandType, setBandType] = useState<'PER' | 'PBR' | 'POR'>('PER');
  const [multipliers, setMultipliers] = useState<string[]>(getDefaultMultipliers('PER'));

  // ─── 회사 목록 로드 ───────────────────────────────────────────────────────
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

  // ─── 관심종목 로드 ────────────────────────────────────────────────────────
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
      let uniqueGroups = Array.from(new Set(loadedFavs.map(f => f.group_name)));
      if (!uniqueGroups.includes('기본 그룹')) uniqueGroups.unshift('기본 그룹');
      const savedGroupOrder = typeof window !== 'undefined' ? localStorage.getItem('groupOrder') : null;
      let combinedGroups = [...uniqueGroups];
      if (savedGroupOrder) {
        try {
          const orderFromStorage: string[] = JSON.parse(savedGroupOrder);
          orderFromStorage.forEach(g => { if (!combinedGroups.includes(g)) combinedGroups.push(g); });
        } catch (e) { console.error(e); }
      }
      combinedGroups = combinedGroups.sort((a, b) => {
        const orderFromStorage: string[] = savedGroupOrder ? JSON.parse(savedGroupOrder) : [];
        const indexA = orderFromStorage.indexOf(a);
        const indexB = orderFromStorage.indexOf(b);
        if (a === '기본 그룹') return -1;
        if (b === '기본 그룹') return 1;
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
      });
      setGroups(combinedGroups);
      setFavorites(loadedFavs);
    }
  }, [supabase]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const toggleFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { alert('로그인이 필요한 기능입니다.'); return; }
    const isFavInGroup = favorites.some(f => f.code === currentCompany.code && f.group_name === activeGroup);
    if (isFavInGroup) {
      const { error } = await supabase.from('user_favorite_stocks').delete()
        .eq('user_id', user.id).eq('company_code', currentCompany.code).eq('group_name', activeGroup);
      if (!error) setFavorites(prev => prev.filter(f => !(f.code === currentCompany.code && f.group_name === activeGroup)));
    } else {
      const { error } = await supabase.from('user_favorite_stocks').insert({
        user_id: user.id, company_code: currentCompany.code,
        company_name: currentCompany.name, group_name: activeGroup
      });
      if (!error) setFavorites(prev => [{ code: currentCompany.code, name: currentCompany.name, group_name: activeGroup }, ...prev]);
    }
  };

  // ─── company_financials_v2 로드 ───────────────────────────────────────────
  const fetchFinancialsV2 = useCallback(async (code: string) => {
    setLoadingV2(true);
    try {
      const { data, error } = await supabase
        .from('company_financials_v2')
        .select([
          'year', 'quarter', 'reprt_code', 'fs_div', 'is_consolidated',
          'revenue', 'cost_of_sales', 'operating_income',
          'selling_general_administrative_expenses', 'net_income',
          'assets_total', 'current_assets', 'noncurrent_assets',
          'cash_and_cash_equivalents', 'trade_receivables', 'inventories',
          'liabilities_total', 'current_liabilities', 'noncurrent_liabilities',
          'equity_total',
          'operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow',
        ].join(','))
        .eq('company_code', code)
        .order('year', { ascending: true })
        .order('quarter', { ascending: true });

      console.log('[v2] raw data count:', data?.length, '| error:', error);
      if (data && data.length > 0) {
        console.log('[v2] sample row:', data[0]);
        const uniqueQuarters = [...new Set(data.map((d: any) => d.quarter))];
        const uniqueReprt = [...new Set(data.map((d: any) => d.reprt_code))];
        const consolidatedVals = [...new Set(data.map((d: any) => d.is_consolidated))];
        console.log('[v2] quarters:', uniqueQuarters, '| reprt_codes:', uniqueReprt, '| is_consolidated:', consolidatedVals);
      }

      if (error) throw error;

      // 연간(사업보고서) 데이터만 추출: reprt_code='11011' 우선, 없으면 quarter=4
      const raw = (data as FinancialsV2Row[]) ?? [];
      const hasAnnual = raw.some(d => d.reprt_code === '11011');
      const annual = hasAnnual
        ? raw.filter(d => d.reprt_code === '11011')
        : raw.filter(d => d.quarter === 4);

      console.log('[v2] annual rows:', annual.length, '(hasAnnual:', hasAnnual, ')');
      setFinancialsV2(annual);
    } catch (e) {
      console.error('[v2] fetch error:', e);
      setFinancialsV2([]);
    } finally {
      setLoadingV2(false);
    }
  }, [supabase]);

  // ─── 밴드차트 데이터 로드 ──────────────────────────────────────────────────
  const loadUserFinancials = useCallback(async (code: string, serverData: FinancialData[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return serverData;
    const { data: customData } = await supabase
      .from('user_custom_financials').select('*')
      .eq('user_id', user.id).eq('company_code', code);
    if (!customData || customData.length === 0) return serverData;
    const getLastKnownShares = (year: number) => {
      let latestYear = -Infinity; let latestShares = 0;
      serverData.forEach(item => { if (item.year <= year && item.shares > 0 && item.year > latestYear) { latestYear = item.year; latestShares = item.shares; } });
      return latestShares;
    };
    const years = new Set<number>([...serverData.map(item => item.year), ...customData.map((item: any) => Number(item.year))]);
    return Array.from(years).sort((a, b) => a - b).map(year => {
      const serverItem = serverData.find(item => item.year === year);
      const custom = customData.find((c: any) => Number(c.year) === year);
      const baseItem: FinancialData = serverItem ? { ...serverItem } : {
        year, net_income: 0, equity: 0, op_income: 0,
        shares: getLastKnownShares(year), eps: 0, bps: 0, ops: 0
      };
      if (custom) {
        if (custom.net_income != null) baseItem.net_income = Number(custom.net_income);
        if (custom.equity_controlling != null) baseItem.equity = Number(custom.equity_controlling);
        if (custom.op_income != null) baseItem.op_income = Number(custom.op_income);
        if (custom.shares_outstanding != null) baseItem.shares = Number(custom.shares_outstanding);
      }
      if (baseItem.shares > 0) {
        baseItem.eps = Math.floor(baseItem.net_income / baseItem.shares);
        baseItem.bps = Math.floor(baseItem.equity / baseItem.shares);
        baseItem.ops = Math.floor(baseItem.op_income / baseItem.shares);
      } else { baseItem.eps = 0; baseItem.bps = 0; baseItem.ops = 0; }
      return baseItem;
    });
  }, [supabase]);

  const loadUserChartSettings = useCallback(async (code: string, type: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const defaults = getDefaultMultipliers(type as any);
    if (!user) return defaults;
    const { data, error } = await supabase
      .from('user_chart_settings').select('multipliers')
      .eq('user_id', user.id).eq('company_code', code).eq('band_type', type).maybeSingle();
    if (error) return defaults;
    if (data && data.multipliers) return data.multipliers.map((m: any) => String(m));
    return defaults;
  }, [supabase]);

  const fetchDatAndFinancials = useCallback(async (code: string) => {
    try {
      const { data: priceData, error: priceError } = await supabase
        .from('daily_prices_v2').select('date, open, high, low, close, volume')
        .eq('code', code).order('date', { ascending: true });
      if (priceError) throw priceError;
      let stockChartData: any[] = [];
      if (priceData && priceData.length > 0) {
        stockChartData = priceData.map(row => {
          let o = Number(row.open); let h = Number(row.high); let l = Number(row.low);
          const c = Number(row.close);
          if (o === 0 && h === 0 && l === 0) { o = c; h = c; l = c; }
          return { time: row.date, open: o, high: h, low: l, close: c, volume: Number(row.volume) };
        });
      }
      setStockData(stockChartData);
      const { data: finData } = await supabase
        .from('company_financials').select('*').eq('company_code', code).order('year', { ascending: true });
      if (finData && finData.length > 0) {
        const maxAllowedYear = new Date().getFullYear() + 10;
        const validData = finData.filter((d: any) => d.year <= maxAllowedYear);
        let lastKnownShares = 0;
        const history: FinancialData[] = validData.map((d: any) => {
          const parseVal = (v: any) => { if (v === null || v === undefined) return 0; return Number(String(v).replace(/,/g, '')) || 0; };
          let shares = parseVal(d.shares_outstanding);
          if (shares > 0) { lastKnownShares = shares; } else if (lastKnownShares > 0) { shares = lastKnownShares; }
          const UNIT = 100000000;
          return {
            year: d.year,
            net_income: parseVal(d.net_income) * UNIT,
            equity: parseVal(d.equity_controlling) * UNIT,
            op_income: parseVal(d.op_income) * UNIT,
            shares,
            eps: shares > 0 ? Math.floor((parseVal(d.net_income) * UNIT) / shares) : 0,
            bps: shares > 0 ? Math.floor((parseVal(d.equity_controlling) * UNIT) / shares) : 0,
            ops: shares > 0 && d.op_income ? Math.floor((parseVal(d.op_income) * UNIT) / shares) : 0,
          };
        });
        return history;
      }
      return [];
    } catch (e) { console.error(e); setStockData([]); return []; }
  }, [supabase]);

  useEffect(() => {
    const loadAll = async () => {
      fetchFinancialsV2(currentCompany.code);
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
  }, [currentCompany, bandType, fetchDatAndFinancials, fetchFinancialsV2, loadUserFinancials, loadUserChartSettings]);

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
        let latestYear = -Infinity; let latestShares = 0;
        items.forEach(item => { if (item.year <= targetYear && item.shares > 0 && item.year > latestYear) { latestYear = item.year; latestShares = item.shares; } });
        return latestShares;
      };
      const existingItem = list.find(item => item.year === year);
      if (existingItem) {
        return list.map(item => {
          if (item.year !== year) return item;
          const newItem = { ...item };
          const shares = newItem.shares > 0 ? newItem.shares : getLastKnownShares(list, year);
          if (shares > 0) newItem.shares = shares;
          if (bandType === 'PER') { newItem.net_income = newValInWon; if (shares > 0) newItem.eps = Math.floor(newItem.net_income / shares); }
          else if (bandType === 'PBR') { newItem.equity = newValInWon; if (shares > 0) newItem.bps = Math.floor(newItem.equity / shares); }
          else if (bandType === 'POR') { newItem.op_income = newValInWon; if (shares > 0) newItem.ops = Math.floor(newItem.op_income / shares); }
          return newItem;
        });
      } else {
        const shares = getLastKnownShares(list, year);
        const newItem: FinancialData = {
          year, net_income: bandType === 'PER' ? newValInWon : 0,
          equity: bandType === 'PBR' ? newValInWon : 0, op_income: bandType === 'POR' ? newValInWon : 0,
          shares, eps: bandType === 'PER' && shares > 0 ? Math.floor(newValInWon / shares) : 0,
          bps: bandType === 'PBR' && shares > 0 ? Math.floor(newValInWon / shares) : 0,
          ops: bandType === 'POR' && shares > 0 ? Math.floor(newValInWon / shares) : 0,
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
        user_id: user.id, company_code: currentCompany.code, year: item.year,
        net_income: item.net_income,
        equity_controlling: Number.isFinite(item.equity) ? item.equity : null,
        op_income: item.op_income,
        shares_outstanding: Number.isFinite(item.shares) ? item.shares : null,
        updated_at: new Date().toISOString()
      }));
      const financialRes = await supabase.from('user_custom_financials')
        .upsert(upsertFinancials, { onConflict: 'user_id, company_code, year' });
      if (financialRes.error) throw financialRes.error;
      const settingRes = await supabase.from('user_chart_settings').upsert({
        user_id: user.id, company_code: currentCompany.code, band_type: bandType,
        multipliers, updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,company_code,band_type' });
      if (settingRes.error) throw settingRes.error;
      alert('재무 데이터와 차트 설정이 모두 저장되었습니다.');
    } catch (e) { console.error(e); alert('저장 중 오류가 발생했습니다.'); }
    finally { setIsSaving(false); }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setInputCompany(val);
    if (val.trim()) { setFilteredCompanies(companyList.filter(c => c.name.includes(val) || c.code.includes(val))); setShowDropdown(true); }
    else setShowDropdown(false);
  };
  const selectCompany = (c: Company) => { setCurrentCompany(c); setInputCompany(c.name); setShowDropdown(false); };

  const getTabLabel = () => {
    if (bandType === 'PER') return { input: '당기순이익', unit: '억원', output: 'EPS' };
    if (bandType === 'PBR') return { input: '자본총계(지배)', unit: '억원', output: 'BPS' };
    return { input: '영업이익', unit: '억원', output: 'OPS' };
  };
  const labels = getTabLabel();

  const bandSettings: BandSettings = {
    type: bandType, financials: financialHistory, multipliers: multipliers.map(m => parseFloat(m) || 0)
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
    if (latestClosePrice > 0 && targetPrice > 0) yieldVal = ((targetPrice - latestClosePrice) / latestClosePrice) * 100;
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
        const indexA = orderCodes.indexOf(a.code); const indexB = orderCodes.indexOf(b.code);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1; if (indexB !== -1) return 1; return 0;
      });
    } catch (e) { return filtered; }
  }, [favorites, activeGroup]);

  // ─── 종목정보 탭 데이터 계산 ─────────────────────────────────────────────
  const filteredV2 = useMemo(() => {
    const targetFsDiv = isConsolidated ? 'CFS' : 'OFS';
    return financialsV2.filter(d => d.fs_div === targetFsDiv);
  }, [financialsV2, isConsolidated]);

  const v2Years = useMemo(() => filteredV2.map(d => d.year), [filteredV2]);

  // 핵심 지표 카드용 (최신 연도)
  const latestV2 = filteredV2.length > 0 ? filteredV2[filteredV2.length - 1] : null;
  const prevV2 = filteredV2.length > 1 ? filteredV2[filteredV2.length - 2] : null;

  const UNIT = 100_000_000;

  const keyMetrics = useMemo(() => {
    if (!latestV2) return [];
    const margin = (latestV2.operating_income != null && latestV2.revenue != null && latestV2.revenue > 0)
      ? (latestV2.operating_income / latestV2.revenue * 100).toFixed(1) : '-';
    const netMargin = (latestV2.net_income != null && latestV2.revenue != null && latestV2.revenue > 0)
      ? (latestV2.net_income / latestV2.revenue * 100).toFixed(1) : '-';
    return [
      { label: '매출액', value: fmt(latestV2.revenue, UNIT), unit: '억원', growth: pct(latestV2.revenue, prevV2?.revenue ?? null) },
      { label: '영업이익', value: fmt(latestV2.operating_income, UNIT), unit: '억원', growth: pct(latestV2.operating_income, prevV2?.operating_income ?? null) },
      { label: '순이익', value: fmt(latestV2.net_income, UNIT), unit: '억원', growth: pct(latestV2.net_income, prevV2?.net_income ?? null) },
      { label: '영업이익률', value: margin, unit: '%', growth: null },
      { label: '순이익률', value: netMargin, unit: '%', growth: null },
      { label: '총자산', value: fmt(latestV2.assets_total, UNIT), unit: '억원', growth: pct(latestV2.assets_total, prevV2?.assets_total ?? null) },
    ];
  }, [latestV2, prevV2]);

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4 lg:px-8 lg:py-6">
      <main className="flex-1 flex gap-6 overflow-hidden relative">

        {/* ─── 좌측 패널 ──────────────────────────────────────────────────── */}
        <div className="app-card-strong w-96 p-6 h-full flex flex-col overflow-y-auto">
          {/* 종목 검색 */}
          <div className="mb-4 relative">
            <input
              type="text"
              className="app-input font-semibold"
              value={inputCompany}
              onChange={handleSearchChange}
              placeholder="종목 검색..."
            />
            {showDropdown && (
              <ul className="absolute z-20 w-full bg-white border border-[var(--border)] mt-2 rounded-2xl max-h-60 overflow-y-auto shadow-[var(--shadow-md)]">
                {filteredCompanies.map(c => (
                  <li key={c.code} onClick={() => selectCompany(c)}
                    className="p-2 hover:bg-[var(--surface-muted)] cursor-pointer text-sm">
                    {c.name} ({c.code})
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 종목정보 탭: 연결/별도 토글 */}
          {activeTab === 'stockInfo' && (
            <div className="flex mb-4 border border-[var(--border)] bg-[var(--surface-muted)] p-1 rounded-2xl">
              <button onClick={() => setIsConsolidated(true)}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${isConsolidated ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-700'}`}>
                연결재무제표
              </button>
              <button onClick={() => setIsConsolidated(false)}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${!isConsolidated ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-700'}`}>
                별도재무제표
              </button>
            </div>
          )}

          {/* 밴드차트 탭: 서버/편집 토글 */}
          {activeTab === 'bandChart' && (
            <>
              <div className="flex mb-4 border border-[var(--border)] bg-[var(--surface-muted)] p-1 rounded-2xl">
                <button onClick={() => setViewMode('server')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${viewMode === 'server' ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-700'}`}>
                  🏢 서버
                </button>
                <button onClick={() => setViewMode('user')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${viewMode === 'user' ? 'bg-white text-emerald-600 shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-700'}`}>
                  ✏️ 편집
                </button>
              </div>

              <h2 className="text-lg font-semibold mb-4 text-slate-900 border-b border-[var(--border)] pb-2 flex justify-between items-center">
                <span>밴드 설정</span>
                {viewMode === 'user' && <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">편집 모드</span>}
              </h2>

              <div className="mb-6">
                <div className="flex bg-[var(--surface-muted)] border border-[var(--border)] p-1 rounded-2xl">
                  {['PER', 'PBR', 'POR'].map(type => (
                    <button key={type} onClick={() => setBandType(type as any)}
                      className={`flex-1 py-1.5 text-sm font-semibold rounded-xl transition-all ${bandType === type ? 'bg-white text-[var(--primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-gray-700'}`}>
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-slate-700">연도별 {labels.input} (단위: {labels.unit})</label>
                </div>
                <div className="border border-[var(--border)] rounded-2xl overflow-hidden bg-[var(--surface-muted)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-accent)] text-[var(--primary-strong)] font-semibold">
                      <tr>
                        <th className="p-2 border-r border-blue-100 w-16 text-center">연도</th>
                        <th className="p-2 text-center">{labels.input}</th>
                      </tr>
                    </thead>
                  </table>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {[2023, 2024, 2025, 2026, 2027].map((year) => {
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
                            <tr key={year} className="border-b border-[var(--border)] last:border-none">
                              <td className="p-2 border-r border-[var(--border)] bg-[var(--surface-muted)] font-semibold text-center w-16">{yearLabel}</td>
                              <td className="p-1">
                                <input
                                  type="text"
                                  readOnly={viewMode === 'server'}
                                  className={`w-full text-right p-1 outline-none font-mono border border-transparent rounded-lg transition-all font-semibold
                                    ${viewMode === 'server' ? 'bg-transparent text-[var(--text-muted)] cursor-default' : 'bg-white focus:border-emerald-400 focus:bg-emerald-50 text-gray-800'}`}
                                  value={valInBillions}
                                  onChange={(e) => { const rawValue = e.target.value.replace(/,/g, ''); handleFinancialChange(year, rawValue); }}
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
                <label className="block text-sm font-semibold text-slate-700 mb-2">멀티플 (배수) 설정</label>
                <div className="flex flex-col gap-2">
                  {multipliers.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${idx===0?'bg-yellow-500':idx===1?'bg-green-500':'bg-blue-500'}`}></span>
                      <span className="text-sm w-12 text-[var(--text-muted)] font-semibold">{idx === 2 ? 'Target' : `Line ${idx+1}`}</span>
                      <input type="number"
                        className="flex-1 border border-[var(--border)] p-1.5 rounded-xl text-center font-medium outline-none focus:border-[var(--primary)] bg-white"
                        value={m}
                        onChange={(e) => { const newM = [...multipliers]; newM[idx] = e.target.value; setMultipliers(newM); }}
                      />
                      <span className="text-sm text-[var(--text-muted)]">배</span>
                    </div>
                  ))}
                </div>
              </div>

              {viewMode === 'user' && (
                <button onClick={saveAllSettings} disabled={isSaving}
                  className="w-full bg-slate-950 hover:bg-slate-800 text-white font-semibold py-3 rounded-2xl transition-all mb-4 disabled:bg-gray-400 disabled:cursor-not-allowed">
                  {isSaving ? '저장 중...' : '💾 나만의 데이터 저장하기'}
                </button>
              )}
              {viewMode === 'server' && (
                <div className="bg-[var(--surface-accent)] p-3 rounded-2xl text-xs text-[var(--primary)] text-center font-medium mb-6">
                  💡 서버 데이터는 수정할 수 없습니다. <br/> '나만의 데이터' 탭에서 편집하세요.
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── 우측 메인 패널 ──────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="app-card-strong p-6 flex flex-col h-full overflow-hidden">

            {/* 회사명 + 즐겨찾기 헤더 */}
            <div className="mb-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-semibold text-slate-950">
                    {currentCompany.name}
                    <span className="text-xl text-[var(--text-subtle)] font-normal ml-2">({currentCompany.code})</span>
                  </h2>
                  <button onClick={toggleFavorite}
                    className={`text-2xl focus:outline-none transition-transform hover:scale-110 ${isFavorite ? 'text-amber-400' : 'text-gray-300'}`}
                    title={`${activeGroup}에 ${isFavorite ? '삭제' : '추가'}`}>
                    {isFavorite ? '⭐' : '☆'}
                  </button>
                </div>
                <button onClick={() => setShowFavorites(!showFavorites)}
                  className={`px-4 py-2 rounded-2xl font-semibold text-sm transition-all ${showFavorites ? 'bg-amber-400 text-slate-950' : 'bg-[var(--surface-muted)] text-[var(--text-muted)] hover:bg-[var(--surface-strong)]'}`}>
                  {showFavorites ? '✕ 관심종목 닫기' : '⭐ 관심종목'}
                </button>
              </div>

              {/* 탭 네비게이션 */}
              <div className="flex gap-1 border-b border-[var(--border)]">
                {[
                  { key: 'stockInfo', label: '종목정보' },
                  { key: 'bandChart', label: '밴드차트' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`px-5 py-2.5 text-sm font-semibold rounded-t-xl transition-all border-b-2 -mb-px
                      ${activeTab === tab.key
                        ? 'border-[var(--primary)] text-[var(--primary-strong)] bg-[var(--surface-accent)]'
                        : 'border-transparent text-[var(--text-muted)] hover:text-slate-700 hover:bg-[var(--surface-muted)]'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─── 탭 컨텐츠 ────────────────────────────────────────────────── */}

            {/* === 종목정보 탭 === */}
            {activeTab === 'stockInfo' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                {loadingV2 ? (
                  <div className="flex items-center justify-center h-40 text-[var(--text-subtle)] text-sm">
                    데이터 로딩 중...
                  </div>
                ) : filteredV2.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-[var(--text-subtle)] text-sm gap-2">
                    <span className="text-3xl">📊</span>
                    <span>재무 데이터가 없습니다.</span>
                    <span className="text-xs text-[var(--text-subtle)]">{isConsolidated ? '연결' : '별도'} 재무제표 데이터가 아직 수집되지 않았습니다.</span>
                  </div>
                ) : (
                  <>
                    {/* 핵심 지표 카드 */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                      {keyMetrics.map(metric => (
                        <div key={metric.label} className="bg-[var(--surface-muted)] border border-[var(--border)] rounded-2xl p-4">
                          <div className="text-xs text-[var(--text-muted)] font-semibold mb-1">{metric.label}</div>
                          <div className="text-xl font-bold text-slate-900 font-mono">
                            {metric.value}
                            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">{metric.unit}</span>
                          </div>
                          {metric.growth !== null && (
                            <div className={`text-xs font-semibold mt-1 ${metric.growth >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                              {metric.growth >= 0 ? '▲' : '▼'} {Math.abs(metric.growth).toFixed(1)}% YoY
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 연도 범위 표시 */}
                    <div className="text-xs text-[var(--text-subtle)] mb-4 font-medium">
                      {isConsolidated ? '연결' : '별도'} 재무제표 · 연간 기준 · {v2Years[0]}~{v2Years[v2Years.length - 1]}년
                      <span className="ml-2 text-[var(--text-subtle)]">(단위: 억원)</span>
                    </div>

                    {/* 손익계산서 */}
                    <FinTable
                      title="손익계산서"
                      years={v2Years}
                      data={filteredV2}
                      rows={[
                        { label: '매출액', key: 'revenue' },
                        { label: '매출원가', key: 'cost_of_sales' },
                        { label: '판관비', key: 'selling_general_administrative_expenses' },
                        { label: '영업이익', key: 'operating_income' },
                        { label: '당기순이익', key: 'net_income' },
                      ]}
                    />

                    {/* 재무상태표 */}
                    <FinTable
                      title="재무상태표"
                      years={v2Years}
                      data={filteredV2}
                      rows={[
                        { label: '자산총계', key: 'assets_total' },
                        { label: '유동자산', key: 'current_assets' },
                        { label: '현금및현금성자산', key: 'cash_and_cash_equivalents' },
                        { label: '매출채권', key: 'trade_receivables' },
                        { label: '재고자산', key: 'inventories' },
                        { label: '비유동자산', key: 'noncurrent_assets' },
                        { label: '부채총계', key: 'liabilities_total' },
                        { label: '유동부채', key: 'current_liabilities' },
                        { label: '비유동부채', key: 'noncurrent_liabilities' },
                        { label: '자본총계', key: 'equity_total' },
                      ]}
                    />

                    {/* 현금흐름표 */}
                    <FinTable
                      title="현금흐름표"
                      years={v2Years}
                      data={filteredV2}
                      rows={[
                        { label: '영업활동현금흐름', key: 'operating_cash_flow' },
                        { label: '투자활동현금흐름', key: 'investing_cash_flow' },
                        { label: '재무활동현금흐름', key: 'financing_cash_flow' },
                      ]}
                    />
                  </>
                )}
              </div>
            )}

            {/* === 밴드차트 탭 === */}
            {activeTab === 'bandChart' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* 목표가 표시 */}
                <div className="flex gap-4 text-sm mb-2 flex-shrink-0">
                  {[target26, target27].map(target => (
                    <div key={target.label} className="flex gap-2 items-center bg-[var(--surface-muted)] px-3 py-1.5 rounded-2xl border border-[var(--border)]">
                      <span className="font-semibold text-slate-800">{target.label}:</span>
                      <span className="font-mono text-slate-900">{target.price.toLocaleString()}원</span>
                      <span className={`font-bold ${target.yield > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                        ({target.yield > 0 ? '+' : ''}{target.yield.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mb-2 text-[var(--text-muted)] text-sm flex-shrink-0">
                  {financialHistory.length > 0 && `최신 ${labels.output}: ${currentBaseValue.toLocaleString()}원`} × [{multipliers.join(', ')}] 배
                </div>
                <div className="flex-1 w-full border border-[var(--border)] rounded-[20px] overflow-hidden bg-[var(--surface-muted)] min-h-0 relative">
                  {stockData.length > 0 ? (
                    <div className="absolute inset-0">
                      <BandChart data={stockData} settings={bandSettings} />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">데이터 로딩 중...</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── 관심종목 패널 ───────────────────────────────────────────────── */}
        {showFavorites && (
          <div className="w-80 app-card-strong p-4 h-full flex flex-col overflow-hidden transition-all duration-300">
            <h2 className="text-lg font-semibold mb-3 text-slate-900 border-b border-[var(--border)] pb-2">⭐ 관심 종목</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 border-b border-[var(--border)] shrink-0">
              {groups.map(group => (
                <button key={group} onClick={() => setActiveGroup(group)}
                  className={`px-3 py-1 text-xs rounded-full font-semibold whitespace-nowrap transition-all
                    ${activeGroup === group ? 'bg-amber-400 text-slate-950' : 'bg-[var(--surface-muted)] text-[var(--text-muted)] hover:bg-[var(--surface-strong)]'}`}>
                  {group} ({favorites.filter(f => f.group_name === group).length})
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              {currentGroupFavorites.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {currentGroupFavorites.map(fav => (
                    <li key={`${fav.code}-${fav.group_name}`}
                      onClick={() => selectCompany({ name: fav.name, code: fav.code })}
                      className={`p-2 rounded-2xl border cursor-pointer transition-all
                        ${currentCompany.code === fav.code ? 'bg-[var(--surface-accent)] border-[var(--primary-soft)] ring-1 ring-[var(--primary-soft)]' : 'bg-white border-[var(--border)] hover:bg-[var(--surface-muted)]'}`}>
                      <div className="font-semibold text-slate-900 text-sm">{fav.name}</div>
                      <div className="text-xs text-[var(--text-subtle)]">{fav.code}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-[var(--text-subtle)] text-xs border-2 border-dashed border-[var(--border)] rounded-2xl bg-[var(--surface-muted)]">
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
