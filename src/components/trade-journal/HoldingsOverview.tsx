'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { createClientComponentClient } from '@/lib/supabase-browser';

type Holding = { market: string; symbol: string; name: string; currency: string; valuation: string; unrealized_pnl: string };
type CashBalance = { currency: string; cash: string };
type Sector = { market: string; symbol: string; sector: string };
const keyOf = (p: { market: string; symbol: string }) => `${p.market}:${p.symbol}`;
const fmt = (n: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(n);
const colors = ['#187f77', '#dc9051', '#587ba2', '#b56c7b', '#839956', '#73669d', '#4f9ab0', '#a28b68'];
const colorOf = (s: string) => s === '미분류' ? '#94a3b8' : colors[Array.from(s).reduce((n,c) => (n*31+c.charCodeAt(0))>>>0,0)%colors.length];
const suggestions = ['반도체', '소프트웨어', '인터넷', '자동차', '바이오·헬스케어', '금융', '에너지', '산업재', '소비재', '통신', '유틸리티', 'ETF'];

export default function HoldingsOverview({ userId, holdings, cashBalances }: { userId: string | null; holdings: Holding[]; cashBalances: CashBalance[] }) {
  const db = useMemo(() => createClientComponentClient(), []);
  const [sectors, setSectors] = useState<Record<string,string>>({});
  const [draft, setDraft] = useState<Record<string,string>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<'currency' | 'combined'>('currency');
  const [rateInput, setRateInput] = useState('');
  const [savedRate, setSavedRate] = useState<string | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState('');
  const parsedRate = Number(rateInput);
  const validRate = /^\d+(?:\.\d{1,4})?$/.test(rateInput) && parsedRate > 0 && parsedRate <= 100000;

  const unique = useMemo(() => Array.from(new Map(holdings.map(p => [keyOf(p),p])).values()).sort((a,b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name)),[holdings]);
  useEffect(() => {
    let alive = true;
    setReady(false); setSectors({}); setEditing(false); setError(''); setNotice(''); setRateInput(''); setSavedRate(null); setRateError('');
    if (!userId) return () => { alive=false; };
    void (async () => {
      try {
        const result = await db.from('trade_journal_sectors').select('market,symbol,sector').eq('user_id', userId);
        if (result.error) throw new Error('업종 정보를 불러오지 못했습니다.');
        const settings = await db.from('trade_journal_display_settings').select('usd_krw').eq('user_id',userId).maybeSingle();
        if (alive && settings.error) setRateError('저장된 환율을 불러오지 못했습니다. 다시 조회해 주세요.');
        if (alive && settings.data) { const rate=String(settings.data.usd_krw); setRateInput(rate); setSavedRate(rate); }
        if (alive) { setSectors(Object.fromEntries(((result.data ?? []) as Sector[]).map(p => [keyOf(p),p.sector]))); setReady(true); }
      } catch { if (alive) setError('업종 정보를 불러오지 못했습니다. 다시 조회해 주세요.'); }
    })();
    return () => { alive=false; };
  }, [db,userId,revision]);

  async function save() {
    if (!userId || saving) return;
    const changes = unique.filter(p => (draft[keyOf(p)] ?? '').trim() !== (sectors[keyOf(p)] ?? ''));
    if (!changes.length) { setEditing(false); return; }
    setSaving(true); setError('');
    try {
      const rows=changes.map(p => ({user_id:userId,market:p.market,symbol:p.symbol,sector:(draft[keyOf(p)] ?? '').trim(),updated_at:new Date().toISOString()}));
      const result=await db.from('trade_journal_sectors').upsert(rows,{onConflict:'user_id,market,symbol'}).select('market,symbol,sector');
      if (result.error || result.data?.length !== rows.length) throw new Error('save failed');
      setSectors(previous => ({...previous,...Object.fromEntries((result.data as Sector[]).map(p => [keyOf(p),p.sector]))}));
      setEditing(false); setNotice(`${changes.length}개 종목의 업종을 저장했습니다.`);
    } catch { setError('업종을 저장하지 못했습니다. 입력은 유지됩니다. 다시 저장해 주세요.'); }
    finally { setSaving(false); }
  }

  async function saveRate() {
    if (!userId || !validRate || rateSaving) return;
    setRateSaving(true); setRateError('');
    try {
      const result=await db.from('trade_journal_display_settings').upsert({user_id:userId,usd_krw:rateInput,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('usd_krw').single();
      if (result.error || !result.data) throw new Error('save failed');
      const rate=String(result.data.usd_krw); setSavedRate(rate); setRateInput(rate); setNotice('환율을 저장했습니다.');
    } catch { setRateError('환율을 저장하지 못했습니다. 입력은 유지됩니다.'); }
    finally { setRateSaving(false); }
  }

  const unclassified=unique.filter(p => !sectors[keyOf(p)]).length;
  const combined = view === 'combined';
  const supported = [...holdings,...cashBalances].every(p => p.currency === 'KRW' || p.currency === 'USD');
  const combinedCash = cashBalances.reduce((n,c)=>n+Number(c.cash)*(c.currency==='USD' ? parsedRate : 1),0);
  const displayHoldings = combined && validRate && supported ? holdings.map(p => ({...p,currency:'KRW',valuation:String(Number(p.valuation)*(p.currency==='USD' ? parsedRate : 1)),unrealized_pnl:String(Number(p.unrealized_pnl)*(p.currency==='USD' ? parsedRate : 1))})) : holdings;
  const currencies=combined && (holdings.length || cashBalances.length) ? ['KRW'] : Array.from(new Set(displayHoldings.map(p => p.currency))).sort();
  return <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="업종별 보유 비중">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div><h2 className="text-lg font-semibold">업종별 비중</h2><p className="mt-1 text-xs text-slate-500">{combined ? '보유종목 평가금액 + 예수금 · 입력 환율로 원화 환산' : '보유종목 평가금액 기준 · 현금 제외 · 통화별로 계산'}</p></div>
      <button disabled={!ready || !unique.length || saving} onClick={() => { setDraft({...sectors}); setEditing(true); setNotice(''); }} className="rounded-md bg-[#142a30] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">업종 입력·수정{ready && unclassified>0 ? ` · 미분류 ${unclassified}` : ''}</button>
    </div>
    <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
      <div className="flex rounded-md border border-slate-200 bg-white p-1" role="group" aria-label="비중 표시 방식">{([['currency','통화별'],['combined','국내·미국 통합']] as const).map(([value,label])=><button key={value} aria-pressed={view===value} onClick={()=>setView(value)} className={`rounded px-3 py-1.5 text-sm ${view===value ? 'bg-[#142a30] text-white' : 'text-slate-600'}`}>{label}</button>)}</div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void saveRate();}}>
        <label className="grid gap-1 text-xs text-slate-600">USD/KRW · 1달러당 원화<input aria-label="USD/KRW 환율" inputMode="decimal" value={rateInput} disabled={!ready || rateSaving} onChange={e=>setRateInput(e.target.value.trim())} placeholder="환율 입력" className="w-36 rounded border border-slate-300 bg-white px-3 py-2 text-sm"/></label>
        <button disabled={!ready || !validRate || rateSaving} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40">{rateSaving ? '저장 중…' : '환율 저장'}</button>
      </form>
      <p className="text-xs text-slate-500">{validRate ? `1 USD = ${parsedRate.toLocaleString('ko-KR',{maximumFractionDigits:4})} KRW · ${savedRate !== null && Number(savedRate)===parsedRate ? '저장된 환율' : '미저장 미리보기'}` : '양수 환율을 소수점 4자리까지 입력하세요.'}</p>
    </div>
    {rateError && <p role="alert" className="px-5 pt-3 text-sm text-amber-800">{rateError}<button className="ml-2 underline" onClick={()=>setRevision(r=>r+1)}>다시 조회</button></p>}
    {ready && combined && (!validRate || !supported) && <p className="px-5 py-10 text-sm text-slate-600">{!supported ? '현재 통합 보기는 원화와 달러 자산을 지원합니다.' : '환율을 입력하면 국내·미국 보유종목과 현금을 합한 자산 비중을 원화로 표시합니다.'}</p>}
    {error && <div role="alert" className="m-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}{!ready && <button onClick={() => setRevision(r=>r+1)} className="ml-3 underline">다시 조회</button>}</div>}
    {notice && <p role="status" className="px-5 pt-3 text-sm text-teal-800">{notice}</p>}
    {ready && (!combined || (validRate && supported)) && <div className={`grid divide-y divide-slate-100 ${combined ? '' : 'lg:grid-cols-2 lg:divide-x lg:divide-y-0'}`}>{currencies.map(cur => {
      const positions=displayHoldings.filter(p => p.currency===cur);
      const groups=new Map<string,{value:number;pnl:number;names:Set<string>}>();
      positions.forEach(p => {
        const sector=sectors[keyOf(p)] || '미분류'; const g=groups.get(sector) ?? {value:0,pnl:0,names:new Set<string>()};
        g.value+=Number(p.valuation); g.pnl+=Number(p.unrealized_pnl); g.names.add(p.name); groups.set(sector,g);
      });
      const stockTotal=positions.reduce((n,p)=>n+Number(p.valuation),0);
      const cashTotal=combined ? combinedCash : 0;
      const total=stockTotal+cashTotal;
      const entries=Array.from(groups,([sector,g])=>({sector,...g,isCash:false}));
      if (combined && cashBalances.length) entries.push({sector:'현금',value:cashTotal,pnl:0,isCash:true,names:new Set(cashBalances.map(c=>`${fmt(Number(c.cash))} ${c.currency}`))});
      const data=entries.map(g=>({...g,percentage:total>0 ? g.value/total*100 : 0})).sort((a,b)=>b.value-a.value);
      const chartable=total>0 && data.every(g=>Number.isFinite(g.value) && g.value>=0);
      return <article key={cur} className="p-5">
        <div className="flex items-baseline justify-between gap-3"><span className="text-xs font-semibold tracking-widest text-slate-500">{combined ? '국내·미국 통합 자산' : `${cur} 보유자산`}</span><span className="font-mono text-xl font-semibold tabular-nums">{fmt(total)} <span className="text-xs font-normal text-slate-500">{cur}</span></span></div>
        {combined && <p className="mt-2 text-xs text-slate-500">보유종목 {fmt(stockTotal)}원 + 현금 {fmt(cashTotal)}원 · 현금은 현재 예수금 기준</p>}
        <div className="grid items-center gap-3 sm:grid-cols-[180px_1fr]">
          <div className="relative h-[210px]" role="img" aria-label={`${cur} 업종별 비중. 상세 목록에서 금액과 비중을 확인할 수 있습니다.`}>
            {chartable ? <><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="sector" innerRadius={57} outerRadius={82} paddingAngle={2} stroke="none" isAnimationActive={false}>{data.map(g=><Cell key={`${g.isCash ? 'cash' : 'sector'}:${g.sector}`} fill={g.isCash ? '#405a60' : colorOf(g.sector)}/>)}</Pie><Tooltip formatter={(value)=>`${fmt(Number(value))} ${cur}`}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-2xl font-semibold">{positions.length}</strong><span className="text-xs text-slate-500">보유 포지션</span></div></> : <p className="pt-20 text-center text-xs text-slate-500">비중을 계산할 수 없습니다.</p>}
          </div>
          <ul className="space-y-3">{data.map(g=><li key={`${g.isCash ? 'cash' : 'sector'}:${g.sector}`}><div className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-medium"><i className="h-2.5 w-2.5 rounded-full" style={{background:g.isCash ? '#405a60' : colorOf(g.sector)}}/>{g.sector}</span><span className="font-mono font-semibold">{chartable ? `${g.percentage.toFixed(1)}%` : '—'}</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{background:g.isCash ? '#405a60' : colorOf(g.sector),width:`${chartable ? g.percentage : 0}%`}}/></div><p className="mt-1 text-xs text-slate-500">{fmt(g.value)} {cur} · {Array.from(g.names).join(', ')}</p></li>)}</ul>
        </div>
      </article>;
    })}</div>}
    {!ready && !error && <p className="px-5 py-10 text-sm text-slate-500">업종 정보를 조회 중입니다.</p>}
    {ready && !holdings.length && (!combined || !cashBalances.length) && <p className="px-5 py-10 text-sm text-slate-500">선택한 계좌·시장의 보유종목이 없습니다.</p>}
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="sector-title"><form onSubmit={e=>{e.preventDefault();void save();}} className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl">
      <div className="border-b p-5"><h2 id="sector-title" className="text-lg font-semibold">보유종목 업종 입력</h2><p className="mt-1 text-xs text-slate-500">업종명을 직접 입력하세요. 빈칸으로 저장하면 미분류로 돌아갑니다. 잔고가 갱신돼도 유지됩니다.</p></div>
      <div className="overflow-y-auto px-5 py-2"><datalist id="journal-sector-options">{Array.from(new Set([...suggestions,...Object.values(sectors).filter(Boolean)])).sort().map(s=><option key={s} value={s}/>)}</datalist>{unique.map(p=><label key={keyOf(p)} className="grid items-center gap-2 border-b border-slate-100 py-3 sm:grid-cols-2"><span className="text-sm font-medium">{p.name}<span className="mt-1 block font-mono text-xs font-normal text-slate-500">{p.symbol} · {p.market}</span></span><input autoFocus={p===unique[0]} list="journal-sector-options" aria-label={`${p.name} 업종`} maxLength={60} disabled={saving} value={draft[keyOf(p)] ?? ''} onChange={e=>setDraft(d=>({...d,[keyOf(p)]:e.target.value}))} placeholder="예: 반도체" className="min-w-0 rounded border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700"/></label>)}</div>
      <div className="border-t p-5">{error && <p role="alert" className="mb-3 text-sm text-amber-800">{error}</p>}<div className="flex justify-end gap-3"><button type="button" disabled={saving} onClick={()=>setEditing(false)} className="rounded border border-slate-300 px-4 py-2 text-sm">취소</button><button disabled={saving} className="rounded bg-[#142a30] px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button></div></div>
    </form></div>}
  </section>;
}
