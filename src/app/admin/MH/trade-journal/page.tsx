'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@/lib/supabase-browser';
import HoldingsOverview from '@/components/trade-journal/HoldingsOverview';

type Account = { id: string; alias: string; label: string };
type Trade = {
  id: string; account_id: string; market: string; symbol: string; name: string;
  currency: string; side: 'BUY' | 'SELL'; quantity: string | number; price: string | number;
  gross_amount: string | number; fee: string | number | null; tax: string | number | null;
  status: string; executed_at: string; trade_date: string;
};
type Balance = {
  id: string; account_id: string; currency: string; observed_at: string;
  cash: string | number; withdrawable: string | number | null; buying_power: string | number | null;
  settlements: { date: string; amount: string | number }[];
};
type CashEvent = { id: string; account_id: string; currency: string; occurred_at: string; kind: string; amount: string | number; description: string };
type Position = { position_key: string; market: string; symbol: string; name: string; currency: string; category: string; quantity: string; average_price: string; current_price: string; valuation: string; unrealized_pnl: string; unsettled_quantity: string | null };
type Snapshot = { id: string; account_id: string; observed_at: string; positions: Position[]; cash: { currency: string; cash: string; withdrawable: string; buying_power: string | null; d1_cash?: string; d2_cash?: string }[] };

const ACCOUNTS = [
  { alias: 'namuh-general', label: '나무 일반/CMA' },
  { alias: 'namuh-isa', label: '나무 ISA' },
  { alias: 'kiwoom-main', label: '키움' },
];
const PAGE_SIZE = 100;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
// Display formatting only. Calculations/ingestion use Decimal and PostgreSQL numeric.
const amount = (value: string | number | null) => value === null ? '미확정' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 }).format(Number(value));
const kindLabels: Record<string, string> = { DEPOSIT: '입금', WITHDRAWAL: '출금', SETTLEMENT: '매매 결제', FX: '환전', DIVIDEND: '배당', INTEREST: '이자', FEE: '수수료', TAX: '세금', OTHER: '기타' };

export default function TradeJournalPage() {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [date, setDate] = useState(today);
  const [alias, setAlias] = useState('all');
  const [market, setMarket] = useState('all');
  const [page, setPage] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<Balance[]>([]);
  const [cash, setCash] = useState<CashEvent[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Trade | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('로그인 후 매매일지를 확인할 수 있습니다.');
      const accountResult = await supabase.from('trade_journal_accounts').select('id,alias,label').eq('user_id', user.id);
      if (accountResult.error) throw new Error('매매일지 저장소를 준비 중입니다. DB 마이그레이션과 계좌 연결 후 데이터가 표시됩니다.');
      const accountRows = (accountResult.data ?? []) as Account[];
      const selected = accountRows.find(a => a.alias === alias);
      let tradeQuery = supabase.from('trade_journal_executions').select('*', { count: 'exact' }).eq('user_id', user.id).eq('trade_date', date);
      if (alias !== 'all') tradeQuery = tradeQuery.eq('account_id', selected?.id ?? '00000000-0000-0000-0000-000000000000');
      if (market !== 'all') tradeQuery = tradeQuery.eq('market', market);
      const start = `${date}T00:00:00+09:00`;
      const end = new Date(new Date(start).getTime() + 86400000).toISOString();
      let historyQuery = supabase.from('trade_journal_balances').select('*').eq('user_id', user.id).gte('observed_at', start).lt('observed_at', end);
      let cashQuery = supabase.from('trade_journal_cash_events').select('*').eq('user_id', user.id).gte('occurred_at', start).lt('occurred_at', end);
      if (alias !== 'all') {
        const accountId = selected?.id ?? '00000000-0000-0000-0000-000000000000';
        historyQuery = historyQuery.eq('account_id', accountId);
        cashQuery = cashQuery.eq('account_id', accountId);
      }
      const results = await Promise.all([
        tradeQuery.order('executed_at', { ascending: false }).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
        supabase.from('trade_journal_latest_balances').select('*').eq('user_id', user.id),
        historyQuery.order('observed_at', { ascending: false }).limit(101),
        cashQuery.order('occurred_at', { ascending: false }).limit(101),
        supabase.from('trade_journal_latest_position_snapshots').select('*').eq('user_id', user.id),
      ]);
      if (results.some(r => r.error)) throw new Error('거래·잔액을 불러오지 못했습니다. 연결 상태를 확인하고 다시 조회해 주세요.');
      const tradeRows = (results[0].data ?? []) as Trade[];
      const noteResult = tradeRows.length ? await supabase.from('trade_journal_notes').select('execution_id,note').in('execution_id', tradeRows.map(t => t.id)) : { data: [], error: null };
      if (noteResult.error) throw new Error('복기 메모를 불러오지 못했습니다. 다시 조회해 주세요.');
      if (sequence !== request.current) return;
      setUserId(user.id); setAccounts(accountRows); setTrades(tradeRows);
      const current = (results[4].data ?? []) as Snapshot[];
      setSnapshots(current);
      const snapshotCash: Balance[] = current.flatMap(s => s.cash.map(c => ({ ...c, id: `${s.id}-${c.currency}`, account_id: s.account_id, observed_at: s.observed_at, settlements: [] })));
      setBalances([...(results[1].data ?? []).filter(b => !snapshotCash.some(s => s.account_id === b.account_id && s.currency === b.currency && s.observed_at >= b.observed_at)), ...snapshotCash]); setHistory((results[2].data ?? []) as Balance[]);
      setCash((results[3].data ?? []) as CashEvent[]); setCount(results[0].count ?? 0);
      setNotes(Object.fromEntries((noteResult.data ?? []).map(n => [n.execution_id, n.note])));
    } catch (e) {
      if (sequence === request.current) { setError(e instanceof Error ? e.message : '조회 실패'); setAccounts([]); setUserId(null); setNotes({}); setTrades([]); setBalances([]); setSnapshots([]); setHistory([]); setCash([]); setCount(0); }
    } finally { if (sequence === request.current) setLoading(false); }
  }, [supabase, date, alias, market, page]);

  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useEffect(() => { void load(); return invalidateRequest; }, [load, invalidateRequest]);
  const accountName = (id: string) => accounts.find(a => a.id === id)?.label ?? '계좌';
  const visible = <T extends { account_id: string }>(items: T[]) => alias === 'all' ? items : items.filter(item => accounts.find(a => a.id === item.account_id)?.alias === alias);

  async function saveNote() {
    if (!editing || !userId || saving) return;
    setSaving(true); setNotice('');
    try {
      const { error: saveError } = await supabase.from('trade_journal_notes').upsert({ execution_id: editing.id, user_id: userId, note: draft, updated_at: new Date().toISOString() });
      if (saveError) { setNotice('메모를 저장하지 못했습니다. 다시 시도해 주세요.'); return; }
      setNotes(previous => ({ ...previous, [editing.id]: draft })); setEditing(null); setNotice('복기 메모를 저장했습니다.');
    } catch { setNotice('메모를 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }

  const control = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  return (
    <main className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-[#f7f8f6] text-slate-900">
      <header className="border-b border-slate-200 bg-[#142a30] px-5 py-6 text-white md:px-8">
        <div className="text-xs font-medium tracking-[0.2em] text-[#9dd9cb]">TRADE JOURNAL · KST</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-2xl font-semibold tracking-tight">매매일지</h1><p className="mt-2 text-sm text-slate-300">나무 일반 · 나무 ISA · 키움 / 국내 · 미국주식</p></div>
          <div className="border-l border-white/20 pl-5"><div className="text-xs text-slate-300">수집 예정 시각 · 한국시간</div><div className="mt-1 font-mono text-2xl">06:00 <span className="text-slate-400">/</span> 16:00</div></div>
        </div>
      </header>
      <div className="space-y-6 p-5 md:p-8">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-900">{snapshots.length ? '현재 잔고 저장됨' : '현재 잔고 준비 중'}</span>
          <p className="text-slate-600">현재는 CMA 잔고를 저장합니다. ISA·키움 추가 및 예약 자동 수집은 대기 중입니다.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-slate-600">증권사 거래일<input aria-label="거래일" type="date" value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setPage(0); } }} className={control} /></label>
          <label className="grid gap-1 text-xs text-slate-600">계좌<select value={alias} onChange={e => { setAlias(e.target.value); setPage(0); }} className={control}><option value="all">전체 계좌</option>{ACCOUNTS.map(a => <option key={a.alias} value={a.alias}>{a.label}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-slate-600">시장<select value={market} onChange={e => { setMarket(e.target.value); setPage(0); }} className={control}><option value="all">국내 + 미국</option><option value="KR">국내</option><option value="US">미국</option></select></label>
          <button disabled={loading || saving} onClick={() => void load()} className={`${control} disabled:opacity-50`}>새로고침</button>
        </div>
        {error && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
        {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
        {!error && userId && <HoldingsOverview key={`${userId}:${alias}:${market}`} userId={userId} cashBalances={visible(snapshots).flatMap(s => s.cash).filter(c => market === 'all' || c.currency === (market === 'US' ? 'USD' : 'KRW'))} holdings={visible(snapshots).flatMap(s => s.positions).filter(p => market === 'all' || p.market === market)} />}
        <section aria-label="현재 예수금" className="grid gap-4">
          {ACCOUNTS.filter(a => alias === 'all' ? accounts.some(row => row.alias === a.alias) : a.alias === alias).map(a => {
            const account = accounts.find(row => row.alias === a.alias);
            const rows = balances.filter(row => row.account_id === account?.id);
            return <article key={a.alias} className="border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">{a.label}</h2>
              {!rows.length && <p className="mt-6 text-sm text-slate-500">{loading ? '조회 중…' : error ? '예수금을 조회할 수 없습니다.' : '저장된 예수금 없음'}</p>}
              <div className="grid gap-6 sm:grid-cols-2">{rows.map(row => <div key={row.id} className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-xs text-slate-500"><span>{row.currency}</span><span>{time(row.observed_at)} 관측</span></div>
                <div className="mt-2 font-mono text-2xl tabular-nums">{amount(row.cash)}</div>
                <dl className="mt-3 space-y-1 text-xs text-slate-600"><div className="flex justify-between"><dt>출금가능</dt><dd>{amount(row.withdrawable)}</dd></div><div className="flex justify-between"><dt>주문가능</dt><dd>{amount(row.buying_power)}</dd></div></dl>
                {Date.now() - new Date(row.observed_at).getTime() > 86400000 && <p className="mt-2 text-xs text-amber-700">24시간 이상 갱신되지 않은 잔액</p>}
              </div>)}</div>
            </article>;
          })}
        </section>
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">현재 보유잔고</h2><p className="mt-1 text-xs text-slate-500">증권사 조회 시점의 잔고입니다. 과거 수익률과 가상의 매수기록은 만들지 않습니다.</p></div>
          {visible(snapshots).map(s => <div key={s.id}>
            <div className="px-5 py-3 text-xs text-slate-500">{accountName(s.account_id)} · {time(s.observed_at)} 관측{s.cash.filter(c => c.currency === 'KRW').map(c => <span key={c.currency}> · D+1 예수금 {amount(c.d1_cash ?? null)} · D+2 예수금 {amount(c.d2_cash ?? null)}</span>)}</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['종목 / 시장', '수량', '매입가격', '현재가', '평가금액', '평가손익', '통화'].map(t => <th key={t} className="px-4 py-3 font-medium">{t}</th>)}</tr></thead><tbody>
              {s.positions.filter(p => market === 'all' || p.market === market).map(p => <tr key={p.position_key} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{p.name}<div className="text-xs text-slate-500">{p.symbol} · {p.market} · {p.category}</div></td><td className="px-4 py-3 font-mono">{amount(p.quantity)}{p.unsettled_quantity !== null && Number(p.unsettled_quantity) !== 0 && <div className="text-xs text-slate-500">미결제 {amount(p.unsettled_quantity)}</div>}</td><td className="px-4 py-3 font-mono">{amount(p.average_price)}</td><td className="px-4 py-3 font-mono">{amount(p.current_price)}</td><td className="px-4 py-3 font-mono">{amount(p.valuation)}</td><td className="px-4 py-3 font-mono">{amount(p.unrealized_pnl)}</td><td className="px-4 py-3">{p.currency}</td></tr>)}
              {!s.positions.some(p => market === 'all' || p.market === market) && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">해당 시장의 보유종목이 없습니다.</td></tr>}
            </tbody></table></div>
          </div>)}
          {!visible(snapshots).length && <p className="px-5 py-8 text-sm text-slate-500">{loading ? '조회 중…' : error ? '보유잔고를 조회할 수 없습니다.' : '저장된 보유잔고 없음'}</p>}
        </section>
        <section className="border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">체결 내역</h2><span className="text-sm text-slate-500">{loading ? '조회 중' : error ? '미확인' : `${count}건`}</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['체결시각 · KST', '계좌 / 시장', '종목', '구분', '수량', '가격', '거래금액', '비용 / 상태', '복기'].map(t => <th key={t} className="px-4 py-3 font-medium">{t}</th>)}</tr></thead><tbody>
            {trades.map(trade => <tr key={trade.id} className="border-t border-slate-100">
              <td className="whitespace-nowrap px-4 py-4 text-xs">{time(trade.executed_at)}</td><td className="px-4 py-4 text-xs">{accountName(trade.account_id)}<div className="text-slate-500">{trade.market}</div></td>
              <td className="px-4 py-4 font-medium">{trade.name}<div className="font-mono text-xs text-slate-500">{trade.symbol} · {trade.currency}</div></td>
              <td className={`px-4 py-4 font-semibold ${trade.side === 'BUY' ? 'text-rose-700' : 'text-blue-700'}`}>{trade.side === 'BUY' ? '매수' : '매도'}</td>
              <td className="px-4 py-4 font-mono">{amount(trade.quantity)}</td><td className="px-4 py-4 font-mono">{amount(trade.price)}</td><td className="px-4 py-4 font-mono">{amount(trade.gross_amount)}</td>
              <td className="px-4 py-4 text-xs"><div>수수료 {amount(trade.fee)}</div><div>세금 {amount(trade.tax)}</div><div className="mt-1 text-slate-500">{{ CONFIRMED: '확정', PROVISIONAL: '잠정', REVERSED: '체결 취소' }[trade.status] ?? trade.status}</div></td>
              <td className="px-4 py-4"><button onClick={() => { setEditing(trade); setDraft(notes[trade.id] ?? ''); setNotice(''); }} className="underline decoration-slate-300 underline-offset-4">{notes[trade.id] ? '메모 보기' : '메모 작성'}</button></td>
            </tr>)}
            {!trades.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-500">{loading ? '체결을 조회 중입니다.' : error ? '조회할 수 없습니다.' : '저장된 체결이 없습니다. 미수집 거래가 없는지는 연동 후 확인합니다.'}</td></tr>}
          </tbody></table></div>
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500"><span>해외 거래일은 체결시각의 한국 날짜와 다를 수 있습니다.</span><div className="flex items-center gap-3"><button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)} className="disabled:opacity-30">이전</button><span>{page + 1}</span><button disabled={(page + 1) * PAGE_SIZE >= count || loading} onClick={() => setPage(p => p + 1)} className="disabled:opacity-30">다음</button></div></div>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="border border-slate-200 bg-white p-5"><h2 className="font-semibold">현금 변동 <span className="text-xs font-normal text-slate-500">한국 날짜 기준 · 최근 100건</span></h2>
            <ul className="mt-3 divide-y divide-slate-100">{visible(cash).slice(0,100).map(row => <li key={row.id} className="flex justify-between gap-3 py-3 text-sm"><div>{kindLabels[row.kind] ?? row.kind}<div className="text-xs text-slate-500">{accountName(row.account_id)} · {time(row.occurred_at)} · {row.description}</div></div><span className="whitespace-nowrap font-mono">{amount(row.amount)} {row.currency}</span></li>)}</ul>
            {!visible(cash).length && <p className="py-6 text-sm text-slate-500">{loading ? '조회 중…' : error ? '현금 변동을 조회할 수 없습니다.' : '저장된 현금 변동 없음'}</p>}{cash.length > 100 && <p className="text-xs text-amber-700">최신 100건만 표시합니다.</p>}
          </section>
          <section className="border border-slate-200 bg-white p-5"><h2 className="font-semibold">예수금 관측 이력 <span className="text-xs font-normal text-slate-500">한국 날짜 기준 · 최근 100건</span></h2>
            <ul className="mt-3 divide-y divide-slate-100">{visible(history).slice(0,100).map(row => <li key={row.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><div>{accountName(row.account_id)}<div className="text-xs text-slate-500">{time(row.observed_at)}</div></div><span className="font-mono">{amount(row.cash)} {row.currency}</span></div>{row.settlements.map((s,i) => <p key={i} className="mt-1 text-xs text-slate-500">결제 예정 {s.date}: {amount(s.amount)} {row.currency}</p>)}</li>)}</ul>
            {!visible(history).length && <p className="py-6 text-sm text-slate-500">{loading ? '조회 중…' : error ? '잔액 이력을 조회할 수 없습니다.' : '저장된 잔액 이력 없음'}</p>}{history.length > 100 && <p className="text-xs text-amber-700">최신 100건만 표시합니다.</p>}
          </section>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">예수금·출금가능금액·주문가능금액은 각각 표시합니다. 원금액은 통화별로 유지하고 통합 비중에서는 입력 환율로 원화 환산합니다. 입금·환전은 매매 수익으로 계산하지 않습니다. 오전 6시 이후의 해외 거래와 오후 4시 이후의 국내 거래는 다음 수집에서 보완합니다.</p>
      </div>
      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="note-title"><div className="w-full max-w-lg rounded-lg bg-white p-6"><h2 id="note-title" className="font-semibold">{editing.name} · 매매 복기</h2><p className="mt-1 text-xs text-slate-500">직접 작성한 메모는 거래 재수집과 별도로 보관합니다.</p><label className="mt-4 block text-sm">매매 이유 · 복기<textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={10000} rows={7} className="mt-2 w-full rounded border border-slate-300 p-3" /></label><p role="status" className="mt-2 text-sm">{notice}</p><div className="mt-4 flex justify-end gap-3"><button disabled={saving} onClick={() => setEditing(null)} className={control}>닫기</button><button disabled={saving} onClick={() => void saveNote()} className="rounded bg-[#142a30] px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button></div></div></div>}
    </main>
  );
}
