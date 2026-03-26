'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

type PortfolioPosition = {
  id: string;
  entry_date: string;
  trade_type: string;
  company_code: string;
  company_name: string;
  position_type: string;
  position_size: number;
  avg_price: number;
  stop_loss: number;
  initial_position_size: number;
  realized_pnl: number;
  sector: string;
  comment: string;
  is_closed: boolean;
  close_date: string | null;
  // 계산 값
  current_price?: number;
  unrealized_pnl?: number;
  total_pnl?: number;
  r_value?: number;
  pnl_ratio?: number;
  atr?: number;
  is_custom_asset?: boolean;
  manual_current_price?: number | null;
  sold_quantity?: number;
  remaining_position_size?: number;
  is_transaction_log?: boolean;
};

type FormData = Omit<PortfolioPosition, 'id' | 'current_price' | 'unrealized_pnl' | 'total_pnl' | 'r_value' | 'pnl_ratio' | 'atr' | 'is_closed' | 'close_date'>;

type SectorAllocation = {
  sector: string;
  amount: number;
  percentage: number;
  color: string;
};

type AllocationBasis = 'cost' | 'market';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D', '#C77DFF', '#38B000'];

const getCurrentMonthStart = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

const getTodayDate = (): string => {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
};

const getClosedEventDate = (position: PortfolioPosition): string | null => {
  return position.close_date || null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return '알 수 없는 오류';
};

export default function PortfolioManagementPage() {
  const supabase = createClientComponentClient();

  const [currentTab, setCurrentTab] = useState<'active' | 'closed'>('active');
  const [viewMode, setViewMode] = useState<'table' | 'sector'>('table');
  const [sectorAllocationBasis, setSectorAllocationBasis] = useState<AllocationBasis>('market');
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellingPosition, setSellingPosition] = useState<PortfolioPosition | null>(null);
  const [sellAmount, setSellAmount] = useState(0);
  const [sellRealizedPnl, setSellRealizedPnl] = useState(0);
  const [sellDate, setSellDate] = useState(() => getTodayDate());
  const [cash, setCash] = useState<number>(0);
  const [isEditingCash, setIsEditingCash] = useState(false);
  const [sortField, setSortField] = useState<'entry_date' | 'close_date' | 'company_name' | 'evaluation' | 'sector' | 'pnl_ratio' | 'unrealized_pnl' | 'realized_pnl' | 'total_pnl' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAmountHidden, setIsAmountHidden] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [showTableDetails, setShowTableDetails] = useState(false);
  const [closedFromDate, setClosedFromDate] = useState<string>(() => getCurrentMonthStart());
  const [closedToDate, setClosedToDate] = useState<string>(() => getTodayDate());

  // 종목 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const createEmptyForm = (): FormData => ({
    entry_date: getTodayDate(),
    trade_type: '',
    company_code: '',
    company_name: '',
    position_type: '롱',
    position_size: 0,
    avg_price: 0,
    stop_loss: 0,
    initial_position_size: 0,
    realized_pnl: 0,
    sector: '',
    comment: '',
    is_custom_asset: false,
    manual_current_price: null,
  });

  const [formData, setFormData] = useState<FormData>(() => createEmptyForm());

  // 현금 로드
  useEffect(() => {
    const savedCash = localStorage.getItem('portfolio_cash');
    if (savedCash) {
      setCash(parseFloat(savedCash));
    }
  }, []);

  // 현금 저장
  const saveCash = (amount: number) => {
    setCash(amount);
    localStorage.setItem('portfolio_cash', amount.toString());
  };

  // 금액 포맷팅 (항상 표시)
  const formatAmount = (amount: number): string => {
    return amount.toLocaleString();
  };

  // 총 자산 칸에서만 사용하는 숨김 처리
  const formatAssetAmount = (amount: number): string => {
    if (isAmountHidden) {
      return '****';
    }
    return amount.toLocaleString();
  };

  // 정렬 함수
  const handleSort = (field: 'entry_date' | 'close_date' | 'company_name' | 'evaluation' | 'sector' | 'pnl_ratio' | 'unrealized_pnl' | 'realized_pnl' | 'total_pnl') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // 정렬된 포지션 목록
  const filteredPositions = useMemo(() => {
    if (currentTab !== 'closed') return positions;

    return positions.filter(position => {
      const closedEventDate = getClosedEventDate(position);
      if (!closedEventDate) return false;
      if (closedEventDate < closedFromDate) return false;
      if (closedToDate && closedEventDate > closedToDate) return false;
      return true;
    });
  }, [positions, currentTab, closedFromDate, closedToDate]);

  const filteredRealizedPnlSum = useMemo(() => {
    if (currentTab !== 'closed') return 0;
    return filteredPositions.reduce((sum, position) => sum + (position.realized_pnl || 0), 0);
  }, [filteredPositions, currentTab]);

  const sortedPositions = useMemo(() => {
    if (!sortField) return filteredPositions;

    const sorted = [...filteredPositions].sort((a, b) => {
      let compareA: string | number;
      let compareB: string | number;

      switch (sortField) {
        case 'entry_date':
          compareA = a.entry_date;
          compareB = b.entry_date;
          break;
        case 'close_date':
          compareA = getClosedEventDate(a) || '';
          compareB = getClosedEventDate(b) || '';
          break;
        case 'company_name':
          compareA = a.company_name;
          compareB = b.company_name;
          break;
        case 'evaluation':
          compareA = (a.current_price || 0) * a.position_size;
          compareB = (b.current_price || 0) * b.position_size;
          break;
        case 'sector':
          compareA = a.sector;
          compareB = b.sector;
          break;
        case 'pnl_ratio':
          compareA = a.pnl_ratio || 0;
          compareB = b.pnl_ratio || 0;
          break;
        case 'unrealized_pnl':
          compareA = a.unrealized_pnl || 0;
          compareB = b.unrealized_pnl || 0;
          break;
        case 'realized_pnl':
          compareA = a.realized_pnl || 0;
          compareB = b.realized_pnl || 0;
          break;
        case 'total_pnl':
          compareA = a.total_pnl || 0;
          compareB = b.total_pnl || 0;
          break;
        default:
          return 0;
      }

      if (compareA < compareB) return sortOrder === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredPositions, sortField, sortOrder]);

  // 총 자산 계산 (롱 포지션 평가금액 + 현금)
  const totalAssets = useMemo(() => {
    const longPositionsValue = positions
      .filter(p => p.position_type === '롱')
      .reduce((sum, p) => sum + ((p.current_price || 0) * p.position_size), 0);
    return longPositionsValue + cash;
  }, [positions, cash]);

  // 현재 포지션 개수와 R 총합
  const positionStats = useMemo(() => {
    if (currentTab !== 'active') return { count: 0, totalR: 0 };

    const uniqueCodes = new Set(positions.map(p => p.company_code));
    const count = uniqueCodes.size;
    const totalR = positions.reduce((sum, p) => sum + (p.r_value || 0), 0);

    return { count, totalR };
  }, [positions, currentTab]);

  // 업종별 집계 계산 (R 합산 및 평가손익 추가)
  type SectorAllocationWithR = SectorAllocation & { totalR: number; unrealizedPnl: number; returnRate: number; costAmount: number; marketAmount: number };

  const allocationAmountLabel = sectorAllocationBasis === 'cost' ? '투자금액' : '평가금액';
  const allocationTotalLabel = sectorAllocationBasis === 'cost' ? '총 투자금액' : '총 평가금액';

  const sectorAllocations = useMemo<SectorAllocationWithR[]>(() => {
    if (currentTab !== 'active' || positions.length === 0) return [];

    const sectorMap = new Map<string, { costAmount: number; marketAmount: number; totalR: number; unrealizedPnl: number }>();

    positions.forEach(p => {
      const costAmount = p.avg_price * p.position_size;
      const marketAmount = (p.current_price || 0) * p.position_size;
      const sector = p.sector || '기타';
      const existing = sectorMap.get(sector) || { costAmount: 0, marketAmount: 0, totalR: 0, unrealizedPnl: 0 };
      sectorMap.set(sector, {
        costAmount: existing.costAmount + costAmount,
        marketAmount: existing.marketAmount + marketAmount,
        totalR: existing.totalR + (p.r_value || 0),
        unrealizedPnl: existing.unrealizedPnl + (p.unrealized_pnl || 0)
      });
    });

    if (cash > 0) {
      sectorMap.set('현금', { costAmount: cash, marketAmount: cash, totalR: 0, unrealizedPnl: 0 });
    }

    const totalAmount = Array.from(sectorMap.values()).reduce((sum, val) => (
      sum + (sectorAllocationBasis === 'cost' ? val.costAmount : val.marketAmount)
    ), 0);

    const allocations: SectorAllocationWithR[] = Array.from(sectorMap.entries()).map(([sector, data], index) => ({
      sector,
      amount: sectorAllocationBasis === 'cost' ? data.costAmount : data.marketAmount,
      costAmount: data.costAmount,
      marketAmount: data.marketAmount,
      totalR: data.totalR,
      unrealizedPnl: data.unrealizedPnl,
      returnRate: data.costAmount > 0 ? (data.unrealizedPnl / data.costAmount) * 100 : 0,
      percentage: totalAmount > 0 ? ((sectorAllocationBasis === 'cost' ? data.costAmount : data.marketAmount) / totalAmount) * 100 : 0,
      color: COLORS[index % COLORS.length]
    }));

    return allocations.sort((a, b) => b.percentage - a.percentage);
  }, [positions, cash, currentTab, sectorAllocationBasis]);

  const showSummaryTable = currentTab === 'active' && viewMode === 'table' && !showTableDetails;
  const showDetailedTable = (currentTab === 'closed' || viewMode === 'table') && !showSummaryTable;

  // 포트폴리오 목록 조회
  const calculateATR = useCallback(async (code: string): Promise<number> => {
    try {
      const { data, error } = await supabase
        .from('daily_prices_v2')
        .select('date, high, low, close')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(21);

      if (error || !data || data.length < 20) {
        console.log('ATR 계산 실패: 데이터 부족', code);
        return 0;
      }

      const sortedData = [...data].reverse();
      const trueRanges: number[] = [];

      for (let i = 1; i < sortedData.length; i++) {
        const current = sortedData[i];
        const previous = sortedData[i - 1];

        const tr = Math.max(
          current.high - current.low,
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close)
        );

        trueRanges.push(tr);
      }

      return trueRanges.slice(-20).reduce((sum, tr) => sum + tr, 0) / 20;
    } catch (error) {
      console.error('ATR 계산 오류:', error);
      return 0;
    }
  }, [supabase]);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let baseRows: PortfolioPosition[] = [];

      if (currentTab === 'closed') {
        let transactionQuery = supabase
          .from('user_portfolio_transactions')
          .select('*')
          .eq('user_id', user.id);

        if (closedFromDate) {
          transactionQuery = transactionQuery.gte('transaction_date', closedFromDate);
        }

        if (closedToDate) {
          transactionQuery = transactionQuery.lte('transaction_date', closedToDate);
        }

        const { data: transactionData, error: transactionError } = await transactionQuery
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false });

        if (transactionError) throw transactionError;

        let legacyClosedQuery = supabase
          .from('user_portfolio')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_closed', true);

        if (closedFromDate) {
          legacyClosedQuery = legacyClosedQuery.gte('close_date', closedFromDate);
        }

        if (closedToDate) {
          legacyClosedQuery = legacyClosedQuery.lte('close_date', closedToDate);
        }

        const { data: legacyClosedData, error: legacyClosedError } = await legacyClosedQuery
          .order('close_date', { ascending: false });

        if (legacyClosedError) throw legacyClosedError;

        const loggedPortfolioIds = new Set((transactionData || []).map(t => t.portfolio_id));

        const transactionRows: PortfolioPosition[] = (transactionData || []).map(t => ({
          id: t.id,
          entry_date: t.entry_date || t.transaction_date,
          trade_type: t.trade_type || '매도',
          company_code: t.company_code,
          company_name: t.company_name,
          position_type: t.position_type || '롱',
          position_size: Number(t.quantity || 0),
          avg_price: Number(t.avg_price || 0),
          stop_loss: Number(t.stop_loss || 0),
          initial_position_size: Number(t.initial_position_size || t.quantity || 0),
          realized_pnl: Number(t.realized_pnl || 0),
          sector: t.sector || '',
          comment: t.comment || '',
          is_closed: Number(t.remaining_position_size || 0) === 0,
          close_date: t.transaction_date,
          is_custom_asset: t.is_custom_asset || false,
          manual_current_price: t.manual_current_price,
          sold_quantity: Number(t.quantity || 0),
          remaining_position_size: Number(t.remaining_position_size || 0),
          is_transaction_log: true,
        }));

        const legacyRows: PortfolioPosition[] = (legacyClosedData || [])
          .filter(p => !loggedPortfolioIds.has(p.id))
          .map(p => ({
            ...p,
            sold_quantity: Number(p.initial_position_size || p.position_size || 0),
            remaining_position_size: Number(p.position_size || 0),
            is_transaction_log: false,
          }));

        baseRows = [...transactionRows, ...legacyRows];
      } else {
        const { data: portfolioData, error } = await supabase
          .from('user_portfolio')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_closed', false)
          .order('entry_date', { ascending: false });

        if (error) throw error;
        baseRows = (portfolioData || []) as PortfolioPosition[];
      }

      if (baseRows.length === 0) {
        setPositions([]);
        return;
      }

      const tradablePositions = baseRows.filter(p => !p.is_custom_asset);
      const codes = [...new Set(tradablePositions.map(p => p.company_code))];

      let latestDate: string | undefined;
      if (currentTab === 'active' && codes.length > 0) {
        const { data: dateData } = await supabase
          .from('daily_prices_v2')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .single();

        latestDate = dateData?.date;
      }

      const { data: priceData } = currentTab === 'active' && codes.length > 0 && latestDate
        ? await supabase
          .from('daily_prices_v2')
          .select('code, close')
          .in('code', codes)
          .eq('date', latestDate)
        : { data: null };

      const priceMap = new Map<string, number>();
      if (priceData) {
        priceData.forEach(p => priceMap.set(p.code, p.close));
      }

      const atrMap = new Map<string, number>();
      if (currentTab === 'active') {
        for (const code of codes) {
          const atr = await calculateATR(code);
          if (atr > 0) {
            atrMap.set(code, atr);
          }
        }
      }

      const enrichedData: PortfolioPosition[] = baseRows.map(p => {
        const current_price = p.is_custom_asset && p.manual_current_price
          ? p.manual_current_price
          : (priceMap.get(p.company_code) || 0);
        const unrealized_pnl = (current_price - p.avg_price) * p.position_size;
        const total_pnl = unrealized_pnl + (p.realized_pnl || 0);
        const riskSize = currentTab === 'closed'
          ? (p.sold_quantity || p.initial_position_size || p.position_size)
          : p.initial_position_size;
        const r_value = (p.avg_price - p.stop_loss) * riskSize * (p.position_type === '숏' ? -1 : 1);
        const pnl_ratio = r_value !== 0
          ? (currentTab === 'closed' ? (p.realized_pnl || 0) / r_value : total_pnl / r_value)
          : 0;
        const atr_value = p.is_custom_asset ? 0 : (atrMap.get(p.company_code) || 0);
        const position_for_atr = currentTab === 'closed'
          ? (p.sold_quantity || p.initial_position_size || p.position_size)
          : p.position_size;
        const atr = atr_value * position_for_atr;

        return {
          ...p,
          current_price,
          unrealized_pnl,
          total_pnl,
          r_value,
          pnl_ratio,
          atr,
        };
      });

      setPositions(enrichedData);
    } catch (error) {
      console.error('Error fetching positions:', error);
    } finally {
      setLoading(false);
    }
  }, [calculateATR, supabase, currentTab, closedFromDate, closedToDate]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // 종목 검색
  const searchCompanies = async (query: string) => {
    if (formData.is_custom_asset || !query || query.length < 1) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('companies')
        .select('code, name')
        .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
        .limit(10);

      if (error) throw error;

      if (data) {
        setSearchResults(data);
        setShowSearchResults(true);
      }
    } catch (error) {
      console.error('Error searching companies:', error);
    }
  };

  // 종목 선택
  const selectCompany = (code: string, name: string) => {
    setFormData({
      ...formData,
      company_code: code,
      company_name: name,
      is_custom_asset: false,
      manual_current_price: null,
    });
    setSearchQuery(name);
    setShowSearchResults(false);
  };

  // 포지션 추가
  const handleAdd = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      if (formData.is_custom_asset && (!formData.company_name || !formData.company_code)) {
        alert('??? ??? ???? ????? ??? ???.');
        return;
      }

      if (formData.is_custom_asset && (!formData.manual_current_price || formData.manual_current_price <= 0)) {
        alert('??? ??? ???? ??? ???.');
        return;
      }

      // initial_position_size를 명시적으로 설정
      const { error } = await supabase
        .from('user_portfolio')
        .insert({
          user_id: user.id,
          ...formData,
          initial_position_size: formData.position_size, // 최초 포지션 규모 설정
        });

      if (error) throw error;

      alert('포지션이 추가되었습니다.');
      setShowAddModal(false);
      setFormData(createEmptyForm());
      setSearchQuery('');
      setSearchResults([]);
      setShowSearchResults(false);
      fetchPositions();
    } catch (error: unknown) {
      console.error('Error adding position:', error);
      alert('추가 실패: ' + getErrorMessage(error));
    }
  };

  // 포지션 수정
  const handleUpdate = async (id: string) => {
    try {
      const position = positions.find(p => p.id === id);
      if (!position) return;

      const { error } = await supabase
        .from('user_portfolio')
        .update({
          entry_date: position.entry_date,
          trade_type: position.trade_type,
          company_code: position.company_code,
          company_name: position.company_name,
          position_type: position.position_type,
          position_size: position.position_size,
          avg_price: position.avg_price,
          stop_loss: position.stop_loss,
          initial_position_size: position.initial_position_size,
          realized_pnl: position.realized_pnl,
          sector: position.sector,
          comment: position.comment,
          is_closed: position.is_closed,
          close_date: position.close_date,
          is_custom_asset: position.is_custom_asset,
          manual_current_price: position.manual_current_price,
        })
        .eq('id', id);

      if (error) throw error;

      alert('수정되었습니다.');
      setEditingId(null);
      fetchPositions();
    } catch (error: unknown) {
      console.error('Error updating position:', error);
      alert('수정 실패: ' + getErrorMessage(error));
    }
  };

  // 포지션 삭제
  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      const { error } = await supabase
        .from('user_portfolio')
        .delete()
        .eq('id', id);

      if (error) throw error;

      alert('삭제되었습니다.');
      fetchPositions();
    } catch (error: unknown) {
      console.error('Error deleting position:', error);
      alert('삭제 실패: ' + getErrorMessage(error));
    }
  };

  // 필드 변경 핸들러
  const handleFieldChange = (id: string, field: keyof PortfolioPosition, value: string | number | boolean | null) => {
    setPositions(prev =>
      prev.map(p =>
        p.id === id ? { ...p, [field]: value } : p
      )
    );
  };

  // 일부 매도 모달 열기
  const openSellModal = (position: PortfolioPosition) => {
    setSellingPosition(position);
    setSellAmount(0);
    setSellRealizedPnl(0);
    setSellDate(getTodayDate());
    setShowSellModal(true);
  };

  // 일부 매도 실행
  const handlePartialSell = async () => {
    if (!sellingPosition) return;

    if (sellAmount <= 0 || sellAmount > sellingPosition.position_size) {
      alert('매도 물량이 올바르지 않습니다.');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('record_portfolio_sell', {
        p_portfolio_id: sellingPosition.id,
        p_sell_quantity: sellAmount,
        p_realized_pnl: sellRealizedPnl,
        p_sell_date: sellDate,
      });

      if (error) throw error;

      const isClosed = Number(data?.remaining_position_size || 0) === 0;

      if (isClosed) {
        alert(`${sellAmount}주 매도 완료\n실현 손익: ${sellRealizedPnl.toLocaleString()}원\n\n🎉 포지션이 청산되었습니다!`);
      } else {
        alert(`${sellAmount}주 매도 완료\n실현 손익: ${sellRealizedPnl.toLocaleString()}원`);
      }

      setShowSellModal(false);
      setSellingPosition(null);
      setSellAmount(0);
      setSellRealizedPnl(0);
      setSellDate(getTodayDate());
      fetchPositions();
    } catch (error: unknown) {
      console.error('Error selling position:', error);
      alert('매도 실패: ' + getErrorMessage(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="app-card-strong p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-950">포트폴리오 관리</h1>
              <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
                {currentTab === 'active' ? `${positionStats.count}개 종목` : `${filteredPositions.length}건 청산`}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
              <span>총 자산 {formatAssetAmount(totalAssets)}원</span>
              <span>현금 {formatAssetAmount(cash)}원</span>
              {currentTab === 'active' && <span>R 합계 {formatAssetAmount(positionStats.totalR)}원</span>}
              {currentTab === 'closed' && <span>실현손익 {formatAmount(filteredRealizedPnlSum)}원</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsAmountHidden(!isAmountHidden)}
              className="rounded-2xl border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
            >
              {isAmountHidden ? '금액 보기' : '금액 숨기기'}
            </button>
            {viewMode === 'table' && currentTab === 'active' && (
              <button
                onClick={() => setShowTableDetails(prev => !prev)}
                className="rounded-2xl border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              >
                {showTableDetails ? '간단히보기' : '자세히보기'}
              </button>
            )}
            {currentTab === 'active' && (
              <button
                onClick={() => {
                  setFormData(createEmptyForm());
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowSearchResults(false);
                  setShowAddModal(true);
                }}
                className="rounded-2xl bg-slate-950 px-4 py-2 font-semibold text-white hover:bg-slate-800"
              >
                포지션 추가
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setCurrentTab('active');
              setViewMode('table');
            }}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${
              currentTab === 'active'
                ? 'bg-slate-950 text-white shadow-[var(--shadow-sm)]'
                : 'border border-[var(--border)] bg-white text-gray-600 hover:bg-[var(--surface-muted)]'
            }`}
          >
            현재 포지션
          </button>
          <button
            onClick={() => {
              setCurrentTab('closed');
              setViewMode('table');
            }}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${
              currentTab === 'closed'
                ? 'bg-slate-700 text-white shadow-[var(--shadow-sm)]'
                : 'border border-[var(--border)] bg-white text-gray-600 hover:bg-[var(--surface-muted)]'
            }`}
          >
            청산 매매
          </button>

          {currentTab === 'active' && (
            <>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              <button
                onClick={() => setViewMode('table')}
                className={`rounded-2xl px-3 py-2 text-sm font-medium transition-all ${
                  viewMode === 'table'
                    ? 'border border-[var(--primary-soft)] bg-[var(--surface-accent)] text-[var(--primary)]'
                    : 'bg-[var(--surface-muted)] text-gray-600 hover:bg-[var(--surface-strong)]'
                }`}
              >
                테이블
              </button>
              <button
                onClick={() => setViewMode('sector')}
                className={`rounded-2xl px-3 py-2 text-sm font-medium transition-all ${
                  viewMode === 'sector'
                    ? 'border border-[var(--primary-soft)] bg-[var(--surface-accent)] text-[var(--primary)]'
                    : 'bg-[var(--surface-muted)] text-gray-600 hover:bg-[var(--surface-strong)]'
                }`}
              >
                업종별 비중
              </button>
            </>
          )}
        </div>

      </div>

      {!isAmountHidden && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="app-card-strong p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">총 자산</div>
            <div className="mt-2 text-2xl font-bold text-slate-950">{formatAssetAmount(totalAssets)}원</div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">평가금액 + 현금</div>
          </div>

          <div className="app-card-strong p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">보유 현금</div>
                {isEditingCash ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      value={cash}
                      onChange={e => setCash(parseFloat(e.target.value) || 0)}
                      className="w-40 rounded-xl border border-[var(--border)] px-3 py-1 text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        saveCash(cash);
                        setIsEditingCash(false);
                      }}
                      className="rounded-xl bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
                    >
                      저장
                    </button>
                    <button
                      onClick={() => {
                        setCash(parseFloat(localStorage.getItem('portfolio_cash') || '0'));
                        setIsEditingCash(false);
                      }}
                      className="rounded-xl bg-gray-400 px-3 py-1 text-sm text-white hover:bg-gray-500"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 text-2xl font-bold text-slate-950">{formatAssetAmount(cash)}원</div>
                )}
              </div>
              {!isEditingCash && (
                <button
                  onClick={() => setIsEditingCash(true)}
                  className="rounded-xl border border-[var(--border)] bg-white px-3 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                >
                  수정
                </button>
              )}
            </div>
          </div>

          <div className="app-card-strong p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {currentTab === 'active' ? '포지션 수' : '청산 건수'}
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-950">
              {currentTab === 'active' ? `${positionStats.count}개` : `${filteredPositions.length}건`}
            </div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">
              {currentTab === 'active' ? '보유 종목 기준' : '필터 적용 기준'}
            </div>
          </div>

          <div className="app-card-strong p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {currentTab === 'active' ? 'R 합계' : '실현손익'}
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-950">
              {currentTab === 'active' ? `${formatAssetAmount(positionStats.totalR)}원` : `${formatAmount(filteredRealizedPnlSum)}원`}
            </div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">
              {currentTab === 'active' ? '현재 포지션 리스크 총합' : '기간 내 청산 합계'}
            </div>
          </div>
        </div>
      )}

      {currentTab === 'closed' && (
        <div className="app-card-strong p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">매도 날짜:</span>
              <input
                type="date"
                value={closedFromDate}
                onChange={e => setClosedFromDate(e.target.value)}
                className="px-3 py-1 border rounded"
              />
              <span className="text-gray-500">~</span>
              <input
                type="date"
                value={closedToDate}
                onChange={e => setClosedToDate(e.target.value)}
                className="px-3 py-1 border rounded"
              />
              <button
                onClick={() => {
                  setClosedFromDate(getCurrentMonthStart());
                  setClosedToDate(getTodayDate());
                }}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
              >
                This Month
              </button>
            </div>
            <div className="text-sm">
              <span className="text-gray-700">실현손익 합계:</span>{' '}
              <span className={`font-bold ${filteredRealizedPnlSum >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {formatAmount(filteredRealizedPnlSum)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
        {/* 요약 테이블 (테이블 보기 + 간단히보기) */}
        {showSummaryTable && (
          <div className="flex-1 overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="border-b border-gray-200 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">종목명</th>
                  <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">롱/숏</th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">포지션규모</th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">현재가</th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('evaluation')}
                      className="w-full text-right font-semibold hover:text-blue-600"
                    >
                      평가금액 {sortField === 'evaluation' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('unrealized_pnl')}
                      className="w-full text-right font-semibold hover:text-blue-600"
                    >
                      평가손익 {sortField === 'unrealized_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('total_pnl')}
                      className="w-full text-right font-semibold hover:text-blue-600"
                    >
                      총손익 {sortField === 'total_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('pnl_ratio')}
                      className="w-full text-right font-semibold hover:text-blue-600"
                    >
                      손익비 {sortField === 'pnl_ratio' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">손절가격</th>
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">R</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-gray-400">
                      로딩 중...
                    </td>
                  </tr>
                )}
                {!loading && positions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-gray-400">
                      포지션이 없습니다. 추가해보세요!
                    </td>
                  </tr>
                )}
                {!loading && sortedPositions.map(position => {
                  const evaluationAmount = (position.current_price || 0) * position.position_size;
                  return (
                    <tr key={position.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                      <td className="sticky left-0 z-[1] bg-white px-3 py-3 text-left font-semibold text-gray-900">
                        <div className="text-sm">{position.company_name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-gray-400">
                          <span>{position.company_code}</span>
                          <span>·</span>
                          <span>{position.sector || '업종없음'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-[11px] font-bold ${
                          position.position_type === '롱' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {position.position_type}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-gray-700">
                        {position.position_size.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {position.current_price ? formatAmount(position.current_price) : '-'}
                      </td>
                      <td className="bg-purple-50 px-3 py-3 text-right font-bold text-gray-900">
                        {formatAmount(evaluationAmount)}
                      </td>
                      <td className={`px-3 py-3 text-right font-bold ${(position.unrealized_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {position.unrealized_pnl ? formatAmount(position.unrealized_pnl) : '-'}
                      </td>
                      <td className={`px-3 py-3 text-right text-sm font-bold ${(position.total_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {position.total_pnl ? formatAmount(position.total_pnl) : '-'}
                      </td>
                      <td className={`px-3 py-3 text-right font-bold ${(position.pnl_ratio || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {position.pnl_ratio?.toFixed(2) || '-'}R
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">
                        {formatAmount(position.stop_loss)}
                      </td>
                      <td className="bg-yellow-50 px-3 py-3 text-right font-semibold text-gray-800">
                        {position.r_value ? formatAmount(position.r_value) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 테이블 (청산 매매 탭 또는 테이블 보기 모드) */}
        {showDetailedTable && (
          <div className="flex-1 overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <button
                    onClick={() => handleSort('entry_date')}
                    className="w-full font-semibold hover:text-blue-600"
                  >
                    진입날짜 {sortField === 'entry_date' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                {currentTab === 'closed' && (
                  <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('close_date')}
                      className="w-full font-semibold hover:text-blue-600"
                    >
                      매도날짜 {sortField === 'close_date' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                )}
                <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">매매방식</th>
                <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <button
                    onClick={() => handleSort('company_name')}
                    className="w-full font-semibold hover:text-blue-600"
                  >
                    종목명 {sortField === 'company_name' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">롱/숏</th>
                {currentTab === 'closed' && (
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">매도수량</th>
                )}
                {currentTab === 'active' && (
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">포지션규모</th>
                )}
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">평균가격</th>
                {currentTab === 'active' && (
                  <>
                    <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">현재가</th>
                    <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <button
                        onClick={() => handleSort('evaluation')}
                        className="w-full text-right font-semibold hover:text-blue-600"
                      >
                        평가금액 {sortField === 'evaluation' && (sortOrder === 'asc' ? '▲' : '▼')}
                      </button>
                    </th>
                    <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <button
                        onClick={() => handleSort('unrealized_pnl')}
                        className="w-full text-right font-semibold hover:text-blue-600"
                      >
                        평가손익 {sortField === 'unrealized_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                      </button>
                    </th>
                  </>
                )}
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <button
                    onClick={() => handleSort('realized_pnl')}
                    className="w-full text-right font-semibold hover:text-blue-600"
                  >
                    실현손익 {sortField === 'realized_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                {currentTab === 'active' && (
                  <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <button
                      onClick={() => handleSort('total_pnl')}
                      className="w-full text-right font-semibold hover:text-blue-600"
                    >
                      총손익 {sortField === 'total_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                )}
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <button
                    onClick={() => handleSort('pnl_ratio')}
                    className="w-full text-right font-semibold hover:text-blue-600"
                  >
                    손익비 {sortField === 'pnl_ratio' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">손절가격</th>
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">R (원)</th>
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">ATR (원)</th>
                <th className="border-b border-gray-200 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">ATR/R (%)</th>
                <th className="border-b border-gray-200 px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <button
                    onClick={() => handleSort('sector')}
                    className="w-full font-semibold hover:text-blue-600"
                  >
                    업종 {sortField === 'sector' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border-b border-gray-200 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">코멘트</th>
                {currentTab === 'active' && (
                  <th className="border-b border-gray-200 px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500 w-20">액션</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={21} className="py-6 text-center text-gray-400">
                    로딩 중...
                  </td>
                </tr>
              )}
              {!loading && sortedPositions.length === 0 && (
                <tr>
                  <td colSpan={21} className="py-6 text-center text-gray-400">
                    {currentTab === 'active' ? '포지션이 없습니다. 추가해보세요!' : '필터 조건에 맞는 매도 내역이 없습니다.'}
                  </td>
                </tr>
              )}
              {!loading && sortedPositions.map(position => {
                const isEditing = editingId === position.id;
                const evaluationAmount = (position.current_price || 0) * position.position_size;
                const atrRatio = position.atr && position.r_value
                  ? (position.atr / Math.abs(position.r_value)) * 100
                  : null;
                return (
                  <tr key={position.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                    <td className="px-3 py-2 text-center">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="date"
                          value={position.entry_date}
                          onChange={e => handleFieldChange(position.id, 'entry_date', e.target.value)}
                          className="w-full px-1 border rounded"
                        />
                      ) : (
                        position.entry_date
                      )}
                    </td>
                    {currentTab === 'closed' && (
                      <td className="bg-gray-50 px-3 py-2 text-center">
                        <span className="font-bold">{getClosedEventDate(position) || '-'}</span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-center text-gray-700">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="text"
                          value={position.trade_type}
                          onChange={e => handleFieldChange(position.id, 'trade_type', e.target.value)}
                          className="w-full px-1 border rounded"
                        />
                      ) : (
                        position.trade_type
                      )}
                    </td>
                    <td className="sticky left-0 z-[1] bg-white px-3 py-2 text-center font-semibold text-gray-900">
                      {isEditing && currentTab === 'active' ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={position.company_name}
                            onChange={e => handleFieldChange(position.id, 'company_name', e.target.value)}
                            className="w-full px-1 border rounded"
                            placeholder="종목명"
                          />
                          <input
                            type="text"
                            value={position.company_code}
                            onChange={e => handleFieldChange(position.id, 'company_code', e.target.value)}
                            className="w-full px-1 border rounded text-xs text-gray-500"
                            placeholder="종목코드"
                          />
                        </div>
                      ) : (
                        <div>
                          <div>{position.company_name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1 text-[10px] text-gray-400">
                            <span>{position.company_code}</span>
                            <span>·</span>
                            <span>{position.sector || '업종없음'}</span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isEditing && currentTab === 'active' ? (
                        <select
                          value={position.position_type}
                          onChange={e => handleFieldChange(position.id, 'position_type', e.target.value)}
                          className="w-full px-1 border rounded"
                        >
                          <option value="롱">롱</option>
                          <option value="숏">숏</option>
                        </select>
                      ) : (
                        <span className={`inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-[11px] font-bold ${
                          position.position_type === '롱' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {position.position_type}
                        </span>
                      )}
                    </td>
                    {currentTab === 'closed' && (
                      <td className="bg-orange-50 px-3 py-2 text-right font-semibold">
                        {formatAmount(position.sold_quantity || position.position_size)}
                      </td>
                    )}
                    {currentTab === 'active' && (
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={position.position_size}
                            onChange={e => handleFieldChange(position.id, 'position_size', parseInt(e.target.value))}
                            className="w-full px-1 border rounded text-right"
                          />
                        ) : (
                          position.position_size.toLocaleString()
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="number"
                          value={position.avg_price}
                          onChange={e => handleFieldChange(position.id, 'avg_price', parseFloat(e.target.value))}
                          className="w-full px-1 border rounded text-right"
                        />
                      ) : (
                        formatAmount(position.avg_price)
                      )}
                    </td>
                    {currentTab === 'active' && (
                      <>
                        <td className="bg-blue-50 px-3 py-2 text-right font-semibold">
                          {isEditing && position.is_custom_asset ? (
                            <input
                              type="number"
                              value={position.manual_current_price ?? 0}
                              onChange={e => handleFieldChange(position.id, 'manual_current_price', parseFloat(e.target.value) || 0)}
                              className="w-full px-1 border rounded text-right"
                            />
                          ) : (
                            position.current_price ? formatAmount(position.current_price) : '-'
                          )}
                        </td>
                        <td className="bg-purple-50 px-3 py-2 text-right font-bold text-gray-900">
                          {formatAmount(evaluationAmount)}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${(position.unrealized_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {position.unrealized_pnl ? formatAmount(position.unrealized_pnl) : '-'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="number"
                          value={position.realized_pnl}
                          onChange={e => handleFieldChange(position.id, 'realized_pnl', parseFloat(e.target.value))}
                          className="w-full px-1 border rounded text-right"
                        />
                      ) : (
                        formatAmount(position.realized_pnl)
                      )}
                    </td>
                    {currentTab === 'active' && (
                      <td className={`px-3 py-2 text-right font-bold ${(position.total_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {position.total_pnl ? formatAmount(position.total_pnl) : '-'}
                      </td>
                    )}
                    <td className={`px-3 py-2 text-right font-bold ${(position.pnl_ratio || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {position.pnl_ratio?.toFixed(2) || '-'}R
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="number"
                          value={position.stop_loss}
                          onChange={e => handleFieldChange(position.id, 'stop_loss', parseFloat(e.target.value))}
                          className="w-full px-1 border rounded text-right"
                        />
                      ) : (
                        formatAmount(position.stop_loss)
                      )}
                    </td>
                    <td className="bg-yellow-50 px-3 py-2 text-right font-semibold text-gray-800">
                      {position.r_value ? formatAmount(position.r_value) : '-'}
                    </td>
                    <td className="bg-green-50 px-3 py-2 text-right">
                      {position.atr ? formatAmount(Math.round(position.atr)) : '-'}
                    </td>
                    <td className="bg-emerald-50 px-3 py-2 text-right">
                      {atrRatio !== null ? `${atrRatio.toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isEditing && currentTab === 'active' ? (
                        <input
                          type="text"
                          value={position.sector}
                          onChange={e => handleFieldChange(position.id, 'sector', e.target.value)}
                          className="w-full px-1 border rounded"
                        />
                      ) : (
                        position.sector
                      )}
                    </td>
                    <td className="px-3 py-2 text-left">
                      {isEditing && currentTab === 'active' ? (
                        <textarea
                          value={position.comment}
                          onChange={e => handleFieldChange(position.id, 'comment', e.target.value)}
                          className="w-full px-1 border rounded text-xs"
                          rows={2}
                        />
                      ) : (
                        <div
                          className={`cursor-pointer hover:bg-gray-100 ${
                            expandedComments.has(position.id) ? 'whitespace-normal' : 'max-w-[150px] truncate'
                          }`}
                          onClick={() => {
                            const newExpanded = new Set(expandedComments);
                            if (newExpanded.has(position.id)) {
                              newExpanded.delete(position.id);
                            } else {
                              newExpanded.add(position.id);
                            }
                            setExpandedComments(newExpanded);
                          }}
                          title="클릭하여 펼치기/접기"
                        >
                          {position.comment}
                        </div>
                      )}
                    </td>
                    {currentTab === 'active' && (
                      <td className="sticky right-0 z-[1] bg-white px-2 py-2 text-center">
                        {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleUpdate(position.id)}
                            className="p-1 bg-green-600 text-white rounded hover:bg-green-700"
                            title="저장"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 bg-gray-400 text-white rounded hover:bg-gray-500"
                            title="취소"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          {currentTab === 'active' && (
                            <button
                              onClick={() => openSellModal(position)}
                              className="p-1 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                              disabled={position.position_size <= 0}
                              title="매도"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => setEditingId(position.id)}
                            className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            title="수정"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(position.id)}
                            className="p-1 bg-red-600 text-white rounded hover:bg-red-700"
                            title="삭제"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        {/* 업종별 비중 및 차트 (업종별 비중 모드) */}
        {currentTab === 'active' && viewMode === 'sector' && (
          <div className="flex-1 bg-white rounded-lg shadow p-6 flex flex-col overflow-hidden">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-800">📊 업종별 포지션 비중</h2>
              <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-1">
                <button
                  onClick={() => setSectorAllocationBasis('cost')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    sectorAllocationBasis === 'cost'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  매입가 기준
                </button>
                <button
                  onClick={() => setSectorAllocationBasis('market')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    sectorAllocationBasis === 'market'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  평가금액 기준
                </button>
              </div>
            </div>
            {sectorAllocations.length > 0 ? (
              <div className="flex-1 grid grid-cols-2 gap-8 overflow-hidden">
                  {/* 원형 그래프 (고정) */}
                  <div className="flex flex-col">
                    <ResponsiveContainer width="100%" height={400}>
                      <PieChart>
                        <Pie
                          data={sectorAllocations}
                          dataKey="percentage"
                          nameKey="sector"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          label={(entry) => `${(((entry.percent as number | undefined) || 0) * 100).toFixed(1)}%`}
                        >
                          {sectorAllocations.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, _name, item) => {
                            const payload = item?.payload as SectorAllocationWithR | undefined;
                            return [
                              `${payload?.amount.toLocaleString() || '0'}원 (${Number(value || 0).toFixed(1)}%)`,
                              `${payload?.sector || ''} · ${allocationAmountLabel}`,
                            ];
                          }}
                        />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 업종별 상세 리스트 (스크롤 가능) */}
                  <div className="flex flex-col overflow-hidden">
                    <div className="text-base font-bold text-gray-700 border-b pb-2 mb-2 flex-shrink-0">상세 내역</div>
                    <div className="overflow-y-auto flex-1 space-y-1">
                      {sectorAllocations.map((allocation, index) => (
                        <div key={index} className="py-3 border-b hover:bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded"
                                style={{ backgroundColor: allocation.color }}
                              />
                              <span className="font-bold text-base">{allocation.sector}</span>
                            </div>
                            <div className="text-sm font-bold text-gray-700">{allocation.percentage.toFixed(1)}%</div>
                          </div>
                          <div className="ml-6 space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">{allocationAmountLabel}</span>
                              <span className="font-medium">{formatAmount(allocation.amount)}원</span>
                            </div>
                            {sectorAllocationBasis === 'market' ? (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">매입가 기준</span>
                                <span className="font-medium text-gray-700">{formatAmount(allocation.costAmount)}원</span>
                              </div>
                            ) : (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">평가금액 기준</span>
                                <span className="font-medium text-gray-700">{formatAmount(allocation.marketAmount)}원</span>
                              </div>
                            )}
                            {allocation.totalR > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">R 합계</span>
                                <span className="font-medium text-blue-600">{formatAmount(allocation.totalR)}원</span>
                              </div>
                            )}
                            {allocation.sector !== '현금' && (
                              <>
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">평가손익</span>
                                  <span className={`font-medium ${allocation.unrealizedPnl >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                                    {allocation.unrealizedPnl >= 0 ? '+' : ''}{formatAmount(allocation.unrealizedPnl)}원
                                  </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">수익률</span>
                                  <span className={`font-medium ${allocation.returnRate >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                                    {allocation.returnRate >= 0 ? '+' : ''}{allocation.returnRate.toFixed(2)}%
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* 총합 */}
                      <div className="py-3 border-t-2 border-gray-300 mt-2 bg-gray-50 sticky bottom-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-base text-gray-800">총 자산</span>
                          <span className="text-sm font-bold text-blue-600">100.0%</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">{allocationTotalLabel}</span>
                          <span className="text-base font-bold text-gray-800">
                            {formatAmount(sectorAllocations.reduce((sum, a) => sum + a.amount, 0))}원
                          </span>
                        </div>
                        <div className="flex justify-between text-sm mt-1">
                          <span className="text-gray-600">총 평가손익</span>
                          <span className={`text-base font-bold ${sectorAllocations.reduce((sum, a) => sum + a.unrealizedPnl, 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                            {sectorAllocations.reduce((sum, a) => sum + a.unrealizedPnl, 0) >= 0 ? '+' : ''}
                            {formatAmount(sectorAllocations.reduce((sum, a) => sum + a.unrealizedPnl, 0))}원
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            ) : (
              <div className="text-center py-16 text-gray-400">
                <p className="text-lg">포지션이 없습니다.</p>
                <p className="text-sm mt-2">포지션을 추가하면 업종별 비중을 확인할 수 있습니다.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">새 포지션 추가</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-1">진입 날짜</label>
                <input
                  type="date"
                  value={formData.entry_date}
                  onChange={e => setFormData({ ...formData, entry_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">매매 방식</label>
                <input
                  type="text"
                  value={formData.trade_type}
                  onChange={e => setFormData({ ...formData, trade_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="예: 스윙, 데이트레이딩"
                />
              </div>

              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="custom-asset-toggle"
                  type="checkbox"
                  checked={formData.is_custom_asset || false}
                  onChange={e => {
                    const isCustom = e.target.checked;
                    setFormData(prev => ({
                      ...prev,
                      is_custom_asset: isCustom,
                      manual_current_price: isCustom ? (prev.manual_current_price ?? 0) : null,
                    }));
                    if (isCustom) {
                      setSearchQuery('');
                      setSearchResults([]);
                      setShowSearchResults(false);
                    }
                  }}
                  className="h-4 w-4"
                />
                <label htmlFor="custom-asset-toggle" className="text-sm font-bold">
                  커스텀 자산(ETF 등)
                </label>
              </div>

              {formData.is_custom_asset && (
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-1">자산명</label>
                    <input
                      type="text"
                      value={formData.company_name}
                      onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      placeholder="예: SPY, BTC"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-1">자산코드</label>
                    <input
                      type="text"
                      value={formData.company_code}
                      onChange={e => setFormData({ ...formData, company_code: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      placeholder="커스텀 코드"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold mb-1">현재가</label>
                    <input
                      type="number"
                      value={formData.manual_current_price ?? 0}
                      onChange={e => setFormData({ ...formData, manual_current_price: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                </div>
              )}

              <div className="col-span-2 relative">
                <label className="block text-sm font-bold mb-1">종목 검색</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    searchCompanies(e.target.value);
                  }}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="종목명 또는 종목코드 입력"
                  onFocus={() => {
                    if (searchResults.length > 0) setShowSearchResults(true);
                  }}
                />
                {showSearchResults && searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchResults.map(result => (
                      <div
                        key={result.code}
                        onClick={() => selectCompany(result.code, result.name)}
                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between"
                      >
                        <span className="font-bold">{result.name}</span>
                        <span className="text-gray-500 text-xs">{result.code}</span>
                      </div>
                    ))}
                  </div>
                )}
                {formData.company_code && (
                  <div className="mt-2 text-sm text-gray-600">
                    선택된 종목: <span className="font-bold">{formData.company_name}</span> ({formData.company_code})
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">롱/숏</label>
                <select
                  value={formData.position_type}
                  onChange={e => setFormData({ ...formData, position_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="롱">롱</option>
                  <option value="숏">숏</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">포지션 규모 (주)</label>
                <input
                  type="number"
                  value={formData.position_size}
                  onChange={e => {
                    const size = parseInt(e.target.value);
                    setFormData({
                      ...formData,
                      position_size: size,
                      initial_position_size: formData.initial_position_size || size
                    });
                  }}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">평균 가격 (원)</label>
                <input
                  type="number"
                  value={formData.avg_price}
                  onChange={e => setFormData({ ...formData, avg_price: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">손절 가격 (원)</label>
                <input
                  type="number"
                  value={formData.stop_loss}
                  onChange={e => setFormData({ ...formData, stop_loss: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-bold mb-1">업종</label>
                <input
                  type="text"
                  value={formData.sector}
                  onChange={e => setFormData({ ...formData, sector: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="반도체, 바이오 등"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-bold mb-1">코멘트</label>
                <textarea
                  value={formData.comment}
                  onChange={e => setFormData({ ...formData, comment: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  rows={3}
                  placeholder="매매 전략, 메모 등"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setFormData(createEmptyForm());
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowSearchResults(false);
                }}
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                취소
              </button>
              <button
                onClick={handleAdd}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일부 매도 모달 */}
      {showSellModal && sellingPosition && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[500px]">
            <h2 className="text-xl font-bold mb-4">일부 매도</h2>

            <div className="mb-4">
              <p className="text-sm text-gray-600">
                종목: <span className="font-bold">{sellingPosition.company_name}</span> ({sellingPosition.company_code})
              </p>
              <p className="text-sm text-gray-600">
                현재 포지션: <span className="font-bold">{sellingPosition.position_size.toLocaleString()}</span>주
              </p>
              <p className="text-sm text-gray-600">
                평균 가격: <span className="font-bold">{sellingPosition.avg_price.toLocaleString()}</span>원
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold mb-1">매도 날짜</label>
                <input
                  type="date"
                  value={sellDate}
                  onChange={e => setSellDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">매도 물량 (주)</label>
                <input
                  type="number"
                  value={sellAmount}
                  onChange={e => setSellAmount(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="0"
                  max={sellingPosition.position_size}
                />
                <p className="text-xs text-gray-500 mt-1">
                  최대 {sellingPosition.position_size.toLocaleString()}주까지 매도 가능
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">실현 손익 (원)</label>
                <input
                  type="number"
                  value={sellRealizedPnl}
                  onChange={e => setSellRealizedPnl(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 mt-1">
                  양수는 이익, 음수는 손실
                </p>
              </div>

              <div className="bg-blue-50 p-3 rounded">
                <p className="text-sm font-bold">매도 후 예상</p>
                <p className="text-xs text-gray-600 mt-1">
                  남은 포지션: <span className="font-bold">{(sellingPosition.position_size - sellAmount).toLocaleString()}</span>주
                </p>
                <p className="text-xs text-gray-600">
                  누적 실현 손익: <span className={`font-bold ${((sellingPosition.realized_pnl || 0) + sellRealizedPnl) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {((sellingPosition.realized_pnl || 0) + sellRealizedPnl).toLocaleString()}
                  </span>원
                </p>
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowSellModal(false);
                  setSellingPosition(null);
                  setSellAmount(0);
                  setSellRealizedPnl(0);
                  setSellDate(getTodayDate());
                }}
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                취소
              </button>
              <button
                onClick={handlePartialSell}
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
              >
                매도 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
