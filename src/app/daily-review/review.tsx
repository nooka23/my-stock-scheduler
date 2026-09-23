'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { demoCpi, demoInstruments, demoNews, reviewSections, type ReviewSection } from '@/lib/daily-review-demo';
import MarketPanel from './market-panel';
import styles from './review.module.css';

type Draft = { notes: string; checked: ReviewSection[]; read: string[] };
const emptyDraft: Draft = { notes: '', checked: [], read: [] };
const demoDates = ['2026-09-23', '2026-09-22'];

export default function DailyReview({ mobilePreview = false }: { mobilePreview?: boolean }) {
  const [date, setDate] = useState(demoDates[0]);
  return <ReviewDay key={date} date={date} setDate={setDate} mobilePreview={mobilePreview} />;
}

function ReviewDay({ date, setDate, mobilePreview }: { date: string; setDate: (date: string) => void; mobilePreview: boolean }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState('');
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState('전체');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [macroGroup, setMacroGroup] = useState('금리');
  const [scenario, setScenario] = useState(date === demoDates[0] ? 'normal' : 'empty');
  const [active, setActive] = useState('news');
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `daily-review-demo:v1:${date}`;
  const hasRelease = scenario !== 'empty';
  const news = demoNews.filter(item => (category === '전체' || item.category === category) && (!unreadOnly || !draft.read.includes(item.id)));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const value = parsed as Partial<Draft>;
          setDraft({
            notes: typeof value.notes === 'string' ? value.notes : '',
            checked: Array.isArray(value.checked) ? value.checked.filter(id => reviewSections.some(section => section.id === id)) : [],
            read: Array.isArray(value.read) ? value.read.filter(id => typeof id === 'string' && demoNews.some(item => item.id === id)) : [],
          });
        }
      }
    } catch { setSaved('저장된 메모를 불러오지 못했습니다.'); }
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    }, { root, rootMargin: '-5% 0px -65% 0px', threshold: 0 });
    root.querySelectorAll('section[id]').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  function update(next: Draft) { setDraft(next); setSaved('저장하지 않은 변경사항'); }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); setSaved('이 브라우저에 저장했습니다.'); }
    catch { setSaved('저장할 수 없습니다. 브라우저 저장 공간을 확인해주세요.'); }
  }
  function jump(id: string) {
    scrollRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  }
  function section(id: ReviewSection, children: ReactNode, extra?: ReactNode) {
    const info = reviewSections.find(item => item.id === id)!;
    return <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeading}>
        <div className={styles.sectionTitle}><span className={styles.sectionNumber}>{info.number}</span><div><h2 id={`${id}-heading`}>{info.title}</h2><p>{info.subtitle}</p></div>{extra}</div>
        <label className={styles.checkLabel}><input type="checkbox" disabled={!ready} checked={draft.checked.includes(id)} onChange={() => update({ ...draft, checked: draft.checked.includes(id) ? draft.checked.filter(item => item !== id) : [...draft.checked, id] })} />확인 완료</label>
      </div>
      {children}
    </section>;
  }

  return <div ref={scrollRef} className={`${styles.page} ${mobilePreview ? styles.mobilePreview : ''}`} lang="ko">
    <div className={styles.pageInner}>
      <div className={styles.viewSwitcher}><span>{mobilePreview ? '모바일 화면 · 최대 430px' : 'DAILY REVIEW'}</span><Link href={mobilePreview ? '/daily-review' : '/daily-review/mobile'}>{mobilePreview ? '기본 화면으로 ↗' : '모바일 버전 보기 ↗'}</Link></div>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>THE DAILY MARKET REVIEW</p><h1>시장을 읽는 시간<span>.</span></h1><p className={styles.intro}>사건에서 가격으로, 가격에서 나의 판단으로.</p></div>
        <div className={styles.dateControl}><label htmlFor="review-date">리뷰 날짜 · 예시</label><select id="review-date" value={date} onChange={e => { if (saved !== '저장하지 않은 변경사항' || window.confirm('저장하지 않은 변경사항이 있습니다. 날짜를 바꾸시겠어요?')) setDate(e.target.value); }}><option value={demoDates[0]}>2026. 09. 23 · 수요일</option><option value={demoDates[1]}>2026. 09. 22 · 화요일</option></select><span>한국 시간 기준</span></div>
      </header>

      <div className={styles.demoNotice}><div><span className={styles.demoBadge}>화면 미리보기</span><p>뉴스·수치·차트·AI 해석은 모두 예시입니다. 실제 시장 데이터는 아직 연결하지 않았습니다.</p></div><label>표시 상황<select aria-label="예시 표시 상황" value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">새 발표가 있는 날</option><option value="empty">새 발표가 없는 날</option><option value="delayed">가격 수집이 지연된 날</option></select></label></div>

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="리뷰 순서">
          <p className={styles.eyebrow}>REVIEW ROUTINE</p>
          <nav>{reviewSections.map(item => <button type="button" key={item.id} className={active === item.id ? styles.activeNav : ''} onClick={() => jump(item.id)}><span>{draft.checked.includes(item.id) ? '✓' : item.number}</span>{item.title}<i aria-hidden="true">↗</i></button>)}<button type="button" className={active === 'journal' ? styles.activeNav : ''} onClick={() => jump('journal')}><span>✎</span>나의 리뷰<i aria-hidden="true">↗</i></button></nav>
          <div className={styles.progress}><div><span>오늘의 확인</span><strong>{draft.checked.length}<small> / 5</small></strong></div><progress aria-label="리뷰 확인 진행률" max={5} value={draft.checked.length} /><p>읽고, 차트를 보고,<br />나의 언어로 남깁니다.</p></div>
          <Link href="/chart" className={styles.stockLink}><span>06 · 다음 단계</span><strong>대형주 차트 검토 ↗</strong><small>기업 분석 화면으로</small></Link>
        </aside>

        <main className={styles.main}>
          {section('news', <>
            <div className={styles.filterBar}><div className={styles.filters} aria-label="뉴스 분류">{['전체', '정책', '기업·산업', '경제'].map(label => <button type="button" key={label} aria-pressed={category === label} onClick={() => setCategory(label)}>{label}</button>)}</div><label className={styles.checkLabel}><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />안 읽은 사건만</label></div>
            <div className={styles.newsList}>{news.map((item, index) => <article key={item.id} className={styles.newsItem}>
              <div className={styles.newsIndex}>{String(index + 1).padStart(2, '0')}</div><div className={styles.newsBody}><div className={styles.newsMeta}><span className={item.importance === '핵심' ? styles.important : styles.regular}>{item.importance}</span><span>{item.category}</span><span>가상 사건</span></div><h3>{item.title}</h3><p>{item.summary}</p><details><summary>선별 이유 · 출처 구성 보기 <span>＋</span></summary><div className={styles.newsDetails}><strong>중요도 판단 예시</strong><p>{item.reason}</p><small>출처 연결 예정: {item.sources.join(' / ')}. 실제 기사 링크는 없는 화면 예시입니다.</small></div></details></div><label className={styles.readCheck}><input type="checkbox" aria-label={`${item.title} 읽음`} disabled={!ready} checked={draft.read.includes(item.id)} onChange={() => update({ ...draft, read: draft.read.includes(item.id) ? draft.read.filter(id => id !== item.id) : [...draft.read, item.id] })} /><span>읽음</span></label>
            </article>)}{news.length === 0 && <div className={styles.empty}><strong>조건에 맞는 사건이 없습니다.</strong><p>다른 분류를 선택하거나 ‘안 읽은 사건만’을 해제해보세요.</p></div>}</div>
            <div className={styles.sectionFoot}>중요도 기준을 통과한 사건 전체 · 개수 제한 없음<span>{news.length}개 표시 / 예시 {demoNews.length}개</span></div>
          </>, <span className={styles.countBadge}>{demoNews.length}</span>)}

          {section('economy', hasRelease ? <div className={styles.economyCard}>
            <div className={styles.releaseHeader}><div><span className={styles.newBadge}>새 발표 예시</span><h3>미국 소비자물가지수 <span>CPI</span></h3><p>대상 기간 2026년 8월 · 발표 시각 및 수치는 가상입니다</p></div><span className={styles.country}>US</span></div>
            <div className={styles.economyMetrics}>{[['헤드라인 YoY', '2.8%', '이전 2.9% · 비계절조정'], ['헤드라인 MoM', '0.2%', '이전 0.2% · 계절조정'], ['근원 YoY', '3.2%', '이전 3.3% · 비계절조정'], ['근원 MoM', '0.2%', '이전 0.3% · 계절조정']].map(([label, value, previous]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{previous}</small></div>)}</div>
            <div className={styles.economyChart}><div className={styles.chartCaption}><strong>물가 상승률 추이</strong><span><i />헤드라인 <i />근원 · YoY (%) · 예시</span></div><div className={styles.cpiChart}><ResponsiveContainer width="100%" height="100%"><LineChart data={demoCpi} margin={{ top: 10, right: 12, bottom: 0, left: -25 }}><CartesianGrid stroke="#e8eeec" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#71807b', fontSize: 11 }} /><YAxis domain={[2, 4]} axisLine={false} tickLine={false} tick={{ fill: '#71807b', fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="headline" name="헤드라인 YoY (예시)" stroke="#176958" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} /><Line type="monotone" dataKey="core" name="근원 YoY (예시)" stroke="#a08c5a" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></div>
            <div className={styles.aiNote}><span>AI 해석 예시</span><p>전년 대비 상승률은 헤드라인과 근원 모두 낮아졌습니다. 월간 변화와 함께 둔화가 이어지는지 확인할 필요가 있습니다. 예상치가 없어 시장 기대 대비 평가는 보류합니다.</p><small>아래 금리와 지수에서 가격 반응을 직접 확인하세요.</small></div>
          </div> : <div className={styles.empty}><span className={styles.emptyIcon}>—</span><strong>새로 발표된 경제지표가 없습니다.</strong><p>새 발표나 수정치가 들어온 날에 해당 지표의 추이와 해석이 표시됩니다.</p><small>발표 없음 상황을 보여주는 예시입니다.</small></div>, <span className={styles.countBadge}>{hasRelease ? '1 NEW' : '0 NEW'}</span>)}

          {section('macro', <><div className={styles.filters} aria-label="매크로 자산 분류">{['금리', '환율', '원자재'].map(group => <button type="button" key={group} aria-pressed={group === macroGroup} onClick={() => setMacroGroup(group)}>{group}</button>)}</div><MarketPanel key={`${macroGroup}-${scenario}`} instruments={demoInstruments.filter(item => item.group === macroGroup)} date={date} delayed={scenario === 'delayed'} /></>)}
          {section('sentiment', <MarketPanel instruments={demoInstruments.filter(item => item.group === '위험 심리')} date={date} delayed={scenario === 'delayed'} />)}
          {section('indices', <MarketPanel instruments={demoInstruments.filter(item => item.group === '지수')} date={date} delayed={scenario === 'delayed'} />)}

          <Link href="/chart" className={styles.stockLink}><span>06 · 섹터와 종목</span><strong>대형주 차트 검토로 이어가기 ↗</strong><small>개별 종목은 기업 분석 화면에서 확인하세요.</small></Link>

          <section id="journal" className={`${styles.section} ${styles.journal}`} aria-labelledby="journal-heading"><div className={styles.sectionHeading}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>✎</span><div><h2 id="journal-heading">오늘, 시장은 어떤 이야기를 했나요?</h2><p>사실과 나의 해석을 구분해서 기록해보세요.</p></div></div></div><div className={styles.journalPrompts}><span>어제와 달라진 점</span><span>서로 엇갈리는 신호</span><span>내 판단을 바꿀 조건</span></div><label className={styles.srOnly} htmlFor="review-notes">오늘의 리뷰 메모</label><textarea id="review-notes" disabled={!ready} value={draft.notes} onChange={e => update({ ...draft, notes: e.target.value })} placeholder="오늘 확인한 사실은…&#10;아직 판단하기 어려운 부분은…&#10;다음 리뷰에서 확인할 것은…" /><div className={styles.saveBar}><div><span role="status">{saved || '메모와 확인 표시는 저장 버튼을 눌러 보관하세요.'}</span><small>예시 날짜별로 이 브라우저에만 저장됩니다.</small></div><button type="button" disabled={!ready} onClick={save}>리뷰 저장 <span>↗</span></button></div></section>
          <footer className={styles.footer}><span>관찰 → 해석 → 기록</span><span>DAILY REVIEW · PROTOTYPE</span></footer>
        </main>
      </div>
    </div>
  </div>;
}
