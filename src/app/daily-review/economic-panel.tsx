'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './review.module.css';
const Chart=dynamic(()=>import('@/components/IndexLineChart'),{ssr:false});
type Item={code:string;name:string;group:string;frequency:string;unit:string;transform:string;last_checked_at:string|null;last_error:string|null;source_url:string;rows:{time:string;value:number}[]};
type Change={series_code:string;observation_date:string;old_value:number|null;new_value:number;kind:string;detected_at:string};
type Data={items:Item[];changes:Change[]};
const groups=['물가','고용','소비·생산','주택','경기·심리','금리','신용·유동성','시장 보조'];
const freq:Record<string,string>={daily:'일간',weekly:'주간',monthly:'월간',quarterly:'분기'};
export default function EconomicPanel({date}:{date:string}) {
 const [result,setResult]=useState<{date:string;data?:Data;error?:string}|null>(null);
 const [group,setGroup]=useState('물가');const [selected,setSelected]=useState('CPIAUCSL');
 useEffect(()=>{const controller=new AbortController();fetch(`/api/daily-review/economy?date=${date}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d as Data;}).then(data=>{if(!controller.signal.aborted)setResult({date,data});}).catch(e=>{if(!controller.signal.aborted)setResult({date,error:e.message});});return()=>controller.abort();},[date]);
 const data=result?.date===date?result.data:undefined;
 const error=result?.date===date?result.error:undefined;
 if(!data)return <div className={styles.empty} role="status">{error??'FRED 경제지표를 불러오는 중입니다.'}</div>;
 const list=data.items.filter(i=>i.group===group);const item=list.find(i=>i.code===selected)??list[0];
 const latest=item?.rows.at(-1),previous=item?.rows.at(-2);
 const pct=(a:number,b:number)=>b!==0?(a/b-1)*100:null;
 const format=(n:number)=>n.toLocaleString('ko-KR',{maximumFractionDigits:3});
 let yoy:number|null=null;
 if(latest){const year=new Date(`${latest.time}T00:00:00Z`);year.setUTCFullYear(year.getUTCFullYear()-1);const prior=item.rows.find(r=>r.time===year.toISOString().slice(0,10));if(prior)yoy=pct(latest.value,prior.value);}
 const change=latest&&previous?pct(latest.value,previous.value):null;
 const annualized=latest&&previous&&previous.value!==0?((latest.value/previous.value)**4-1)*100:null;
 return <>
 <div className={styles.aiNote}><span>FRED 수집 결과 · {data.items.length}종</span><p>{data.changes.length?`${date}에 새 관측값·수정 ${data.changes.length}건을 감지했습니다.`:'선택한 날에 감지된 새 관측값·수정이 없습니다. 아래에서 최신 저장 이력을 확인할 수 있습니다.'}</p><small>처음 저장한 이력은 기준선입니다. 감지일은 원기관 발표일과 다를 수 있습니다. 과거 차트에는 현재 저장된 수정값이 반영됩니다.</small></div>
 {data.changes.length>0&&<details><summary>새 관측값·수정 내역</summary>{data.changes.map((c,i)=><p key={i}>{data.items.find(item=>item.code===c.series_code)?.name??c.series_code} · {c.observation_date} · {c.kind==='revision'?'수정':'신규'}: {c.old_value===null?'—':format(Number(c.old_value))} → {format(Number(c.new_value))}</p>)}</details>}
 <div className={styles.filters} aria-label="경제지표 분류">{groups.map(g=><button type="button" key={g} aria-pressed={group===g} onClick={()=>setGroup(g)}>{g}</button>)}</div>
 <div className={styles.marketPanel}><div className={styles.instrumentList}>{list.map(i=><button type="button" key={i.code} aria-pressed={item?.code===i.code} onClick={()=>setSelected(i.code)}><span>{i.name}</span><small>{i.code}</small></button>)}</div>
 {item&&<div className={styles.chartPanel}><div className={styles.chartHeader}><div><span className={styles.eyebrow}>{item.code} · {freq[item.frequency]}</span><h3>{item.name}</h3></div><a href={item.source_url} target="_blank" rel="noreferrer">FRED 원자료 ↗</a></div>
 {latest?<><div className={styles.priceRow}><strong>{format(latest.value)}</strong><span>{item.unit}</span></div>
 {item.frequency==='monthly'&&item.unit!=='%'&&change!==null&&<p>MoM {change.toFixed(2)}%{yoy!==null?` · YoY ${yoy.toFixed(2)}%`:''}</p>}
 {item.unit==='%'&&latest&&previous&&<p>직전 관측 대비 {(latest.value-previous.value).toFixed(3)}%p</p>}
 {item.transform==='gdp'&&annualized!==null&&<p>전분기 대비 연율 {annualized.toFixed(2)}%</p>}
 {item.code==='PAYEMS'&&previous&&<p>전월 대비 {format(latest.value-previous.value)}천 명</p>}
 <div className={styles.chart}><Chart data={item.rows} wmaPeriod={1} pricePrecision={3}/></div><div className={styles.chartFoot}><span>관측 기간 {latest.time}</span><span>최근 {item.rows.length}개 관측</span></div></>:<div className={styles.empty}>저장된 관측값이 없습니다.</div>}
 <p className={styles.chartFoot}>{item.last_error?'최근 수집 실패 · 이전 저장값 표시':`마지막 수집 확인: ${item.last_checked_at?new Date(item.last_checked_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미수집'}`}</p>
 <small>예상치·발표 즉시 반영은 미지원. 물가 MoM은 계절조정, 통상 발표 YoY는 비계절조정 계열을 선택하세요. 자동 AI 해석은 아직 연결하지 않았습니다.</small></div>}
 </div></>;
}
