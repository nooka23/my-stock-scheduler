'use client';

import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import { supabase } from '@/lib/supabase'; // 지난번에 만든 연결 파일 불러오기
import './calendar-style.css';

// --- [가짜 데이터] ---
const STOCK_LIST = [
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "삼성바이오로직스", "현대차",
  "기아", "셀트리온", "POSCO홀딩스", "NAVER", "카카오"
];

// --- [타입 정의] DB 컬럼명과 일치시킴 (snake_case) ---
type Schedule = {
  id: number;
  date_str: string;
  company: string;
  is_unlisted: boolean;
  start_time: string;
  end_time: string;
  location: string;
  max_participants: string; 
  current_participants: number;
  memo: string;
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

  // ★ 1. 데이터 불러오기 함수 (Read)
  const fetchSchedules = async () => {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .order('id', { ascending: true }); // 등록순 정렬

    if (error) console.error('Error fetching:', error);
    else setSchedules(data || []);
  };

  // 앱이 처음 켜질 때 한번 실행
  useEffect(() => {
    fetchSchedules();
  }, []);

  // 패널이 열리거나 수정 모드일 때 폼 채우기
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
      // 초기화
      setInputCompany('');
      setIsUnlisted(false);
      setFilteredCompanies([]);
      setShowDropdown(false);
      setStartAmPm('오전'); setStartHour('10'); setStartMin('00');
      setEndAmPm('오전'); setEndHour('11'); setEndMin('00');
      setInputLocation('');
      setMaxParticipants('1명');
      setInputMemo('');
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

  const selectCompany = (name: string) => {
    setInputCompany(name);
    setShowDropdown(false);
  };

  // ★ 2. 저장 및 수정 (Create & Update)
  const handleSave = async () => {
    if (!selectedDate) return;
    if (!isUnlisted && !STOCK_LIST.includes(inputCompany)) {
      alert("목록에 있는 기업을 선택하거나, '비상장'을 체크해주세요.");
      return;
    }
    if (!inputCompany) { alert("기업명을 입력해주세요."); return; }

    const scheduleData = {
      date_str: formatDateToKey(selectedDate),
      company: inputCompany,
      is_unlisted: isUnlisted,
      start_time: `${startAmPm} ${startHour}:${startMin}`,
      end_time: `${endAmPm} ${endHour}:${endMin}`,
      location: inputLocation,
      max_participants: maxParticipants,
      memo: inputMemo,
    };

    if (editingId) {
      // 수정 (Update)
      const { error } = await supabase
        .from('schedules')
        .update(scheduleData)
        .eq('id', editingId);
      
      if (error) alert('수정 중 에러가 발생했습니다.');
    } else {
      // 생성 (Insert)
      const { error } = await supabase
        .from('schedules')
        .insert([{ ...scheduleData, current_participants: 0 }]);

      if (error) alert('저장 중 에러가 발생했습니다.');
    }

    await fetchSchedules(); // 목록 새로고침
    setIsPanelOpen(false);
    setEditingId(null);
  };

  // ★ 3. 삭제 (Delete)
  const handleDelete = async () => {
    if (!editingId) return;
    if (confirm("정말 이 일정을 삭제하시겠습니까?")) {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', editingId);

      if (!error) {
        await fetchSchedules();
        setIsPanelOpen(false);
        setEditingId(null);
      }
    }
  };

  // ★ 4. 참가 신청 (Update Count)
  const handleJoin = async () => {
    if (!editingId) return;
    
    const target = schedules.find(s => s.id === editingId);
    if (!target) return;

    // 인원 체크 로직
    const maxNum = target.max_participants === "참석불가" ? 0 : 
                   target.max_participants === "5명 이상" ? 99 : 
                   parseInt(target.max_participants.replace('명', ''));
    
    if (target.current_participants >= maxNum) {
      alert("모집 인원이 꽉 찼습니다!");
      return;
    }

    const { error } = await supabase
      .from('schedules')
      .update({ current_participants: target.current_participants + 1 })
      .eq('id', editingId);

    if (!error) {
      alert("참가 신청이 완료되었습니다!");
      await fetchSchedules();
    }
  };

  return (
    <main className="flex h-screen bg-gray-50 overflow-hidden">
      
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 transition-all duration-300">
        <h1 className="text-3xl font-bold text-blue-800 mb-6">
          📈 기업 탐방 스케줄러
        </h1>

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
                  {daysSchedules.map(schedule => (
                    <div 
                      key={schedule.id} 
                      onClick={(e) => handleScheduleClick(e, schedule)}
                      className="schedule-bar flex items-center gap-1 bg-blue-50 text-blue-800 cursor-pointer hover:bg-blue-100 transition-colors"
                    >
                      <span className="text-[10px] font-bold opacity-75">
                        {schedule.start_time.split(' ')[1]}
                      </span>
                      <span className="truncate">{schedule.company}</span>
                      <span className="ml-auto text-[9px] bg-blue-200 px-1 rounded-sm">
                        {schedule.current_participants}/{schedule.max_participants.replace('명', '')}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
        </div>
      </div>

      {isPanelOpen && (
        <div className="w-[450px] bg-white border-l shadow-2xl h-full p-8 overflow-y-auto flex flex-col animate-slide-in">
          
          <div className="flex justify-between items-center mb-6 border-b pb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">
                {editingId ? "일정 상세 / 수정" : "새 일정 등록"}
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                {selectedDate && formatDateToKey(selectedDate)}
              </p>
            </div>
            <button onClick={() => setIsPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold p-2">✕</button>
          </div>

          <div className="flex flex-col gap-6 flex-1">
            
            {editingId && (
              <div className="bg-blue-50 p-4 rounded-lg flex items-center justify-between border border-blue-100">
                <div>
                  <p className="text-sm font-bold text-blue-900">참가 현황</p>
                  <p className="text-xs text-blue-600">
                    현재 {schedules.find(s=>s.id === editingId)?.current_participants}명 신청 중 
                    (정원: {maxParticipants})
                  </p>
                </div>
                <button onClick={handleJoin} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded shadow-sm transition-transform active:scale-95">참가하기 ✋</button>
              </div>
            )}

            <div className="relative">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-bold text-gray-700">기업명</label>
                <label className="flex items-center gap-1 text-xs cursor-pointer select-none text-gray-500">
                  <input type="checkbox" checked={isUnlisted} onChange={(e) => { setIsUnlisted(e.target.checked); setShowDropdown(false); }} className="accent-blue-600" />
                  비상장
                </label>
              </div>
              <input type="text" placeholder={isUnlisted ? "기업명 직접 입력" : "기업명 검색 (예: 삼성)"} className={`w-full border p-3 rounded-lg outline-none focus:ring-2 ${isUnlisted ? 'bg-gray-50' : 'bg-white focus:ring-blue-500'}`} value={inputCompany} onChange={handleCompanyChange} onFocus={() => !isUnlisted && inputCompany && setShowDropdown(true)} />
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
              <input type="text" className="w-full border p-3 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={inputLocation} onChange={(e) => setInputLocation(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">참가 가능 인원</label>
              <select className="w-full border p-3 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)}>
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
              <textarea className="w-full border p-3 rounded-lg bg-white h-24 resize-none focus:ring-2 focus:ring-blue-500 outline-none" value={inputMemo} onChange={(e) => setInputMemo(e.target.value)} />
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