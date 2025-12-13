'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type TradingCandidate = {
  code: string;
  name: string;
  tradeType: string; // 매매 (매수/매도 등)
  currentPrice: number; // 현재가
  stopLoss: number; // 손절가격
  oneR: number; // 1R
  comment: string; // 코멘트
  revenue_growth_2026: number | null; // '26년 매출성장
  op_income_growth_2026: number | null; // '26년 영업이익 성장
  revenue_growth_2027: number | null; // '27년 매출성장
  op_income_growth_2027: number | null; // '27년 영업이익 성장
};

export default function TradingCandidatesPage() {
  const supabase = createClientComponentClient();

  const [favGroups, setFavGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [candidates, setCandidates] = useState<TradingCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  // 즐겨찾기 그룹 목록 불러오기
  const fetchFavoriteGroups = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('user_favorite_stocks')
        .select('group_name')
        .eq('user_id', user.id);

      if (data) {
        const groups = Array.from(new Set(data.map(d => d.group_name || '기본 그룹')));
        setFavGroups(groups.sort());
        if (groups.length > 0) {
          setSelectedGroup(groups[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching favorite groups:', error);
    }
  }, [supabase]);

  useEffect(() => {
    fetchFavoriteGroups();
  }, [fetchFavoriteGroups]);

  // 선택한 그룹의 종목들 불러오기
  const fetchCandidates = useCallback(async () => {
    if (!selectedGroup) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. 즐겨찾기 종목 목록 가져오기
      const { data: favStocks } = await supabase
        .from('user_favorite_stocks')
        .select('company_code, company_name')
        .eq('user_id', user.id)
        .eq('group_name', selectedGroup);

      if (!favStocks || favStocks.length === 0) {
        setCandidates([]);
        setLoading(false);
        return;
      }

      const codes = favStocks.map(s => s.company_code);

      // 2. 최근 날짜 가져오기
      const { data: dateData } = await supabase
        .from('daily_prices_v2')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      const latestDate = dateData?.date;

      // 3. 현재가 가져오기
      const { data: priceData } = await supabase
        .from('daily_prices_v2')
        .select('code, close')
        .in('code', codes)
        .eq('date', latestDate);

      const priceMap = new Map<string, number>();
      if (priceData) {
        priceData.forEach(p => priceMap.set(p.code, p.close));
      }

      // 4. 재무 데이터 가져오기 (2025, 2026, 2027년)
      const { data: financialData } = await supabase
        .from('company_financials')
        .select('company_code, year, revenue, op_income')
        .in('company_code', codes)
        .in('year', [2025, 2026, 2027]);

      // 재무 데이터 맵 생성
      const financialMap = new Map<string, { [key: number]: { revenue: number | null, op_income: number | null } }>();
      if (financialData) {
        financialData.forEach(f => {
          if (!financialMap.has(f.company_code)) {
            financialMap.set(f.company_code, {});
          }
          financialMap.get(f.company_code)![f.year] = {
            revenue: f.revenue,
            op_income: f.op_income
          };
        });
      }

      // 5. 저장된 매매 후보 데이터 가져오기
      const { data: savedData } = await supabase
        .from('trading_candidates')
        .select('company_code, trade_type, stop_loss, one_r, comment')
        .eq('user_id', user.id)
        .eq('group_name', selectedGroup);

      const savedDataMap = new Map<string, any>();
      if (savedData) {
        savedData.forEach(s => {
          savedDataMap.set(s.company_code, {
            tradeType: s.trade_type || '',
            stopLoss: s.stop_loss || 0,
            oneR: s.one_r || 0,
            comment: s.comment || ''
          });
        });
      }

      // 6. 성장률 계산 함수
      const calculateGrowth = (current: number | null, previous: number | null): number | null => {
        if (current === null || previous === null || previous === 0) return null;
        return ((current - previous) / previous) * 100;
      };

      // 7. 최종 데이터 조합
      const candidatesData: TradingCandidate[] = favStocks.map(stock => {
        const code = stock.company_code;
        const financials = financialMap.get(code) || {};
        const saved = savedDataMap.get(code) || { tradeType: '', stopLoss: 0, oneR: 0, comment: '' };

        const revenue2025 = financials[2025]?.revenue || null;
        const revenue2026 = financials[2026]?.revenue || null;
        const revenue2027 = financials[2027]?.revenue || null;
        const opIncome2025 = financials[2025]?.op_income || null;
        const opIncome2026 = financials[2026]?.op_income || null;
        const opIncome2027 = financials[2027]?.op_income || null;

        return {
          code,
          name: stock.company_name,
          tradeType: saved.tradeType,
          currentPrice: priceMap.get(code) || 0,
          stopLoss: saved.stopLoss,
          oneR: saved.oneR,
          comment: saved.comment,
          revenue_growth_2026: calculateGrowth(revenue2026, revenue2025),
          op_income_growth_2026: calculateGrowth(opIncome2026, opIncome2025),
          revenue_growth_2027: calculateGrowth(revenue2027, revenue2026),
          op_income_growth_2027: calculateGrowth(opIncome2027, opIncome2026)
        };
      });

      setCandidates(candidatesData);
    } catch (error) {
      console.error('Error fetching candidates:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedGroup]);

  useEffect(() => {
    if (selectedGroup) {
      fetchCandidates();
    }
  }, [selectedGroup, fetchCandidates]);

  // 손익 계산
  const calculateProfitLoss = (stopLoss: number, currentPrice: number): number | null => {
    if (currentPrice === 0 || stopLoss === 0) return null;
    return ((stopLoss / currentPrice) - 1) * 100;
  };

  // 포지션 규모 계산
  const calculatePositionSize = (oneR: number, currentPrice: number, stopLoss: number): number | null => {
    if (oneR === 0 || currentPrice === 0 || stopLoss === 0 || currentPrice === stopLoss) return null;
    const shares = Math.floor(oneR / Math.abs(currentPrice - stopLoss));
    return shares * currentPrice;
  };

  // 입력값 변경 핸들러
  const handleInputChange = (index: number, field: keyof TradingCandidate, value: any) => {
    setCandidates(prev => {
      const newCandidates = [...prev];
      newCandidates[index] = { ...newCandidates[index], [field]: value };
      return newCandidates;
    });
  };

  // 데이터 저장
  const saveData = async () => {
    if (!selectedGroup) {
      alert('그룹을 선택해주세요.');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      // 저장할 데이터 준비
      const dataToSave = candidates.map(candidate => ({
        user_id: user.id,
        group_name: selectedGroup,
        company_code: candidate.code,
        company_name: candidate.name,
        trade_type: candidate.tradeType,
        stop_loss: candidate.stopLoss,
        one_r: candidate.oneR,
        comment: candidate.comment
      }));

      // upsert로 저장 (있으면 업데이트, 없으면 생성)
      const { error } = await supabase
        .from('trading_candidates')
        .upsert(dataToSave, {
          onConflict: 'user_id,group_name,company_code'
        });

      if (error) throw error;

      alert('저장되었습니다.');
    } catch (error: any) {
      console.error('Error saving data:', error);
      alert('저장 중 오류가 발생했습니다: ' + error.message);
    }
  };

  const formatNumber = (num: number | null): string => {
    if (num === null) return '-';
    return num.toFixed(2);
  };

  const formatGrowth = (num: number | null): string => {
    if (num === null) return '-';
    return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
  };

  const formatMoney = (num: number | null): string => {
    if (num === null) return '-';
    return num.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-6 py-4 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800">매매 후보 선별</h1>
        <p className="text-sm text-gray-500 mt-1">관심종목 그룹을 선택하여 매매 후보를 분석하세요</p>
      </div>

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        {/* 그룹 선택 */}
        <div className="bg-white rounded-lg shadow border p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-sm font-bold text-gray-700 mb-2">관심종목 그룹 선택</label>
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="w-full max-w-md border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {favGroups.map(group => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </div>
            <button
              onClick={saveData}
              disabled={candidates.length === 0}
              className="px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              저장
            </button>
          </div>
        </div>

        {/* 테이블 */}
        <div className="flex-1 bg-white rounded-lg shadow border overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 text-[10px] text-gray-600 uppercase sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-3 font-bold border-b">종목명</th>
                  <th className="px-2 py-3 font-bold border-b">매매</th>
                  <th className="px-2 py-3 font-bold border-b text-right">현재가</th>
                  <th className="px-2 py-3 font-bold border-b text-right">손절가격</th>
                  <th className="px-2 py-3 font-bold border-b text-right">손익(%)</th>
                  <th className="px-2 py-3 font-bold border-b text-right">1R</th>
                  <th className="px-2 py-3 font-bold border-b text-right">포지션 규모</th>
                  <th className="px-2 py-3 font-bold border-b text-right">'26년<br/>매출성장</th>
                  <th className="px-2 py-3 font-bold border-b text-right">'26년<br/>영업이익성장</th>
                  <th className="px-2 py-3 font-bold border-b text-right">'27년<br/>매출성장</th>
                  <th className="px-2 py-3 font-bold border-b text-right">'27년<br/>영업이익성장</th>
                  <th className="px-2 py-3 font-bold border-b">코멘트</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={12} className="p-10 text-center text-gray-400">
                      데이터 로딩 중...
                    </td>
                  </tr>
                ) : candidates.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-10 text-center text-gray-400">
                      관심종목 그룹을 선택하세요
                    </td>
                  </tr>
                ) : (
                  candidates.map((candidate, idx) => {
                    const profitLoss = calculateProfitLoss(candidate.stopLoss, candidate.currentPrice);
                    const positionSize = calculatePositionSize(candidate.oneR, candidate.currentPrice, candidate.stopLoss);

                    return (
                      <tr key={candidate.code} className="hover:bg-gray-50">
                        <td className="px-2 py-2">
                          <div className="font-bold text-gray-800">{candidate.name}</div>
                          <div className="text-[9px] text-gray-400">{candidate.code}</div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={candidate.tradeType}
                            onChange={(e) => handleInputChange(idx, 'tradeType', e.target.value)}
                            className="w-20 border p-1 rounded text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-blue-600 font-bold">
                          {formatMoney(candidate.currentPrice)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            value={candidate.stopLoss || ''}
                            onChange={(e) => handleInputChange(idx, 'stopLoss', Number(e.target.value))}
                            className="w-24 border p-1 rounded text-xs text-right"
                          />
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${profitLoss !== null && profitLoss < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {profitLoss !== null ? `${formatNumber(profitLoss)}%` : '-'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            value={candidate.oneR || ''}
                            onChange={(e) => handleInputChange(idx, 'oneR', Number(e.target.value))}
                            className="w-24 border p-1 rounded text-xs text-right"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-green-600 font-bold">
                          {positionSize !== null ? formatMoney(positionSize) : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${candidate.revenue_growth_2026 !== null && candidate.revenue_growth_2026 > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {formatGrowth(candidate.revenue_growth_2026)}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${candidate.op_income_growth_2026 !== null && candidate.op_income_growth_2026 > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {formatGrowth(candidate.op_income_growth_2026)}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${candidate.revenue_growth_2027 !== null && candidate.revenue_growth_2027 > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {formatGrowth(candidate.revenue_growth_2027)}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${candidate.op_income_growth_2027 !== null && candidate.op_income_growth_2027 > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                          {formatGrowth(candidate.op_income_growth_2027)}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={candidate.comment}
                            onChange={(e) => handleInputChange(idx, 'comment', e.target.value)}
                            className="w-32 border p-1 rounded text-xs"
                            placeholder="메모"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
