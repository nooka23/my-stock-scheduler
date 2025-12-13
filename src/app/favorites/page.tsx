'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

type Company = { code: string; name: string; };

type FavoriteStock = {
  id: number;
  company_code: string;
  company_name: string;
  group_name: string;
  created_at: string;
};

export default function FavoritesPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<FavoriteStock[]>([]);
  const [groups, setGroups] = useState<string[]>(['기본 그룹']);
  const [selectedGroup, setSelectedGroup] = useState<string>('기본 그룹');

  // 드래그 앤 드롭 상태 (그룹)
  const [dragItem, setDragItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);

  // 드래그 앤 드롭 상태 (종목)
  const [dragStockItem, setDragStockItem] = useState<number | null>(null);
  const [dragStockOverItem, setDragStockOverItem] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);

  // 종목 검색 관련
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // 그룹 생성 관련
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // 초기 데이터 로드
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
        router.push('/login');
        return;
      }

      // 1. 관심 종목 가져오기
      const { data: favData, error: favError } = await supabase
        .from('user_favorite_stocks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (favError) throw favError;

      if (favData) {
        setFavorites(favData);
        
        // 그룹 목록 추출
        const uniqueGroups = Array.from(new Set(favData.map(f => f.group_name || '기본 그룹')));
        if (!uniqueGroups.includes('기본 그룹')) uniqueGroups.unshift('기본 그룹');
        
        // LocalStorage에서 순서 불러오기
        const savedOrder = localStorage.getItem('groupOrder');
        if (savedOrder) {
            const order = JSON.parse(savedOrder);
            // 저장된 순서대로 정렬. DB에 없더라도 로컬 스토리지에 있으면 포함 (빈 그룹 지원)
            const orderedGroups = ['기본 그룹'];
            order.forEach((g: string) => {
                if (g !== '기본 그룹' && !orderedGroups.includes(g)) {
                    orderedGroups.push(g);
                }
            });
            // DB에는 있는데 순서 목록에 없는 경우 뒤에 추가
            uniqueGroups.forEach(g => {
                if (!orderedGroups.includes(g)) {
                    orderedGroups.push(g);
                }
            });
            setGroups(orderedGroups);
        } else {
            setGroups(uniqueGroups.sort());
        }
      }

      // 2. 전체 종목 리스트 가져오기 (검색용)
      const { data: compData, error: compError } = await supabase
        .from('companies')
        .select('code, name')
        .order('name');
      
      if (compError) throw compError;
      if (compData) setCompanyList(compData);

    } catch (e) {
      console.error(e);
      alert('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 검색 필터링
  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = companyList.filter(c => 
        c.name.includes(searchQuery) || c.code.includes(searchQuery)
      ).slice(0, 50); // 성능을 위해 50개만 표시
      setFilteredCompanies(filtered);
      setIsSearchOpen(true);
    } else {
      setFilteredCompanies([]);
      setIsSearchOpen(false);
    }
  }, [searchQuery, companyList]);

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, index: number) => {
      setDragItem(index);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
      setDragOverItem(index);
  };

  const handleDragEnd = () => {
      const _dragItem = dragItem;
      const _dragOverItem = dragOverItem;

      if (_dragItem === null || _dragOverItem === null || _dragItem === _dragOverItem) {
          setDragItem(null);
          setDragOverItem(null);
          return;
      }

      // '기본 그룹'(인덱스 0)은 이동 불가 및 그 자리로 이동 불가
      if (_dragItem === 0 || _dragOverItem === 0) {
          setDragItem(null);
          setDragOverItem(null);
          return;
      }

      const newGroups = [...groups];
      const draggedGroupContent = newGroups[_dragItem];

      newGroups.splice(_dragItem, 1);
      newGroups.splice(_dragOverItem, 0, draggedGroupContent);

      setDragItem(null);
      setDragOverItem(null);
      setGroups(newGroups);
      
      // 순서 저장
      localStorage.setItem('groupOrder', JSON.stringify(newGroups));
  };

  const handleStockDragStart = (e: React.DragEvent, index: number) => {
      setDragStockItem(index);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleStockDragEnter = (e: React.DragEvent, index: number) => {
      setDragStockOverItem(index);
  };

  const handleStockDragEnd = () => {
      const _dragItem = dragStockItem;
      const _dragOverItem = dragStockOverItem;

      if (_dragItem === null || _dragOverItem === null || _dragItem === _dragOverItem) {
          setDragStockItem(null);
          setDragStockOverItem(null);
          return;
      }

      // 현재 그룹의 종목들 복사 (상태 업데이트를 위해 전체 favorites에서 필터링된 것이 아니라, 현재 보여지는 순서 기준)
      const currentGroupFavs = [...currentGroupFavorites];
      const draggedItemContent = currentGroupFavs[_dragItem];

      currentGroupFavs.splice(_dragItem, 1);
      currentGroupFavs.splice(_dragOverItem, 0, draggedItemContent);

      // 전체 favorites 업데이트: 순서 변경을 반영하려면 정렬 기준이 필요하지만, 
      // 여기서는 UI 상의 순서만 로컬 스토리지에 저장하고, favorites 배열 자체는 건드리지 않거나, 
      // 로컬 스토리지 순서를 기준으로 favorites를 정렬해서 보여주는 방식을 사용해야 함.
      
      // 순서 코드 저장 (ID 대신 company_code 사용)
      const newOrder = currentGroupFavs.map(f => f.company_code);
      localStorage.setItem(`stockOrder_${selectedGroup}`, JSON.stringify(newOrder));
      
      setLastUpdate(prev => prev + 1);
      setDragStockItem(null);
      setDragStockOverItem(null);
  };


  // --- Actions ---

  // 1. 그룹 추가 (UI 상태만 업데이트, 실제 DB 저장은 종목 추가 시)
  const handleAddGroup = () => {
    if (!newGroupName.trim()) return;
    if (groups.includes(newGroupName.trim())) {
      alert('이미 존재하는 그룹입니다.');
      return;
    }
    const newGroups = [...groups, newGroupName.trim()];
    setGroups(newGroups);
    localStorage.setItem('groupOrder', JSON.stringify(newGroups));
    
    setSelectedGroup(newGroupName.trim());
    setNewGroupName('');
    setIsAddingGroup(false);
  };

  // 2. 그룹 삭제
  const handleDeleteGroup = async (groupName: string) => {
    if (groupName === '기본 그룹') {
      alert('기본 그룹은 삭제할 수 없습니다.');
      return;
    }
    if (!confirm(`'${groupName}' 그룹과 포함된 모든 종목을 삭제하시겠습니까?`)) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('user_favorite_stocks')
      .delete()
      .eq('user_id', user.id)
      .eq('group_name', groupName);

    if (error) {
      console.error(error);
      alert('삭제 실패');
      return;
    }

    // trading_candidates 테이블에서도 해당 그룹 삭제
    await supabase
      .from('trading_candidates')
      .delete()
      .eq('user_id', user.id)
      .eq('group_name', groupName);

    // UI 업데이트
    const newGroups = groups.filter(g => g !== groupName);
    setGroups(newGroups);
    localStorage.setItem('groupOrder', JSON.stringify(newGroups));

    setFavorites(prev => prev.filter(f => f.group_name !== groupName));
    setSelectedGroup('기본 그룹');
  };

  // 3. 종목 추가
  const handleAddStock = async (company: Company) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 이미 그룹에 있는지 확인
    const exists = favorites.some(f => f.company_code === company.code && f.group_name === selectedGroup);
    if (exists) {
      alert('이미 해당 그룹에 등록된 종목입니다.');
      setSearchQuery('');
      return;
    }

    const { data, error } = await supabase
      .from('user_favorite_stocks')
      .insert({
        user_id: user.id,
        company_code: company.code,
        company_name: company.name,
        group_name: selectedGroup
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      alert('추가 실패');
      return;
    }

    if (data) {
      setFavorites(prev => [data, ...prev]);
      setSearchQuery('');
    }
  };

  // 4. 종목 삭제
  const handleRemoveStock = async (id: number) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    const { error } = await supabase
      .from('user_favorite_stocks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(error);
      alert('삭제 실패');
      return;
    }

    setFavorites(prev => prev.filter(f => f.id !== id));
  };

  // 5. 종목 이동 (다른 그룹으로)
  const handleMoveStock = async (fav: FavoriteStock, targetGroup: string) => {
    if (fav.group_name === targetGroup) return;

    // 이동할 그룹에 이미 있는지 확인
    const exists = favorites.some(f => f.company_code === fav.company_code && f.group_name === targetGroup);
    if (exists) {
        alert(`'${targetGroup}' 그룹에 이미 존재하는 종목입니다.`);
        return;
    }

    const { error } = await supabase
        .from('user_favorite_stocks')
        .update({ group_name: targetGroup })
        .eq('id', fav.id);
    
    if (error) {
        console.error(error);
        alert('이동 실패');
        return;
    }

    setFavorites(prev => prev.map(f => f.id === fav.id ? { ...f, group_name: targetGroup } : f));
  };

  // 현재 선택된 그룹의 종목들 (정렬 적용)
  const currentGroupFavorites = useMemo(() => {
    const filtered = favorites.filter(f => f.group_name === selectedGroup);
    
    if (typeof window === 'undefined') return filtered;

    const savedOrderJson = localStorage.getItem(`stockOrder_${selectedGroup}`);
    if (!savedOrderJson) return filtered;

    try {
        const orderCodes: string[] = JSON.parse(savedOrderJson);
        return filtered.sort((a, b) => {
            const indexA = orderCodes.indexOf(a.company_code);
            const indexB = orderCodes.indexOf(b.company_code);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0; 
        });
    } catch (e) {
        return filtered;
    }
  }, [favorites, selectedGroup, lastUpdate]);

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* --- [1] 왼쪽 사이드바: 그룹 관리 --- */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            📂 관심 그룹
          </h2>
          <p className="text-xs text-gray-400 mt-1">그룹을 선택하여 관리하세요.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {groups.map((group, index) => (
            <div 
              key={group}
              draggable={group !== '기본 그룹'}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => setSelectedGroup(group)}
              className={`
                group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border select-none
                ${selectedGroup === group 
                  ? 'bg-blue-50 border-blue-200 shadow-sm' 
                  : 'bg-white border-transparent hover:bg-gray-100 hover:border-gray-200'}
                ${dragItem === index ? 'opacity-50 bg-gray-100 border-dashed border-gray-400' : ''}
                ${dragOverItem === index && dragItem !== index ? 'border-t-2 border-blue-500' : ''}
              `}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xl ${group !== '기본 그룹' ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                    {group === '기본 그룹' ? '⭐' : '📁'}
                </span>
                <span className={`font-bold ${selectedGroup === group ? 'text-blue-800' : 'text-gray-600'}`}>
                  {group}
                </span>
                <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500">
                  {favorites.filter(f => f.group_name === group).length}
                </span>
              </div>

              {group !== '기본 그룹' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteGroup(group);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                  title="그룹 삭제"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              )}
            </div>
          ))}

          {/* 그룹 추가 입력창 */}
          {isAddingGroup ? (
            <div className="p-3 bg-gray-50 rounded-xl border border-blue-200 animate-in fade-in slide-in-from-top-2">
              <input
                type="text"
                autoFocus
                placeholder="새 그룹 이름"
                className="w-full p-2 text-sm border border-gray-300 rounded mb-2 focus:outline-none focus:border-blue-500"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddGroup()}
              />
              <div className="flex gap-2 justify-end">
                <button 
                  onClick={() => setIsAddingGroup(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-200 rounded"
                >
                  취소
                </button>
                <button 
                  onClick={handleAddGroup}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-bold"
                >
                  확인
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingGroup(true)}
              className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center gap-2 font-bold text-sm"
            >
              + 새 그룹 추가
            </button>
          )}
        </div>
      </div>

      {/* --- [2] 오른쪽 메인: 종목 관리 --- */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50/50">
        {/* 헤더 */}
        <div className="p-8 pb-4">
          <div className="flex items-center justify-between mb-6">
             <div>
                <h1 className="text-3xl font-bold text-gray-800 mb-2">{selectedGroup}</h1>
                <p className="text-gray-500">
                    총 <span className="font-bold text-blue-600">{currentGroupFavorites.length}</span>개의 종목이 등록되어 있습니다.
                </p>
             </div>
             
             {/* 종목 검색 및 추가 */}
             <div className="relative w-96">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="종목명 또는 코드 검색..."
                        className="w-full pl-10 pr-4 py-3 rounded-full border border-gray-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <span className="absolute left-3.5 top-3.5 text-gray-400">🔍</span>
                </div>

                {/* 검색 결과 드롭다운 */}
                {isSearchOpen && filteredCompanies.length > 0 && (
                    <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 max-h-80 overflow-y-auto">
                        {filteredCompanies.map(company => (
                            <div
                                key={company.code}
                                onClick={() => handleAddStock(company)}
                                className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-none flex justify-between items-center group"
                            >
                                <div>
                                    <div className="font-bold text-gray-800">{company.name}</div>
                                    <div className="text-xs text-gray-400">{company.code}</div>
                                </div>
                                <span className="text-blue-600 font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                    + 추가
                                </span>
                            </div>
                        ))}
                    </div>
                )}
             </div>
          </div>
        </div>

        {/* 종목 리스트 */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
            {currentGroupFavorites.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentGroupFavorites.map((fav, index) => (
                        <div 
                            key={fav.id} 
                            draggable
                            onDragStart={(e) => handleStockDragStart(e, index)}
                            onDragEnter={(e) => handleStockDragEnter(e, index)}
                            onDragEnd={handleStockDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                            className={`
                                bg-white p-3 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between cursor-move
                                ${dragStockItem === index ? 'opacity-50 border-dashed border-gray-400' : ''}
                                ${dragStockOverItem === index && dragStockItem !== index ? 'border-t-4 border-blue-500' : ''}
                            `}
                        >
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm text-blue-400 font-bold w-5 text-center">{index + 1}</span>
                                <span className="font-bold text-base text-gray-800">{fav.company_name}</span>
                                <span className="text-xs font-mono text-gray-500">{fav.company_code}</span>
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveStock(fav.id);
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="종목 삭제"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-2xl mb-4">
                        ⭐
                    </div>
                    <p className="font-bold text-lg text-gray-600">등록된 종목이 없습니다.</p>
                    <p className="text-sm mt-1">우측 상단 검색창을 통해 관심 종목을 추가해보세요.</p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
