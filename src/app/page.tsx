'use client';

import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import Link from 'next/link';
import './calendar-style.css';

// --- [가짜 데이터] ---
const STOCK_LIST = [
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "삼성바이오로직스", "현대차",
  "기아", "셀트리온", "POSCO홀딩스", "NAVER", "카카오"
];

// --- [타입 정의] ---
type Participant = {
  id: number;
  user_email: string;
  user_id: string;
};

type Schedule = {
  id: number;
  date_str: string;
  company: string;
  is_unlisted: boolean;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: string; 
  memo: string;
  author_email: string; // ★ 작성자 추가
  participants?: Participant[]; // ★ 참가자 명단 추가
};

const hours = Array.from({ length: 12 }, (_, i) => i + 1);
const minutes = ['00', '10', '20', '30', '40', '50'];

const formatDateToKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Home() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // 입력 폼 상태
  const [inputCompany, setInputCompany] = useState('');
  const [isUnlisted, setIsUnlisted] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [startAmPm, setStartAmPm] = useState('오전');
  const [startHour, setStartHour] = useState('10');
  const [startMin, setStartMin] = useState('00');
  const [endAmPm, setEndAmPm] = useState('오전');
  const [endHour, setEndHour] = useState('11');
  const [endMin, setEndMin] = useState('00');
  const [inputLocation, setInputLocation] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('1명');
  const [inputMemo, setInputMemo] = useState('');

  // ★ 데이터 불러오기 (참가자 명단까지 조인해서 가져옴)
  const fetchSchedules = async () => {
    // 1. 일정 가져오기
    const { data: scheduleData, error: sError } = await supabase
      .from('schedules')
      .select('*')
      .order('id', { ascending: true });
    
    if (sError || !scheduleData) return;

    // 2. 참가자 명단 가져오기
    const { data: partData, error: pError } = await supabase
      .from('participants')
      .select('*');
      
    if (pError) return;

    // 3. 데이터 합치기 (일정 + 참가자)
    const combinedData = scheduleData.map(sch => ({
      ...sch,
      participants: partData?.filter(p => p.schedule_id === sch.id) || []
    }));

    setSchedules(combinedData);
  };

  useEffect(() => {
    // 세션 체크
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if(session?.user) fetchSchedules(); // 로그인 된 경우만 데이터 로드
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if(session?.user) fetchSchedules();
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload(); // 미들웨어가 로그인 페이지로 보냄
  };

  // 폼 채우기 로직
  useEffect(() => {
    if (editingId) {
      const target = schedules.find(s => s.id === editingId);
      if (target) {
        setSelectedDate(new Date(target.date_str));
        setInputCompany(target.company);
        setIsUnlisted(target.is_unlisted);
        setInputLocation(target.location);
        setMaxParticipants(target.max_participants);
        setInputMemo(target.memo);
        const [sAmpm, sTime] = target.start_time.split(' ');
        const [sHr, sMin] = sTime.split(':');
        setStartAmPm(sAmpm); setStartHour(sHr); setStartMin(sMin);
        const [eAmpm, eTime] = target.end_time.split(' ');
        const [eHr, eMin] = eTime.split(':');
        setEndAmPm(eAmpm); setEndHour(eHr); setEndMin(eMin);
      }
    } else {
      setInputCompany(''); setIsUnlisted(false); setFilteredCompanies([]); setShowDropdown(false);
      setStartAmPm('오전'); setStartHour('10'); setStartMin('00');
      setEndAmPm('오전'); setEndHour('11'); setEndMin('00');
      setInputLocation(''); setMaxParticipants('1명'); setInputMemo('');
    }
  }, [editingId, isPanelOpen]);

  const handleDayClick = (value: Date) => {
    setEditingId(null);
    setSelectedDate(value);
    setIsPanelOpen(true);
  };

  const handleScheduleClick = (e: React.MouseEvent, schedule: Schedule) => {
    e.stopPropagation();
    setEditingId(schedule.id);
    setIsPanelOpen(true);
  };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);
    if (!isUnlisted && value.trim() !== '') {
      const filtered = STOCK_LIST.filter(stock => stock.includes(value));
      setFilteredCompanies(filtered);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };
  const selectCompany = (name: string) => { setInputCompany(name); setShowDropdown(false); };

  // ★ 저장 (Create/Update) - 작성자 이메일 포함
  const handleSave = async () => {
    if (!user || !selectedDate) return;
    if (!isUnlisted && !STOCK_LIST.includes(inputCompany)) { alert("목록 선택 또는 비상장 체크 필요"); return; }
    if (!inputCompany) { alert("기업명 입력 필요"); return; }

    const scheduleData = {
      date_str: formatDateToKey(selectedDate),
      company: inputCompany,
      is_unlisted: isUnlisted,
      start_time: `${startAmPm} ${startHour}:${startMin}`,
      end_time: `${endAmPm} ${endHour}:${endMin}`,
      location: inputLocation,
      max_participants: maxParticipants,
      memo: inputMemo,
      author_email: user.email, // ★ 작성자 정보 저장
    };

    if (editingId) {
      const { error } = await supabase.from('schedules').update(scheduleData).eq('id', editingId);
      if (error) alert('수정 실패');
    } else {
      const { error } = await supabase.from('schedules').insert([scheduleData]);
      if (error) alert('저장 실패');
    }

    await fetchSchedules();
    setIsPanelOpen(false);
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!user || !editingId) return;
    if (confirm("삭제하시겠습니까?")) {
      const { error } = await supabase.from('schedules').delete().eq('id', editingId);
      if (!error) {
        await fetchSchedules();
        setIsPanelOpen(false);
        setEditingId(null);
      }
    }
  };

  // ★ 참가 / 취소 토글 로직
  const handleToggleJoin = async () => {
    if (!editingId || !user) return;
    const target = schedules.find(s => s.id === editingId);
    if (!target) return;

    // 이미 참가했는지 확인
    const myParticipation = target.participants?.find(p => p.user_id === user.id);

    if (myParticipation) {
      // [취소 로직] 이미 참가자 명단에 있다면 -> 삭제
      if (confirm("참가를 취소하시겠습니까?")) {
        const { error } = await supabase.from('participants').delete().eq('id', myParticipation.id);
        if (!error) {
           alert("취소되었습니다.");
           await fetchSchedules();
        }
      }
    } else {
      // [참가 로직] 명단에 없다면 -> 추가
      // 인원 체크
      const maxNum = target.max_participants === "참석불가" ? 0 : 
                     target.max_participants === "5명 이상" ? 99 : 
                     parseInt(target.max_participants.replace('명', ''));
      const currentCount = target.participants?.length || 0;

      if (currentCount >= maxNum) {
        alert("모집 인원이 꽉 찼습니다!");
        return;
      }

      const { error } = await supabase.from('participants').insert([{
        schedule_id: editingId,
        user_email: user.email,
        user_id: user.id
      }]);

      if (!error) {
        alert("참가 신청 완료!");
        await fetchSchedules();
      }
    }
  };

  // 현재 선택된 일정의 내 참가 여부 확인
  const isJoined = editingId && user 
    ? schedules.find(s => s.id === editingId)?.participants?.some(p => p.user_id === user.id)
    : false;

  return (
    <main className="flex h-screen bg-gray-50 overflow-hidden">
      
      {/* 왼쪽 달력 영역 */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 transition-all duration-300">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-800">
            📈 기업 탐방 스케줄러
          </h1>
          {user && (
             <div className="flex items-center gap-3">
               <span className="text-sm text-gray-600">
                 <b>{user.email?.split('@')[0]}</b>님 환영합니다
               </span>
               <button onClick={handleLogout} className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">
                 로그아웃
               </button>
             </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-md h-full">
          <Calendar 
            locale="ko-KR"
            calendarType="gregory"
            formatDay={(locale, date) => date.getDate().toString()}
            onClickDay={handleDayClick}
            tileContent={({ date, view }) => {
              if (view !== 'month') return null;
              const dayKey = formatDateToKey(date);
              const daysSchedules = schedules.filter(s => s.date_str === dayKey);

              return (
                <div className="w-full mt-1 flex flex-col gap-1">
                  {daysSchedules.map(schedule => {
                    const count = schedule.participants?.length || 0;
                    const max = schedule.max_participants.replace('명', '');
                    // 내가 참가했는지 확인하여 색상 변경
                    const amIJoined = schedule.participants?.some(p => p.user_id === user?.id);
                    const barColor = amIJoined ? "bg-blue-100 border-blue-300" : "bg-gray-50";

                    return (
                      <div 
                        key={schedule.id} 
                        onClick={(e) => handleScheduleClick(e, schedule)}
                        className={`schedule-bar flex items-center gap-1 text-blue-800 cursor-pointer hover:bg-blue-200 transition-colors border ${barColor}`}
                      >
                        <span className="text-[10px] font-bold opacity-75">
                          {schedule.start_time.split(' ')[1]}
                        </span>
                        <span className="truncate">{schedule.company}</span>
                        <span className="ml-auto text-[9px] bg-white px-1 rounded-sm border">
                          {count}/{max}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
        </div>
      </div>

      {/* 우측 패널 */}
      {isPanelOpen && (
        <div className="w-[450px] bg-white border-l shadow-2xl h-full p-8 overflow-y-auto flex flex-col animate-slide-in">
          
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">
                {editingId ? "일정 상세" : "새 일정 등록"}
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                {selectedDate && formatDateToKey(selectedDate)}
              </p>
            </div>
            <button onClick={() => setIsPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold p-2">✕</button>
          </div>

          <div className="flex flex-col gap-6 flex-1">
            
            {/* ★ 참가 현황 및 버튼 (기존 일정일 때만 표시) */}
            {editingId && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-blue-900">참가 현황</p>
                    <p className="text-xs text-blue-600">
                      현재 {schedules.find(s=>s.id === editingId)?.participants?.length}명 
                      (정원: {maxParticipants})
                    </p>
                  </div>
                  <button 
                    onClick={handleToggleJoin}
                    className={`text-sm font-bold px-4 py-2 rounded shadow-sm transition-transform active:scale-95 text-white ${isJoined ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {isJoined ? "불참하기(취소) 🚫" : "참가하기 ✋"}
                  </button>
                </div>
                
                {/* 작성자 & 참가자 리스트 표시 */}
                <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                   <p className="mb-1">✍️ <b>작성자:</b> {schedules.find(s=>s.id === editingId)?.author_email}</p>
                   <hr className="my-1"/>
                   <p className="font-bold mb-1">🏃 참가자 명단:</p>
                   <ul className="list-disc pl-4 space-y-1">
                     {schedules.find(s=>s.id === editingId)?.participants?.map(p => (
                       <li key={p.id}>{p.user_email} {p.user_email === user?.email && "(나)"}</li>
                     ))}
                     {(!schedules.find(s=>s.id === editingId)?.participants?.length) && (
                       <span className="text-gray-400">참가자가 없습니다.</span>
                     )}
                   </ul>
                </div>
              </div>
            )}

            {/* 입력 폼들 */}
            <div className="relative">
              <label className="block text-sm font-bold text-gray-700 mb-2">기업명</label>
              <div className="flex items-center gap-2 mb-2">
                 <input type="checkbox" checked={isUnlisted} onChange={(e) => { setIsUnlisted(e.target.checked); setShowDropdown(false); }} className="accent-blue-600" />
                 <span className="text-xs text-gray-500">비상장</span>
              </div>
              <input type="text" placeholder="기업명" className="w-full border p-3 rounded-lg outline-none" value={inputCompany} onChange={handleCompanyChange} />
              {showDropdown && filteredCompanies.length > 0 && (
                <ul className="absolute z-10 w-full bg-white border mt-1 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                  {filteredCompanies.map((stock) => (
                     <li key={stock} onClick={() => selectCompany(stock)} className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b">{stock}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">시작 시간</label>
                  <div className="flex gap-1">
                     <select className="border rounded p-2 text-sm w-full" value={startAmPm} onChange={e=>setStartAmPm(e.target.value)}><option>오전</option><option>오후</option></select>
                     <select className="border rounded p-2 text-sm w-full" value={startHour} onChange={e=>setStartHour(e.target.value)}>{hours.map(h => <option key={h}>{h}</option>)}</select>
                     <select className="border rounded p-2 text-sm w-full" value={startMin} onChange={e=>setStartMin(e.target.value)}>{minutes.map(m => <option key={m}>{m}</option>)}</select>
                  </div>
               </div>
               <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">종료 시간</label>
                  <div className="flex gap-1">
                     <select className="border rounded p-2 text-sm w-full" value={endAmPm} onChange={e=>setEndAmPm(e.target.value)}><option>오전</option><option>오후</option></select>
                     <select className="border rounded p-2 text-sm w-full" value={endHour} onChange={e=>setEndHour(e.target.value)}>{hours.map(h => <option key={h}>{h}</option>)}</select>
                     <select className="border rounded p-2 text-sm w-full" value={endMin} onChange={e=>setEndMin(e.target.value)}>{minutes.map(m => <option key={m}>{m}</option>)}</select>
                  </div>
               </div>
            </div>

            <div>
               <label className="block text-sm font-bold text-gray-700 mb-2">장소</label>
               <input type="text" className="w-full border p-3 rounded-lg" value={inputLocation} onChange={(e) => setInputLocation(e.target.value)} />
            </div>
            <div>
               <label className="block text-sm font-bold text-gray-700 mb-2">참가 가능 인원</label>
               <select className="w-full border p-3 rounded-lg bg-white" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)}>
                  <option value="참석불가">❌ 참석 불가</option>
                  <option value="1명">1명</option>
                  <option value="2명">2명</option>
                  <option value="3명">3명</option>
                  <option value="4명">4명</option>
                  <option value="5명 이상">5명 이상</option>
               </select>
            </div>
            <div>
               <label className="block text-sm font-bold text-gray-700 mb-2">비고</label>
               <textarea className="w-full border p-3 rounded-lg h-24 resize-none" value={inputMemo} onChange={(e) => setInputMemo(e.target.value)} />
            </div>

            <div className="mt-auto pt-6 flex gap-3">
              {editingId ? (
                <>
                  <button onClick={handleDelete} className="flex-1 py-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-bold">삭제</button>
                  <button onClick={handleSave} className="flex-[2] py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">수정 완료</button>
                </>
              ) : (
                <>
                  <button onClick={() => setIsPanelOpen(false)} className="flex-1 py-3 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold">취소</button>
                  <button onClick={handleSave} className="flex-[2] py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">일정 저장</button>
                </>
              )}
            </div>

          </div>
        </div>
      )}
    </main>
  );
}