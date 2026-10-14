'use client';
import {useEffect,useState} from 'react';
import styles from './review.module.css';
type Source={id:string;title:string;source:string;region:string;url:string;published_at:string};
type Event={id:string;category:string;importance:string;title:string;summary:string;details?:string;reason:string;market_scope:string;confidence:string;sources:Source[]};
type Run={collection_status:string;review_status:string;candidate_count:number;reviewed_at:string;window_start:string;window_end:string;coverage:{name:string;status:string}[];events:Event[]};
export default function NewsPanel({date,read,ready,onRead}:{date:string;read:string[];ready:boolean;onRead:(id:string)=>void}){
 const [result,setResult]=useState<{date:string;run?:Run|null;error?:string}|null>(null);
 const [category,setCategory]=useState('전체');const [unread,setUnread]=useState(false);
 useEffect(()=>{const controller=new AbortController();fetch(`/api/daily-review/news?date=${date}`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}).then(data=>{if(!controller.signal.aborted)setResult({date,run:data.run});}).catch(e=>{if(!controller.signal.aborted)setResult({date,error:e.message});});return()=>controller.abort();},[date]);
 const current=result?.date===date?result:null;
 if(!current)return <div className={styles.empty} role="status">뉴스 리뷰를 불러오는 중입니다.</div>;
 if(current.error)return <div className={styles.empty} role="alert">{current.error}</div>;
 const run=current.run;
 if(!run)return <div className={styles.empty}><strong>이 날짜의 뉴스 수집 기록이 없습니다.</strong><p>수집·선별 결과가 저장되면 표시됩니다.</p></div>;
 const events=run.events.filter(e=>(category==='전체'||e.category===category)&&(!unread||!read.includes(e.id))).sort((a,b)=>(a.importance==='핵심'?0:1)-(b.importance==='핵심'?0:1));
 const format=(s:string)=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
 return <>
 <div className={styles.aiNote}><span>ChatGPT 직접 검토 · 후보 {run.candidate_count}건</span><p>수집 구간: {format(run.window_start)} ~ {format(run.window_end)}</p><small>{run.review_status==='REVIEWED'?`검토 완료 ${format(run.reviewed_at)}`:'요약·선별 검토 대기'} · 언론사 국가와 기사 시장 범위는 별도 분류입니다.</small></div>
 {run.collection_status!=='SUCCEEDED'&&<div className={styles.aiNote} role="status"><span>{run.collection_status==='FAILED'?'수집 실패':'부분 수집'}</span><p>{run.coverage.filter(s=>s.status!=='SUCCEEDED').map(s=>s.name).join(' / ')}</p><small>일부 소스의 조회 또는 발행 시각 데이터가 불완전합니다. 주요 뉴스가 없다는 의미는 아닙니다.</small></div>}
 {run.review_status==='PENDING'?<div className={styles.empty}><strong>후보 수집은 완료됐고 ChatGPT 검토를 기다리고 있습니다.</strong></div>:<>
 <div className={styles.filterBar}><div className={styles.filters}>{['전체','정책','기업·산업','경제'].map(label=><button type="button" key={label} aria-pressed={category===label} onClick={()=>setCategory(label)}>{label}</button>)}</div><label className={styles.checkLabel}><input type="checkbox" checked={unread} onChange={e=>setUnread(e.target.checked)}/>안 읽은 사건만</label></div>
 <div className={styles.newsList}>{events.map((item,index)=><article key={item.id} className={styles.newsItem}><div className={styles.newsIndex}>{String(index+1).padStart(2,'0')}</div><div className={styles.newsBody}><div className={styles.newsMeta}><span className={item.importance==='핵심'?styles.important:styles.regular}>{item.importance}</span><span>{item.category}</span><span>{item.market_scope}</span></div><h3>{item.title}</h3><p>{item.summary}</p><details><summary>선별 이유 · 근거 기사 보기 ＋</summary><div className={styles.newsDetails}>{item.details && <div className={styles.newsExplanation}><strong>사건 자세히 보기</strong>{item.details.split(/\n\s*\n/).map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>}<strong>선별 이유</strong><p>{item.reason}</p><small>{item.confidence}</small>{item.sources.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.source} · {s.title} ↗</a><br/><small>{s.published_at?format(s.published_at):'발행 시각 미확인'}{new URL(s.url).hostname==='news.google.com'?' · Google News 경유 링크':''}</small></p>)}</div></details></div><label className={styles.readCheck}><input type="checkbox" disabled={!ready} aria-label={`${item.title} 읽음`} checked={read.includes(item.id)} onChange={()=>onRead(item.id)}/><span>읽음</span></label></article>)}{!events.length&&<div className={styles.empty}>조건에 맞는 사건이 없습니다.</div>}</div><div className={styles.sectionFoot}>중요도 기준 통과 사건 · 개수 제한 없음<span>{events.length}개 표시 / 전체 {run.events.length}개</span></div>
 </>}
 </>;
}
