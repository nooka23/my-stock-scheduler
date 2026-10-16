'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { demoInstruments, reviewSections, type ReviewSection } from '@/lib/daily-review-demo';
import { koreanDate } from '@/lib/daily-review-market';
import NewsPanel from './news-panel';
import EconomicPanel from './economic-panel';
import MarketPanel from './market-panel';
import styles from './review.module.css';

type Draft = { notes: string; checked: ReviewSection[]; read: string[] };
const emptyDraft: Draft = { notes: '', checked: [], read: [] };


export default function DailyReview({ mobilePreview = false, initialDate }: { mobilePreview?: boolean; initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  return <ReviewDay key={date} date={date} setDate={setDate} mobilePreview={mobilePreview} />;
}

function ReviewDay({ date, setDate, mobilePreview }: { date: string; setDate: (date: string) => void; mobilePreview: boolean }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState('');
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState('news');
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `daily-review-demo:v1:${date}`;

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
            read: Array.isArray(value.read) ? value.read.filter(id => typeof id === 'string') : [],
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
        <div className={styles.dateControl}><label htmlFor="review-date">리뷰 날짜</label><input id="review-date" type="date" value={date} max={koreanDate()} onChange={e => { if (e.target.value && (saved !== '저장하지 않은 변경사항' || window.confirm('저장하지 않은 변경사항이 있습니다. 날짜를 바꾸시겠어요?'))) setDate(e.target.value); }} /><span>한국 시간 기준</span></div>
      </header>

      <div className={styles.demoNotice}><div><span className={styles.demoBadge}>KIS 일봉 연결</span><p>가격 차트는 공급원별 수집 일봉입니다. 리뷰 전일까지의 관측값을 표시합니다. 경제지표는 FRED·미국 재무부 저장값입니다. 뉴스는 ChatGPT가 직접 선별한 사건과 근거 링크입니다.</p></div></div>

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="리뷰 순서">
          <p className={styles.eyebrow}>REVIEW ROUTINE</p>
          <nav>{reviewSections.map(item => <button type="button" key={item.id} className={active === item.id ? styles.activeNav : ''} onClick={() => jump(item.id)}><span>{draft.checked.includes(item.id) ? '✓' : item.number}</span>{item.title}<i aria-hidden="true">↗</i></button>)}<button type="button" className={active === 'journal' ? styles.activeNav : ''} onClick={() => jump('journal')}><span>✎</span>나의 리뷰<i aria-hidden="true">↗</i></button></nav>
          <div className={styles.progress}><div><span>오늘의 확인</span><strong>{draft.checked.length}<small> / 5</small></strong></div><progress aria-label="리뷰 확인 진행률" max={5} value={draft.checked.length} /><p>읽고, 차트를 보고,<br />나의 언어로 남깁니다.</p></div>
          <Link href="/chart" className={styles.stockLink}><span>06 · 다음 단계</span><strong>대형주 차트 검토 ↗</strong><small>기업 분석 화면으로</small></Link>
        </aside>

        <main className={styles.main}>
          {section('news', <NewsPanel date={date} read={draft.read} ready={ready} onRead={id => update({ ...draft, read: draft.read.includes(id) ? draft.read.filter(item => item !== id) : [...draft.read, id] })} />)}

          {section('economy', <EconomicPanel date={date} />)}

          {section('macro', <MarketPanel instruments={demoInstruments.filter(item => ['금리', '환율', '원자재'].includes(item.group))} date={date} />)}
          {section('sentiment', <MarketPanel instruments={demoInstruments.filter(item => item.group === '위험 심리')} date={date} />)}
          {section('indices', <MarketPanel instruments={demoInstruments.filter(item => item.group === '지수')} date={date} />)}

          <Link href="/chart" className={styles.stockLink}><span>06 · 섹터와 종목</span><strong>대형주 차트 검토로 이어가기 ↗</strong><small>개별 종목은 기업 분석 화면에서 확인하세요.</small></Link>

          <section id="journal" className={`${styles.section} ${styles.journal}`} aria-labelledby="journal-heading"><div className={styles.sectionHeading}><div className={styles.sectionTitle}><span className={styles.sectionNumber}>✎</span><div><h2 id="journal-heading">오늘, 시장은 어떤 이야기를 했나요?</h2><p>사실과 나의 해석을 구분해서 기록해보세요.</p></div></div></div><div className={styles.journalPrompts}><span>어제와 달라진 점</span><span>서로 엇갈리는 신호</span><span>내 판단을 바꿀 조건</span></div><label className={styles.srOnly} htmlFor="review-notes">오늘의 리뷰 메모</label><textarea id="review-notes" disabled={!ready} value={draft.notes} onChange={e => update({ ...draft, notes: e.target.value })} placeholder="오늘 확인한 사실은…&#10;아직 판단하기 어려운 부분은…&#10;다음 리뷰에서 확인할 것은…" /><div className={styles.saveBar}><div><span role="status">{saved || '메모와 확인 표시는 저장 버튼을 눌러 보관하세요.'}</span><small>날짜별로 이 브라우저에만 저장됩니다.</small></div><button type="button" disabled={!ready} onClick={save}>리뷰 저장 <span>↗</span></button></div></section>
          <footer className={styles.footer}><span>관찰 → 해석 → 기록</span><span>DAILY REVIEW · PROTOTYPE</span></footer>
        </main>
      </div>
    </div>
  </div>;
}
