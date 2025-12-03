'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// 데이터 타입 정의
type RankingItem = {
  rank: number;
  code: string;
  name: string;
  price: number;
  rs_score: number;
  date: string;
};

export default function DiscoveryPage() {
  const supabase = createClientComponentClient();

  // 상태 관리
  const [activeTab, setActiveTab] = useState<'RANKING' | 'SURGE'>('RANKING');
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const itemsPerPage = 20;

  // 데이터 가져오기
  const fetchRankings = useCallback(async (pageNum: number) => {
    // 페이지네이션 범위 계산 (0부터 시작)
    const from = (pageNum - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    // 1. 전체 개수 확인 (페이지네이션 계산용)
    const { count } = await supabase
      .from('latest_rs_rankings')
      .select('*', { count: 'exact', head: true });
    
    if (count) {
      setTotalPages(Math.ceil(count / itemsPerPage));
    }

    // 2. 실제 데이터 가져오기
    const { data, error } = await supabase
      .from('latest_rs_rankings')
      .select('*')
      .order('rank', { ascending: true }) // 1위부터 순서대로
      .range(from, to);

    if (error) {
      console.error('Error fetching rankings:', error);
    } else if (data) {
      setRankings(data as RankingItem[]);
    }
  }, [supabase]);

  useEffect(() => {
    if (activeTab === 'RANKING') {
      fetchRankings(page);
    }
  }, [activeTab, page, fetchRankings]);

  // 페이지 변경 핸들러
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 상단 헤더 (네비게이션) */}
      <header className="bg-white border-b px-6 py-4 flex items-center gap-6 shadow-sm">
        <h1 className="text-2xl font-bold text-blue-800">🚀 종목 발굴</h1>
        <nav className="flex gap-4 text-sm font-bold text-gray-500">
          <Link href="/" className="hover:text-blue-600 transition-colors">🗓️ 스케줄러</Link>
          <Link href="/chart" className="hover:text-blue-600 transition-colors">📊 밴드 차트</Link>
          <span className="text-blue-600 border-b-2 border-blue-600 cursor-default">🚀 발굴</span>
        </nav>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        
        {/* 메뉴 탭 */}
        <div className="flex gap-2 mb-6 border-b">
          <button
            onClick={() => setActiveTab('RANKING')}
            className={`px-4 py-2 font-bold text-sm transition-colors border-b-2 ${
              activeTab === 'RANKING' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            🏆 RS 랭킹 Top
          </button>
          <button
            onClick={() => setActiveTab('SURGE')}
            className={`px-4 py-2 font-bold text-sm transition-colors border-b-2 ${
              activeTab === 'SURGE' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📈 RS 급상승 (준비중)
          </button>
        </div>

        {/* 컨텐츠 영역 */}
        <div className="bg-white rounded-xl shadow border overflow-hidden">
          
          {activeTab === 'RANKING' ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-100 text-gray-600 font-bold uppercase">
                    <tr>
                      <th className="px-6 py-3 w-20 text-center">순위</th>
                      <th className="px-6 py-3 w-24">코드</th>
                      <th className="px-6 py-3">종목명</th>
                      <th className="px-6 py-3 text-right">현재가</th>
                      <th className="px-6 py-3 text-right">RS 점수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rankings.length > 0 ? (
                      rankings.map((item) => (
                        <tr key={item.code} className="hover:bg-blue-50 transition-colors">
                          <td className="px-6 py-3 text-center font-bold text-blue-800">
                            {item.rank}
                          </td>
                          <td className="px-6 py-3 text-gray-500 font-mono">
                            {item.code}
                          </td>
                          <td className="px-6 py-3 font-bold text-gray-800">
                            {item.name}
                          </td>
                          <td className="px-6 py-3 text-right font-mono">
                            {item.price?.toLocaleString()}원
                          </td>
                          <td className="px-6 py-3 text-right font-bold">
                            <span className={`px-2 py-1 rounded ${
                              item.rs_score >= 90 ? 'bg-red-100 text-red-600' :
                              item.rs_score >= 80 ? 'bg-orange-100 text-orange-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {item.rs_score}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                          데이터를 불러오는 중입니다...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* 페이지네이션 */}
              <div className="flex justify-center items-center gap-4 p-4 border-t">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                  className="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ◀ 이전
                </button>
                <span className="text-sm font-bold text-gray-600">
                  {page} / {totalPages} 페이지
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  다음 ▶
                </button>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-gray-400">
              🚧 RS 급상승 차트는 아직 준비 중입니다.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}