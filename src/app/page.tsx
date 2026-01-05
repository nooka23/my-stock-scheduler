'use client';

import { useState, useEffect, useCallback } from 'react';
import Calendar from 'react-calendar';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { User } from '@supabase/supabase-js';
import './calendar-style.css';

const STOCK_LIST = [
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "삼성바이오로직스", "현대차",
  "기아", "셀트리온", "POSCO홀딩스", "NAVER", "카카오"
];

type Participant = {
  id: number;
  user_email: string;
  user_name: string;
  user_id: string;
};

type Schedule = {
  id: number;
  date_str: string;
  end_date?: string | null;
  company: string;
  is_unlisted: boolean;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: string; 
  memo: string;
  author_email: string;
  author_name: string;
  participants?: Participant[];
};

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

type Company = {
  code: string;
  name: string;
};

const hours = Array.from({ length: 12 }, (_, i) => i + 1);
const minutes = ['00', '10', '20', '30', '40', '50'];

const formatDateToKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateInput = (date: Date | null) => (date ? formatDateToKey(date) : '');
const parseDateInput = (value: string) => (value ? new Date(`${value}T00:00:00`) : null);

const getRangeLabel = (start: Date | null, end: Date | null) => {
  if (!start && !end) return '';
  if (start && end) {
    const startKey = formatDateToKey(start);
    const endKey = formatDateToKey(end);
    return startKey === endKey ? startKey : `${startKey} ~ ${endKey}`;
  }
  return start ? formatDateToKey(start) : end ? formatDateToKey(end) : '';
};

const getTimeValue = (timeStr: string) => {
  const [ampm, time] = timeStr.split(' ');
  const [h, m] = time.split(':').map(Number);
  let hour = h;
  if (ampm === '오후' && h !== 12) hour += 12;
  if (ampm === '오전' && h === 12) hour = 0;
  return hour * 60 + m;
};

const getScheduleRangeKeys = (schedule: Schedule) => {
  const startKey = schedule.date_str;
  const endKey = schedule.end_date && schedule.end_date !== '' ? schedule.end_date : startKey;
  return { startKey, endKey };
};

export default function Home() {
  const supabase = createClientComponentClient();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  // 입력 폼 상태
  const [inputCompany, setInputCompany] = useState('');
  const [isUnlisted, setIsUnlisted] = useState(false);
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
  const [autoJoin, setAutoJoin] = useState(false);

  const fetchSchedules = useCallback(async () => {
    const { data: scheduleData, error: sError } = await supabase.from('schedules').select('*').order('id', { ascending: true });
    if (sError || !scheduleData) return;
    const { data: partData, error: pError } = await supabase.from('participants').select('*');
    if (pError) return;
    const combinedData = scheduleData.map(sch => ({
      ...sch,
      participants: partData?.filter(p => p.schedule_id === sch.id) || []
    }));
    setSchedules(combinedData);
  }, [supabase]);

  const fetchMyProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('nickname, is_admin').eq('id', userId).single();
    if (data) setMyProfile(data as MyProfile);
  }, [supabase]);

  const fetchCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name', { ascending: true })
      .range(0, 9999); 
    
    if (!error && data) {
      setCompanyList(data as Company[]);
    }
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if(session?.user) {
        fetchSchedules(); fetchMyProfile(session.user.id); fetchCompanies();
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if(session?.user) {
        fetchSchedules(); fetchMyProfile(session.user.id); fetchCompanies();
      } else {
        setSchedules([]); setMyProfile(null); setCompanyList([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, fetchSchedules, fetchMyProfile, fetchCompanies]);

  useEffect(() => {
    if (editingId) {
      const target = schedules.find(s => s.id === editingId);
      if (target) {
        const targetDate = new Date(target.date_str);
        const targetEndDate = target.end_date ? new Date(target.end_date) : targetDate;
        setSelectedDate(targetDate);
        setRangeStart(targetDate);
        setRangeEnd(targetEndDate);
        setInputCompany(target.company); setIsUnlisted(target.is_unlisted);
        setInputLocation(target.location); setMaxParticipants(target.max_participants);
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
      setAutoJoin(true); 
      setRangeStart(selectedDate);
      setRangeEnd(selectedDate);
    }
  }, [editingId, isPanelOpen, schedules]);

  const handleStartAmPmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setStartAmPm(val);
    setEndAmPm(val);
  };

  const handleStartHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setStartHour(val);
    let nextHour = parseInt(val) + 1;
    if (nextHour > 12) nextHour = 1; 
    setEndHour(nextHour.toString());
  };

  const handleDayClick = (value: Date) => {
    setEditingId(null);
    setSelectedDate(value);
    setRangeStart(value);
    setRangeEnd(value);
    setIsPanelOpen(true);
  };
  const handleScheduleClick = (e: React.MouseEvent, schedule: Schedule) => { e.stopPropagation(); setEditingId(schedule.id); setIsPanelOpen(true); };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);
    if (!isUnlisted && value.trim() !== '') {
      const lowerValue = value.toLowerCase();
      const filtered = companyList.filter(comp => comp.name.toLowerCase().includes(lowerValue) || comp.code.includes(value));
      setFilteredCompanies(filtered); setShowDropdown(true);
    } else { setShowDropdown(false); }
  };
  const selectCompany = (company: Company) => { setInputCompany(company.name); setShowDropdown(false); };

  const handleSave = async () => {
    if (!user || (!selectedDate && !rangeStart && !rangeEnd)) return;
    const isValidCompany = companyList.some(c => c.name === inputCompany);
    if (!isUnlisted && !isValidCompany) { alert("목록에 있는 기업을 선택하거나, '비상장'을 체크해주세요."); return; }
    if (!inputCompany) { alert("기업명을 입력해주세요."); return; }

    const myName = myProfile?.nickname || user.email?.split('@')[0] || "익명";
    const startDate = rangeStart || selectedDate || null;
    const endDate = rangeEnd || startDate;
    if (!startDate) return;
    let rangeStartDate = startDate;
    let rangeEndDate = endDate || startDate;
    if (rangeStartDate > rangeEndDate) {
      const temp = rangeStartDate;
      rangeStartDate = rangeEndDate;
      rangeEndDate = temp;
    }

    const scheduleData = {
      date_str: formatDateToKey(rangeStartDate),
      ...(rangeStartDate.getTime() !== rangeEndDate.getTime()
        ? { end_date: formatDateToKey(rangeEndDate) }
        : {}),
      company: inputCompany,
      is_unlisted: isUnlisted,
      start_time: `${startAmPm} ${startHour}:${startMin}`,
      end_time: `${endAmPm} ${endHour}:${endMin}`,
      location: inputLocation,
      max_participants: maxParticipants,
      memo: inputMemo,
      author_email: user.email,
      author_name: myName,
    };

    if (editingId) {
      const { error } = await supabase.from('schedules').update(scheduleData).eq('id', editingId);
      if (error) alert(`일정 수정 실패: ${error.message}`);
    } else {
      const { data: newSchedules, error } = await supabase.from('schedules').insert([scheduleData]).select();
      if (error) { alert(`일정 저장 실패: ${error.message}`); } 
      else if (newSchedules && newSchedules.length > 0) {
        if (autoJoin) {
          const newId = newSchedules[0].id;
          await supabase.from('participants').insert([{ schedule_id: newId, user_email: user.email, user_name: myName, user_id: user.id }]);
        }
      }
    }
    await fetchSchedules(); setIsPanelOpen(false); setEditingId(null);
  };

  const handleDelete = async () => {
    if (!user || !editingId) return;
    if (confirm("삭제하시겠습니까?")) {
      const { error } = await supabase.from('schedules').delete().eq('id', editingId);
      if (!error) { await fetchSchedules(); setIsPanelOpen(false); setEditingId(null); }
    }
  };

  const handleToggleJoin = async () => {
    if (!editingId || !user) return;
    const target = schedules.find(s => s.id === editingId);
    if (!target) return;
    const myParticipation = target.participants?.find(p => p.user_id === user.id);
    const myName = myProfile?.nickname || user.email?.split('@')[0] || "익명";

    if (myParticipation) {
      if (confirm("참가를 취소하시겠습니까?")) {
        const { error } = await supabase.from('participants').delete().eq('id', myParticipation.id);
        if (!error) { alert("취소되었습니다."); await fetchSchedules(); }
      }
    } else {
      const maxNum = target.max_participants === "참석불가" ? 0 : 
                     target.max_participants === "5명 이상" ? 99 : parseInt(target.max_participants.replace('명', ''));
      const currentCount = target.participants?.length || 0;
      if (currentCount >= maxNum) { alert("모집 인원이 꽉 찼습니다!"); return; }
      const { error } = await supabase.from('participants').insert([{ schedule_id: editingId, user_email: user.email, user_name: myName, user_id: user.id }]);
      if (!error) { alert("참가 신청 완료!"); await fetchSchedules(); }
    }
  };

  const isJoined = editingId && user ? schedules.find(s => s.id === editingId)?.participants?.some(p => p.user_id === user.id) : false;
  const canDelete = editingId && user ? (myProfile?.is_admin || schedules.find(s => s.id === editingId)?.author_email === user.email) : false;

  return (
    // Layout container handled by RootLayout + Sidebar. We just need to fill the available space.
    <main className="flex flex-col lg:flex-row h-full bg-gray-50">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-4 lg:p-6 transition-all duration-300">
        
        {/* Header Title Only - Nav and User Profile moved to Sidebar */}
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-blue-800">
              📈 기업 탐방 스케줄러
            </h1>
        </div>

        <div className="bg-white p-4 lg:p-6 rounded-xl shadow-md h-full">
          <Calendar 
            locale="ko-KR"
            calendarType="gregory"
            formatDay={(locale, date) => date.getDate().toString()}
            onClickDay={handleDayClick}
            tileContent={({ date, view }) => {
              if (view !== 'month') return null;
              const dayKey = formatDateToKey(date);
              
              const daysSchedules = schedules
                .filter(s => {
                  const { startKey, endKey } = getScheduleRangeKeys(s);
                  return dayKey >= startKey && dayKey <= endKey;
                })
                .sort((a, b) => getTimeValue(a.start_time) - getTimeValue(b.start_time));

              return (
                <div className="tile-content-container flex flex-col gap-1">
                  {daysSchedules.map(schedule => {
                    const count = schedule.participants?.length || 0;
                    const max = schedule.max_participants.replace('명', '');
                    const amIJoined = schedule.participants?.some(p => p.user_id === user?.id);
                    
                    const barColor = amIJoined 
                      ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-200" 
                      : "bg-blue-50 text-blue-800 border-blue-100 hover:bg-blue-100";

                    return (
                      <div 
                        key={schedule.id} 
                        onClick={(e) => handleScheduleClick(e, schedule)}
                        className={`schedule-bar flex items-center gap-1 cursor-pointer transition-colors border ${barColor}`}
                      >
                        <span className="text-[10px] font-bold opacity-75">
                          {schedule.start_time.split(' ')[1]}
                        </span>
                        <span className="truncate">{schedule.company}</span>
                        <span className="ml-auto text-[9px] bg-white px-1 rounded-sm border opacity-80">
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

      {/* Side Panel for Schedule Details */}
      {isPanelOpen && (
        <div className="w-full lg:w-[450px] bg-white border-l shadow-2xl h-full p-5 lg:p-8 overflow-y-auto flex flex-col animate-slide-in z-20 fixed lg:absolute inset-0 lg:inset-auto lg:right-0 lg:top-0 lg:bottom-0">
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">{editingId ? "일정 상세" : "새 일정 등록"}</h2>
              <p className="text-gray-500 text-sm mt-1">{getRangeLabel(rangeStart, rangeEnd)}</p>
            </div>
            <button onClick={() => setIsPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold p-2">✕</button>
          </div>

          <div className="flex flex-col gap-6 flex-1">
            {editingId && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-blue-900">참가 현황</p>
                    <p className="text-xs text-blue-600">현재 {schedules.find(s=>s.id === editingId)?.participants?.length}명 (정원: {maxParticipants})</p>
                  </div>
                  <button onClick={handleToggleJoin} className={`text-sm font-bold px-4 py-2 rounded shadow-sm transition-transform active:scale-95 text-white ${isJoined ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    {isJoined ? "불참하기(취소) 🚫" : "참가하기 ✋"}
                  </button>
                </div>
                <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                   <p className="mb-1">✍️ <b>작성자:</b> {schedules.find(s=>s.id === editingId)?.author_name || schedules.find(s=>s.id === editingId)?.author_email}</p>
                   <hr className="my-1"/>
                   <p className="font-bold mb-1">🏃 참가자 명단:</p>
                   <ul className="list-disc pl-4 space-y-1">
                     {schedules.find(s=>s.id === editingId)?.participants?.map(p => (
                       <li key={p.id}>{p.user_name || p.user_email} {p.user_email === user?.email && " (나)"}</li>
                     ))}
                   </ul>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">시작 날짜</label>
                <input
                  type="date"
                  className="w-full border p-3 rounded-lg bg-white"
                  value={formatDateInput(rangeStart)}
                  onChange={(e) => setRangeStart(parseDateInput(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">종료 날짜</label>
                <input
                  type="date"
                  className="w-full border p-3 rounded-lg bg-white"
                  value={formatDateInput(rangeEnd)}
                  onChange={(e) => setRangeEnd(parseDateInput(e.target.value))}
                />
              </div>
            </div>
            {!editingId && (
              <p className="text-xs text-gray-500 -mt-3">
                하루 일정은 시작/종료 날짜를 동일하게 설정하세요.
              </p>
            )}

            <div className="relative">
              <label className="block text-sm font-bold text-gray-700 mb-2">기업명</label>
              <div className="flex items-center gap-2 mb-2">
                 <input type="checkbox" checked={isUnlisted} onChange={(e) => { setIsUnlisted(e.target.checked); setShowDropdown(false); }} className="accent-blue-600" />
                 <span className="text-xs text-gray-500">비상장</span>
              </div>
              <input type="text" placeholder={isUnlisted ? "기업명 직접 입력" : "기업명 검색 (예: 삼성 or 005930)"} className="w-full border p-3 rounded-lg outline-none" value={inputCompany} onChange={handleCompanyChange} />
              {showDropdown && filteredCompanies.length > 0 && (
                <ul className="absolute z-10 w-full bg-white border mt-1 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                  {filteredCompanies.map((comp) => (
                     <li key={comp.code} onClick={() => selectCompany(comp)} className="p-3 hover:bg-blue-50 cursor-pointer text-sm border-b flex justify-between">
                        <span>{comp.name}</span><span className="text-gray-400 text-xs ml-2">{comp.code}</span>
                     </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">시작 시간</label>
                  <div className="flex gap-1">
                     <select className="border rounded p-2 text-sm w-full" value={startAmPm} onChange={handleStartAmPmChange}><option>오전</option><option>오후</option></select>
                     <select className="border rounded p-2 text-sm w-full" value={startHour} onChange={handleStartHourChange}>{hours.map(h => <option key={h}>{h}</option>)}</select>
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

            <div><label className="block text-sm font-bold text-gray-700 mb-2">장소</label><input type="text" className="w-full border p-3 rounded-lg" value={inputLocation} onChange={(e) => setInputLocation(e.target.value)} /></div>
            <div>
               <label className="block text-sm font-bold text-gray-700 mb-2">참가 가능 인원</label>
               <select className="w-full border p-3 rounded-lg bg-white" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)}>
                  <option value="참석불가">❌ 참석 불가</option><option value="1명">1명</option><option value="2명">2명</option><option value="3명">3명</option><option value="4명">4명</option><option value="5명 이상">5명 이상</option>
               </select>
            </div>
            <div><label className="block text-sm font-bold text-gray-700 mb-2">비고</label><textarea className="w-full border p-3 rounded-lg h-24 resize-none" value={inputMemo} onChange={(e) => setInputMemo(e.target.value)} /></div>

            <div className="mt-auto pt-4 flex flex-col gap-3">
              {!editingId && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <input type="checkbox" id="autoJoin" checked={autoJoin} onChange={(e) => setAutoJoin(e.target.checked)} className="accent-blue-600 w-4 h-4 cursor-pointer" />
                    <label htmlFor="autoJoin" className="text-sm text-gray-700 cursor-pointer select-none">이 일정에 <b>자동으로 참석</b>하기</label>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setIsPanelOpen(false)} className="flex-1 py-3 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold">취소</button>
                    <button onClick={handleSave} className="flex-[2] py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">일정 저장</button>
                  </div>
                </>
              )}
              {editingId && canDelete && (
                <div className="flex gap-3">
                  <button onClick={handleDelete} className="flex-1 py-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-bold">삭제</button>
                  <button onClick={handleSave} className="flex-[2] py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-md">수정 완료</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
