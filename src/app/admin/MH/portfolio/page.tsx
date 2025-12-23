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
};

type FormData = Omit<PortfolioPosition, 'id' | 'current_price' | 'unrealized_pnl' | 'total_pnl' | 'r_value' | 'pnl_ratio' | 'atr' | 'is_closed' | 'close_date'>;

type SectorAllocation = {
  sector: string;
  amount: number;
  percentage: number;
  color: string;
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B9D', '#C77DFF', '#38B000'];

export default function PortfolioManagementPage() {
  const supabase = createClientComponentClient();

  const [currentTab, setCurrentTab] = useState<'active' | 'closed'>('active');
  const [viewMode, setViewMode] = useState<'table' | 'sector'>('table');
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellingPosition, setSellingPosition] = useState<PortfolioPosition | null>(null);
  const [sellAmount, setSellAmount] = useState(0);
  const [sellRealizedPnl, setSellRealizedPnl] = useState(0);
  const [sellDate, setSellDate] = useState(new Date().toISOString().split('T')[0]);
  const [cash, setCash] = useState<number>(0);
  const [isEditingCash, setIsEditingCash] = useState(false);
  const [sortField, setSortField] = useState<'entry_date' | 'company_name' | 'evaluation' | 'sector' | 'pnl_ratio' | 'unrealized_pnl' | 'realized_pnl' | 'total_pnl' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAmountHidden, setIsAmountHidden] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  // 종목 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ code: string; name: string }[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const emptyForm: FormData = {
    entry_date: new Date().toISOString().split('T')[0],
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
  };

  const [formData, setFormData] = useState<FormData>(emptyForm);

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
  const handleSort = (field: 'entry_date' | 'company_name' | 'evaluation' | 'sector' | 'pnl_ratio' | 'unrealized_pnl' | 'realized_pnl' | 'total_pnl') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // 정렬된 포지션 목록
  const sortedPositions = useMemo(() => {
    if (!sortField) return positions;

    const sorted = [...positions].sort((a, b) => {
      let compareA: any;
      let compareB: any;

      switch (sortField) {
        case 'entry_date':
          compareA = a.entry_date;
          compareB = b.entry_date;
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
  }, [positions, sortField, sortOrder]);

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

    const count = positions.length;
    const totalR = positions.reduce((sum, p) => sum + (p.r_value || 0), 0);

    return { count, totalR };
  }, [positions, currentTab]);

  // 업종별 집계 계산 (R 합산 및 평가손익 추가)
  type SectorAllocationWithR = SectorAllocation & { totalR: number; unrealizedPnl: number; returnRate: number };

  const sectorAllocations = useMemo<SectorAllocationWithR[]>(() => {
    if (currentTab !== 'active' || positions.length === 0) return [];

    // 업종별 금액, R, 평가손익 합산
    const sectorMap = new Map<string, { amount: number; totalR: number; unrealizedPnl: number }>();

    positions.forEach(p => {
      const positionValue = p.avg_price * p.position_size;
      const sector = p.sector || '기타';
      const existing = sectorMap.get(sector) || { amount: 0, totalR: 0, unrealizedPnl: 0 };
      sectorMap.set(sector, {
        amount: existing.amount + positionValue,
        totalR: existing.totalR + (p.r_value || 0),
        unrealizedPnl: existing.unrealizedPnl + (p.unrealized_pnl || 0)
      });
    });

    // 현금 추가
    if (cash > 0) {
      sectorMap.set('현금', { amount: cash, totalR: 0, unrealizedPnl: 0 });
    }

    // 총 금액 계산
    const totalAmount = Array.from(sectorMap.values()).reduce((sum, val) => sum + val.amount, 0);

    // 비중 계산
    const allocations: SectorAllocationWithR[] = Array.from(sectorMap.entries()).map(([sector, data], index) => ({
      sector,
      amount: data.amount,
      totalR: data.totalR,
      unrealizedPnl: data.unrealizedPnl,
      returnRate: data.amount > 0 ? (data.unrealizedPnl / data.amount) * 100 : 0,
      percentage: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
      color: COLORS[index % COLORS.length]
    }));

    // 비중 내림차순 정렬
    return allocations.sort((a, b) => b.percentage - a.percentage);
  }, [positions, cash, currentTab]);

  // 포트폴리오 목록 조회
  const fetchPositions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 포트폴리오 데이터 조회 (탭에 따라 필터링)
      const { data: portfolioData, error } = await supabase
        .from('user_portfolio')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_closed', currentTab === 'closed')
        .order(currentTab === 'closed' ? 'close_date' : 'entry_date', { ascending: false });

      if (error) throw error;

      if (portfolioData && portfolioData.length > 0) {
        const codes = [...new Set(portfolioData.map(p => p.company_code))];

        // 최신 날짜 조회
        const { data: dateData } = await supabase
          .from('daily_prices_v2')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .single();

        const latestDate = dateData?.date;

        // 현재가 조회
        const { data: priceData } = await supabase
          .from('daily_prices_v2')
          .select('code, close')
          .in('code', codes)
          .eq('date', latestDate);

        const priceMap = new Map<string, number>();
        if (priceData) {
          priceData.forEach(p => priceMap.set(p.code, p.close));
        }

        // ATR 실시간 계산
        const atrMap = new Map<string, number>();
        for (const code of codes) {
          const atr = await calculateATR(code);
          if (atr > 0) {
            atrMap.set(code, atr);
          }
        }

        console.log('Portfolio Data:', portfolioData);
        console.log('ATR Map:', atrMap);

        // 계산 값 추가
        const enrichedData: PortfolioPosition[] = portfolioData.map(p => {
          const current_price = priceMap.get(p.company_code) || 0;
          const unrealized_pnl = (current_price - p.avg_price) * p.position_size;
          const total_pnl = unrealized_pnl + (p.realized_pnl || 0);

          // R값 계산 (디버깅)
          console.log(`${p.company_name} R 계산:`, {
            avg_price: p.avg_price,
            stop_loss: p.stop_loss,
            initial_position_size: p.initial_position_size,
            diff: p.avg_price - p.stop_loss,
            r_value: (p.avg_price - p.stop_loss) * p.initial_position_size
          });

          // R값 계산: 숏일 때는 -1 곱하기
          const r_value = (p.avg_price - p.stop_loss) * p.initial_position_size * (p.position_type === '숏' ? -1 : 1);

          // 청산 매매는 실현손익 기준, 현재 포지션은 총손익 기준
          const pnl_ratio = r_value !== 0
            ? (currentTab === 'closed' ? (p.realized_pnl || 0) / r_value : total_pnl / r_value)
            : 0;

          // ATR: 20일 ATR * 포지션 규모
          const atr_value = atrMap.get(p.company_code) || 0;
          const position_for_atr = currentTab === 'closed' ? p.initial_position_size : p.position_size;
          const atr = atr_value * position_for_atr;

          console.log(`${p.company_name} ATR 계산:`, {
            atr_value,
            position_for_atr,
            atr
          });

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
      } else {
        setPositions([]);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase, currentTab]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // 종목 검색
  const searchCompanies = async (query: string) => {
    if (!query || query.length < 1) {
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
    });
    setSearchQuery(name);
    setShowSearchResults(false);
  };

  // ATR 계산 함수 (20일 ATR)
  const calculateATR = async (code: string): Promise<number> => {
    try {
      // 최근 21일 데이터 가져오기 (ATR 계산에 20일 + 이전 종가 1일 필요)
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

      // 날짜순 정렬 (과거 -> 최근)
      const sortedData = [...data].reverse();

      // True Range 계산
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

      // ATR = 20일 True Range의 평균
      const atr = trueRanges.slice(-20).reduce((sum, tr) => sum + tr, 0) / 20;

      console.log(`${code} ATR 계산 완료:`, atr);
      return atr;
    } catch (error) {
      console.error('ATR 계산 오류:', error);
      return 0;
    }
  };

  // 포지션 추가
  const handleAdd = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
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
      setFormData(emptyForm);
      setSearchQuery('');
      setSearchResults([]);
      setShowSearchResults(false);
      fetchPositions();
    } catch (error: any) {
      console.error('Error adding position:', error);
      alert('추가 실패: ' + error.message);
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
        })
        .eq('id', id);

      if (error) throw error;

      alert('수정되었습니다.');
      setEditingId(null);
      fetchPositions();
    } catch (error: any) {
      console.error('Error updating position:', error);
      alert('수정 실패: ' + error.message);
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
    } catch (error: any) {
      console.error('Error deleting position:', error);
      alert('삭제 실패: ' + error.message);
    }
  };

  // 필드 변경 핸들러
  const handleFieldChange = (id: string, field: keyof PortfolioPosition, value: any) => {
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
    setSellDate(new Date().toISOString().split('T')[0]);
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
      const newPositionSize = sellingPosition.position_size - sellAmount;
      const newRealizedPnl = (sellingPosition.realized_pnl || 0) + sellRealizedPnl;

      // 포지션이 0이 되면 청산 처리
      const isClosed = newPositionSize === 0;
      const updateData: any = {
        position_size: newPositionSize,
        realized_pnl: newRealizedPnl,
      };

      if (isClosed) {
        updateData.is_closed = true;
        updateData.close_date = sellDate;
      }

      const { error } = await supabase
        .from('user_portfolio')
        .update(updateData)
        .eq('id', sellingPosition.id);

      if (error) throw error;

      if (isClosed) {
        alert(`${sellAmount}주 매도 완료\n실현 손익: ${sellRealizedPnl.toLocaleString()}원\n\n🎉 포지션이 청산되었습니다!`);
      } else {
        alert(`${sellAmount}주 매도 완료\n실현 손익: ${sellRealizedPnl.toLocaleString()}원`);
      }

      setShowSellModal(false);
      setSellingPosition(null);
      setSellAmount(0);
      setSellRealizedPnl(0);
      setSellDate(new Date().toISOString().split('T')[0]);
      fetchPositions();
    } catch (error: any) {
      console.error('Error selling position:', error);
      alert('매도 실패: ' + error.message);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 p-6">
      {/* 헤더 */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-2xl font-bold text-gray-800">💼 포트폴리오 관리</h1>
          {currentTab === 'active' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold"
            >
              ➕ 포지션 추가
            </button>
          )}
        </div>

        {/* 탭 */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCurrentTab('active');
              setViewMode('table');
            }}
            className={`px-4 py-2 rounded-lg font-bold transition-all ${
              currentTab === 'active'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-gray-600 border hover:bg-gray-50'
            }`}
          >
            📊 현재 포지션
          </button>
          <button
            onClick={() => {
              setCurrentTab('closed');
              setViewMode('table');
            }}
            className={`px-4 py-2 rounded-lg font-bold transition-all ${
              currentTab === 'closed'
                ? 'bg-gray-700 text-white shadow'
                : 'bg-white text-gray-600 border hover:bg-gray-50'
            }`}
          >
            🏁 청산 매매
          </button>
        </div>

        {/* 뷰 모드 전환 (현재 포지션 탭에서만 표시) */}
        {currentTab === 'active' && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                viewMode === 'table'
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              📋 테이블 보기
            </button>
            <button
              onClick={() => setViewMode('sector')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                viewMode === 'sector'
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              🥧 업종별 비중
            </button>
          </div>
        )}
      </div>

      {/* 총 자산 및 현금 */}
      {!isAmountHidden && (
        <div className="mb-4 bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-8">
            {/* 총 자산 */}
            <div className="flex items-center gap-3">
              <span className="text-gray-700">💎 총 자산:</span>
              <span className="text-gray-900">{formatAssetAmount(totalAssets)}원</span>
            </div>

            {/* 보유 현금 */}
            <div className="flex items-center gap-3">
              <span className="text-gray-700">💰 보유 현금:</span>
              {isEditingCash ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={cash}
                    onChange={e => setCash(parseFloat(e.target.value) || 0)}
                    className="px-3 py-1 border rounded w-40"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      saveCash(cash);
                      setIsEditingCash(false);
                    }}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                  >
                    저장
                  </button>
                  <button
                    onClick={() => {
                      setCash(parseFloat(localStorage.getItem('portfolio_cash') || '0'));
                      setIsEditingCash(false);
                    }}
                    className="px-3 py-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-sm"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-gray-900">{formatAssetAmount(cash)}원</span>
                  <button
                    onClick={() => setIsEditingCash(true)}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    수정
                  </button>
                </div>
              )}
            </div>

            {/* 현재 포지션 통계 (현재 포지션 탭에서만 표시) */}
            {currentTab === 'active' && (
              <div className="flex items-center gap-3">
                <span className="text-gray-700">📊 포지션:</span>
                <span className="text-gray-900">{positionStats.count}개</span>
                <span className="text-gray-500">|</span>
                <span className="text-gray-700">R 합계:</span>
                <span className="text-gray-900">{formatAssetAmount(positionStats.totalR)}원</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 금액 숨김/보이기 토글 버튼 */}
      <div className="mb-4">
        <button
          onClick={() => setIsAmountHidden(!isAmountHidden)}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-2"
        >
          {isAmountHidden ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
              <span>총 자산 보기</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
              </svg>
              <span>총 자산 숨기기</span>
            </>
          )}
        </button>
      </div>

      {/* 메인 컨텐츠 영역 */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* 테이블 (청산 매매 탭 또는 테이블 보기 모드) */}
        {(currentTab === 'closed' || viewMode === 'table') && (
          <div className="flex-1 overflow-auto bg-white rounded-lg shadow">
            <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th className="border px-2 py-2 text-center">
                  <button
                    onClick={() => handleSort('entry_date')}
                    className="w-full hover:text-blue-600 font-bold"
                  >
                    진입날짜 {sortField === 'entry_date' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                {currentTab === 'closed' && (
                  <th className="border px-2 py-2 text-center">청산날짜</th>
                )}
                <th className="border px-2 py-2 text-center">매매방식</th>
                <th className="border px-2 py-2 text-center">
                  <button
                    onClick={() => handleSort('company_name')}
                    className="w-full hover:text-blue-600 font-bold"
                  >
                    종목명 {sortField === 'company_name' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border px-2 py-2 text-center">롱/숏</th>
                {currentTab === 'active' && (
                  <th className="border px-2 py-2 text-center">포지션규모</th>
                )}
                <th className="border px-2 py-2 text-center">평균가격</th>
                {currentTab === 'active' && (
                  <>
                    <th className="border px-2 py-2 text-center">현재가</th>
                    <th className="border px-2 py-2 text-center">
                      <button
                        onClick={() => handleSort('evaluation')}
                        className="w-full hover:text-blue-600 font-bold"
                      >
                        평가금액 {sortField === 'evaluation' && (sortOrder === 'asc' ? '▲' : '▼')}
                      </button>
                    </th>
                    <th className="border px-2 py-2 text-center">
                      <button
                        onClick={() => handleSort('unrealized_pnl')}
                        className="w-full hover:text-blue-600 font-bold"
                      >
                        평가손익 {sortField === 'unrealized_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                      </button>
                    </th>
                  </>
                )}
                <th className="border px-2 py-2 text-center">
                  <button
                    onClick={() => handleSort('realized_pnl')}
                    className="w-full hover:text-blue-600 font-bold"
                  >
                    실현손익 {sortField === 'realized_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                {currentTab === 'active' && (
                  <th className="border px-2 py-2 text-center">
                    <button
                      onClick={() => handleSort('total_pnl')}
                      className="w-full hover:text-blue-600 font-bold"
                    >
                      총손익 {sortField === 'total_pnl' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </button>
                  </th>
                )}
                <th className="border px-2 py-2 text-center">
                  <button
                    onClick={() => handleSort('pnl_ratio')}
                    className="w-full hover:text-blue-600 font-bold"
                  >
                    손익비 {sortField === 'pnl_ratio' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border px-2 py-2 text-center">손절가격</th>
                <th className="border px-2 py-2 text-center">R (원)</th>
                <th className="border px-2 py-2 text-center">ATR (원)</th>
                <th className="border px-2 py-2 text-center">
                  <button
                    onClick={() => handleSort('sector')}
                    className="w-full hover:text-blue-600 font-bold"
                  >
                    업종 {sortField === 'sector' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </button>
                </th>
                <th className="border px-2 py-2 text-center">코멘트</th>
                <th className="border px-1 py-2 text-center w-16">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={20} className="text-center py-4 text-gray-400">
                    로딩 중...
                  </td>
                </tr>
              )}
              {!loading && positions.length === 0 && (
                <tr>
                  <td colSpan={20} className="text-center py-4 text-gray-400">
                    {currentTab === 'active' ? '포지션이 없습니다. 추가해보세요!' : '청산된 포지션이 없습니다.'}
                  </td>
                </tr>
              )}
              {!loading && sortedPositions.map(position => {
                const isEditing = editingId === position.id;
                const evaluationAmount = (position.current_price || 0) * position.position_size;
                return (
                  <tr key={position.id} className="hover:bg-gray-50">
                    <td className="border px-2 py-1 text-center">
                      {isEditing ? (
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
                      <td className="border px-2 py-1 text-center bg-gray-50">
                        {isEditing ? (
                          <input
                            type="date"
                            value={position.close_date || ''}
                            onChange={e => handleFieldChange(position.id, 'close_date', e.target.value)}
                            className="w-full px-1 border rounded"
                          />
                        ) : (
                          <span className="font-bold">{position.close_date || '-'}</span>
                        )}
                      </td>
                    )}
                    <td className="border px-2 py-1 text-center">
                      {isEditing ? (
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
                    <td className="border px-2 py-1 text-center font-bold">
                      {isEditing ? (
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
                        <>
                          {position.company_name}
                          <div className="text-[10px] text-gray-400">{position.company_code}</div>
                        </>
                      )}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {isEditing ? (
                        <select
                          value={position.position_type}
                          onChange={e => handleFieldChange(position.id, 'position_type', e.target.value)}
                          className="w-full px-1 border rounded"
                        >
                          <option value="롱">롱</option>
                          <option value="숏">숏</option>
                        </select>
                      ) : (
                        <span className={position.position_type === '롱' ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'}>
                          {position.position_type}
                        </span>
                      )}
                    </td>
                    {currentTab === 'active' && (
                      <td className="border px-2 py-1 text-right">
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
                    <td className="border px-2 py-1 text-right">
                      {isEditing ? (
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
                        <td className="border px-2 py-1 text-right bg-blue-50 font-bold">
                          {position.current_price ? formatAmount(position.current_price) : '-'}
                        </td>
                        <td className="border px-2 py-1 text-right bg-purple-50 font-bold">
                          {formatAmount(evaluationAmount)}
                        </td>
                        <td className={`border px-2 py-1 text-right font-bold ${(position.unrealized_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {position.unrealized_pnl ? formatAmount(position.unrealized_pnl) : '-'}
                        </td>
                      </>
                    )}
                    <td className="border px-2 py-1 text-right">
                      {isEditing ? (
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
                      <td className={`border px-2 py-1 text-right font-bold ${(position.total_pnl || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {position.total_pnl ? formatAmount(position.total_pnl) : '-'}
                      </td>
                    )}
                    <td className={`border px-2 py-1 text-right font-bold ${(position.pnl_ratio || 0) >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {position.pnl_ratio?.toFixed(2) || '-'}R
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {isEditing ? (
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
                    <td className="border px-2 py-1 text-right bg-yellow-50">
                      {position.r_value ? formatAmount(position.r_value) : '-'}
                    </td>
                    <td className="border px-2 py-1 text-right bg-green-50">
                      {position.atr ? formatAmount(Math.round(position.atr)) : '-'}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {isEditing ? (
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
                    <td className="border px-2 py-1">
                      {isEditing ? (
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
                    <td className="border px-1 py-1 text-center">
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
            <h2 className="text-xl font-bold mb-6 text-gray-800">📊 업종별 포지션 비중</h2>
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
                          label={(entry) => `${entry.percentage.toFixed(1)}%`}
                        >
                          {sectorAllocations.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: any, name: any, props: any) => [
                            `${props.payload.amount.toLocaleString()}원 (${value.toFixed(1)}%)`,
                            props.payload.sector
                          ]}
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
                              <span className="text-gray-600">투자금액</span>
                              <span className="font-medium">{formatAmount(allocation.amount)}원</span>
                            </div>
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
                          <span className="text-gray-600">총 투자금액</span>
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
                  setFormData(emptyForm);
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
                  setSellDate(new Date().toISOString().split('T')[0]);
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
