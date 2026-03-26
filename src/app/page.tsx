'use client';

import { useState, useEffect, useCallback } from 'react';
import Calendar from 'react-calendar';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { User } from '@supabase/supabase-js';
import './calendar-style.css';

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

const getScheduleColorClass = (joined: boolean) =>
  joined
    ? 'border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100'
    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

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
    const combinedData = scheduleData.map((sch) => ({
      ...sch,
      participants: partData?.filter((p) => p.schedule_id === sch.id) || [],
    }));
    setSchedules(combinedData);
  }, [supabase]);

  const fetchMyProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('nickname, is_admin').eq('id', userId).single();
    if (data) setMyProfile(data as MyProfile);
  }, [supabase]);

  const fetchCompanies = useCallback(async () => {
    const { data, error } = await supabase.from('companies').select('*').order('name', { ascending: true }).range(0, 9999);
    if (!error && data) {
      setCompanyList(data as Company[]);
    }
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchSchedules();
        fetchMyProfile(session.user.id);
        fetchCompanies();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchSchedules();
        fetchMyProfile(session.user.id);
        fetchCompanies();
      } else {
        setSchedules([]);
        setMyProfile(null);
        setCompanyList([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchSchedules, fetchMyProfile, fetchCompanies]);

  const resetFormForNew = useCallback((date: Date | null) => {
    setEditingId(null);
    setSelectedDate(date);
    setRangeStart(date);
    setRangeEnd(date);
    setInputCompany('');
    setIsUnlisted(false);
    setFilteredCompanies([]);
    setShowDropdown(false);
    setStartAmPm('오전');
    setStartHour('10');
    setStartMin('00');
    setEndAmPm('오전');
    setEndHour('11');
    setEndMin('00');
    setInputLocation('');
    setMaxParticipants('1명');
    setInputMemo('');
    setAutoJoin(true);
  }, []);

  const populateFormForEdit = useCallback((schedule: Schedule) => {
    const targetDate = new Date(schedule.date_str);
    const targetEndDate = schedule.end_date ? new Date(schedule.end_date) : targetDate;
    setSelectedDate(targetDate);
    setEditingId(schedule.id);
    setRangeStart(targetDate);
    setRangeEnd(targetEndDate);
    setInputCompany(schedule.company);
    setIsUnlisted(schedule.is_unlisted);
    setFilteredCompanies([]);
    setShowDropdown(false);
    setInputLocation(schedule.location);
    setMaxParticipants(schedule.max_participants);
    setInputMemo(schedule.memo);

    const [sAmpm, sTime] = schedule.start_time.split(' ');
    const [sHr, sMin] = sTime.split(':');
    setStartAmPm(sAmpm);
    setStartHour(sHr);
    setStartMin(sMin);

    const [eAmpm, eTime] = schedule.end_time.split(' ');
    const [eHr, eMin] = eTime.split(':');
    setEndAmPm(eAmpm);
    setEndHour(eHr);
    setEndMin(eMin);
  }, []);

  const handleStartAmPmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setStartAmPm(val);
    setEndAmPm(val);
  };

  const handleStartHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setStartHour(val);
    let nextHour = parseInt(val, 10) + 1;
    if (nextHour > 12) nextHour = 1;
    setEndHour(nextHour.toString());
  };

  const handleDayClick = (value: Date) => {
    resetFormForNew(value);
    setIsPanelOpen(true);
  };

  const handleScheduleClick = (e: React.MouseEvent, schedule: Schedule) => {
    e.stopPropagation();
    populateFormForEdit(schedule);
    setIsPanelOpen(true);
  };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);
    if (!isUnlisted && value.trim() !== '') {
      const lowerValue = value.toLowerCase();
      const filtered = companyList.filter((comp) => comp.name.toLowerCase().includes(lowerValue) || comp.code.includes(value));
      setFilteredCompanies(filtered);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const selectCompany = (company: Company) => {
    setInputCompany(company.name);
    setShowDropdown(false);
  };

  const handleSave = async () => {
    if (!user || (!selectedDate && !rangeStart && !rangeEnd)) return;
    const isValidCompany = companyList.some((c) => c.name === inputCompany);
    if (!isUnlisted && !isValidCompany) {
      alert("목록에 있는 기업을 선택하거나, '비상장'을 체크해주세요.");
      return;
    }
    if (!inputCompany) {
      alert('기업명을 입력해주세요.');
      return;
    }

    const myName = myProfile?.nickname || user.email?.split('@')[0] || '익명';
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
      ...(rangeStartDate.getTime() !== rangeEndDate.getTime() ? { end_date: formatDateToKey(rangeEndDate) } : {}),
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
      if (error) {
        alert(`일정 저장 실패: ${error.message}`);
      } else if (newSchedules && newSchedules.length > 0 && autoJoin) {
        const newId = newSchedules[0].id;
        await supabase.from('participants').insert([{ schedule_id: newId, user_email: user.email, user_name: myName, user_id: user.id }]);
      }
    }

    await fetchSchedules();
    setIsPanelOpen(false);
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!user || !editingId) return;
    if (confirm('삭제하시겠습니까?')) {
      const { error } = await supabase.from('schedules').delete().eq('id', editingId);
      if (!error) {
        await fetchSchedules();
        setIsPanelOpen(false);
        setEditingId(null);
      }
    }
  };

  const handleToggleJoin = async () => {
    if (!editingId || !user) return;
    const target = schedules.find((s) => s.id === editingId);
    if (!target) return;

    const myParticipation = target.participants?.find((p) => p.user_id === user.id);
    const myName = myProfile?.nickname || user.email?.split('@')[0] || '익명';

    if (myParticipation) {
      if (confirm('참가를 취소하시겠습니까?')) {
        const { error } = await supabase.from('participants').delete().eq('id', myParticipation.id);
        if (!error) {
          alert('취소되었습니다.');
          await fetchSchedules();
        }
      }
    } else {
      const maxNum = target.max_participants === '참석불가' ? 0 : target.max_participants === '5명 이상' ? 99 : parseInt(target.max_participants.replace('명', ''), 10);
      const currentCount = target.participants?.length || 0;
      if (currentCount >= maxNum) {
        alert('모집 인원이 꽉 찼습니다!');
        return;
      }
      const { error } = await supabase.from('participants').insert([{ schedule_id: editingId, user_email: user.email, user_name: myName, user_id: user.id }]);
      if (!error) {
        alert('참가 신청 완료!');
        await fetchSchedules();
      }
    }
  };

  const editingSchedule = editingId ? schedules.find((s) => s.id === editingId) ?? null : null;
  const isJoined = !!(editingSchedule && user && editingSchedule.participants?.some((p) => p.user_id === user.id));
  const canDelete = !!(editingSchedule && user && (myProfile?.is_admin || editingSchedule.author_email === user.email));
  const participantCount = editingSchedule?.participants?.length || 0;

  return (
    <main className="flex h-full flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-8 lg:py-6">
        <section className="app-card-strong flex min-h-[calc(100vh-2rem)] flex-1 flex-col p-4 lg:min-h-[calc(100vh-3rem)] lg:p-6">
          <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-950 lg:text-4xl">기업 탐방 캘린더</h1>
              <p className="mt-2 text-base font-medium text-[var(--text-muted)]">
                날짜를 클릭해 등록하고, 일정 배지를 클릭해 상세 편집으로 이동합니다.
              </p>
            </div>
            <button
              onClick={() => {
                resetFormForNew(new Date());
                setIsPanelOpen(true);
              }}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              새 일정 추가
            </button>
          </div>

          <div className="min-h-0 flex-1 rounded-[20px] bg-[var(--surface-muted)] p-3 lg:p-4">
            <Calendar
              locale="ko-KR"
              calendarType="gregory"
              formatDay={(_locale, date) => date.getDate().toString()}
              onClickDay={handleDayClick}
              tileContent={({ date, view }) => {
                if (view !== 'month') return null;
                const dayKey = formatDateToKey(date);

                const daysSchedules = schedules
                  .filter((s) => {
                    const { startKey, endKey } = getScheduleRangeKeys(s);
                    return dayKey >= startKey && dayKey <= endKey;
                  })
                  .sort((a, b) => getTimeValue(a.start_time) - getTimeValue(b.start_time));

                return (
                  <div className="tile-content-container flex flex-col gap-1.5">
                    {daysSchedules.map((schedule) => {
                      const count = schedule.participants?.length || 0;
                      const max = schedule.max_participants.replace('명', '');
                      const amIJoined = schedule.participants?.some((p) => p.user_id === user?.id);
                      const barColor = getScheduleColorClass(!!amIJoined);
                      const capacityLimit =
                        schedule.max_participants === '참석불가'
                          ? 0
                          : schedule.max_participants === '5명 이상'
                            ? 99
                            : parseInt(schedule.max_participants.replace('명', ''), 10);
                      const isFull = count >= capacityLimit;
                      const countColor = amIJoined
                        ? 'border border-amber-200 bg-white text-amber-700'
                        : isFull
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200';

                      return (
                        <div
                          key={schedule.id}
                          onClick={(e) => handleScheduleClick(e, schedule)}
                          className={`schedule-bar flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${barColor}`}
                        >
                          <span className="shrink-0 font-bold text-[11px] text-[var(--text-muted)]">
                            {schedule.start_time.split(' ')[1]}
                          </span>
                          <span className="truncate">{schedule.company}</span>
                          <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-bold ${countColor}`}>
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
        </section>
      </div>

      {isPanelOpen && (
        <aside className="fixed inset-0 z-20 flex bg-slate-950/20 lg:absolute lg:left-auto lg:w-[460px] lg:bg-transparent">
          <div className="ml-auto flex h-full w-full max-w-[460px] flex-col border-l border-[var(--border)] bg-[rgba(255,255,255,0.97)] p-5 shadow-2xl backdrop-blur-sm lg:p-7">
            <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">
                  {editingId ? 'Schedule Detail' : 'New Schedule'}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">{editingId ? '일정 상세' : '새 일정 등록'}</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{getRangeLabel(rangeStart, rangeEnd) || '날짜를 지정하세요.'}</p>
              </div>
              <button
                onClick={() => setIsPanelOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-slate-900"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto py-5">
              {editingSchedule && (
                <section className="app-card rounded-2xl p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">참가 현황</p>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">
                          현재 {participantCount}명 참여 중, 정원은 {maxParticipants}
                        </p>
                      </div>
                      <button
                        onClick={handleToggleJoin}
                        className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors ${isJoined ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-slate-950 text-white hover:bg-slate-800'}`}
                      >
                        {isJoined ? '불참하기' : '참가하기'}
                      </button>
                    </div>

                    <div className="rounded-2xl bg-[var(--surface-muted)] p-3">
                      <p className="text-sm text-slate-900">
                        작성자 <span className="font-medium">{editingSchedule.author_name || editingSchedule.author_email}</span>
                      </p>
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
                          Participants
                        </p>
                        <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
                          {editingSchedule.participants?.map((p) => (
                            <li key={p.id}>
                              {p.user_name || p.user_email}
                              {p.user_email === user?.email ? ' (나)' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">시작 날짜</label>
                  <input
                    type="date"
                    className="app-input"
                    value={formatDateInput(rangeStart)}
                    onChange={(e) => setRangeStart(parseDateInput(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">종료 날짜</label>
                  <input
                    type="date"
                    className="app-input"
                    value={formatDateInput(rangeEnd)}
                    onChange={(e) => setRangeEnd(parseDateInput(e.target.value))}
                  />
                </div>
              </div>

              {!editingId && (
                <p className="text-xs text-[var(--text-muted)]">
                  하루 일정은 시작 날짜와 종료 날짜를 동일하게 두면 됩니다.
                </p>
              )}

              <div className="relative">
                <label className="mb-2 block text-sm font-medium text-slate-800">기업명</label>
                <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={isUnlisted}
                    onChange={(e) => {
                      setIsUnlisted(e.target.checked);
                      setShowDropdown(false);
                    }}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  비상장 기업 직접 입력
                </label>
                <input
                  type="text"
                  placeholder={isUnlisted ? '기업명 직접 입력' : '기업명 검색 (예: 삼성 or 005930)'}
                  className="app-input"
                  value={inputCompany}
                  onChange={handleCompanyChange}
                />
                {showDropdown && filteredCompanies.length > 0 && (
                  <ul className="absolute z-10 mt-2 max-h-48 w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-1 shadow-[var(--shadow-md)]">
                    {filteredCompanies.map((comp) => (
                      <li
                        key={comp.code}
                        onClick={() => selectCompany(comp)}
                        className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-[var(--surface-muted)]"
                      >
                        <span>{comp.name}</span>
                        <span className="ml-3 text-xs text-[var(--text-subtle)]">{comp.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">시작 시간</label>
                  <div className="flex gap-2">
                    <select className="app-input" value={startAmPm} onChange={handleStartAmPmChange}>
                      <option>오전</option>
                      <option>오후</option>
                    </select>
                    <select className="app-input" value={startHour} onChange={handleStartHourChange}>
                      {hours.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                    <select className="app-input" value={startMin} onChange={(e) => setStartMin(e.target.value)}>
                      {minutes.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-800">종료 시간</label>
                  <div className="flex gap-2">
                    <select className="app-input" value={endAmPm} onChange={(e) => setEndAmPm(e.target.value)}>
                      <option>오전</option>
                      <option>오후</option>
                    </select>
                    <select className="app-input" value={endHour} onChange={(e) => setEndHour(e.target.value)}>
                      {hours.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                    <select className="app-input" value={endMin} onChange={(e) => setEndMin(e.target.value)}>
                      {minutes.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">장소</label>
                <input type="text" className="app-input" value={inputLocation} onChange={(e) => setInputLocation(e.target.value)} />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">참가 가능 인원</label>
                <select className="app-input" value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)}>
                  <option value="참석불가">참석 불가</option>
                  <option value="1명">1명</option>
                  <option value="2명">2명</option>
                  <option value="3명">3명</option>
                  <option value="4명">4명</option>
                  <option value="5명 이상">5명 이상</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">비고</label>
                <textarea className="app-input min-h-28 resize-none" value={inputMemo} onChange={(e) => setInputMemo(e.target.value)} />
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              {!editingId && (
                <>
                  <label className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      id="autoJoin"
                      checked={autoJoin}
                      onChange={(e) => setAutoJoin(e.target.checked)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    새 일정 저장 시 자동으로 참석 처리
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsPanelOpen(false)}
                      className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)]"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex-[1.4] rounded-2xl bg-slate-950 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                    >
                      일정 저장
                    </button>
                  </div>
                </>
              )}

              {editingId && canDelete && (
                <div className="flex gap-3">
                  <button
                    onClick={handleDelete}
                    className="flex-1 rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                  >
                    삭제
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex-[1.4] rounded-2xl bg-slate-950 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    수정 완료
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </main>
  );
}
