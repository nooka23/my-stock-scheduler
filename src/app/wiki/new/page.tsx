'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import WikiFrame from '@/components/wiki/WikiFrame';
import WikiEditor from '@/components/wiki/WikiEditor';
import { createClientComponentClient } from '@/lib/supabase-browser';
import { categoryList, EMPTY_WIKI_DOCUMENT, plainTextFromWikiContent, type WikiContent } from '@/lib/wiki/types';

const draftKey = 'personal-wiki:new';

export default function NewWikiDocumentPage() {
  const router = useRouter(); const supabase = createClientComponentClient();
  const [title, setTitle] = useState(''); const [categories, setCategories] = useState(''); const [ticker, setTicker] = useState(''); const [content, setContent] = useState<WikiContent>(EMPTY_WIKI_DOCUMENT); const [state, setState] = useState('');
  useEffect(() => { const raw = localStorage.getItem(draftKey); if (!raw) return; try { const draft = JSON.parse(raw); window.setTimeout(() => { setTitle(draft.title ?? ''); setCategories(draft.categories ?? ''); setTicker(draft.ticker ?? ''); setContent(draft.content ?? EMPTY_WIKI_DOCUMENT); setState('기기에 임시 저장된 초안을 불러왔습니다.'); }, 0); } catch {} }, []);
  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify({ title, categories, ticker, content })); }, [title, categories, ticker, content]);
  const save = useCallback(async () => {
    if (!title.trim()) { setState('제목을 입력하세요.'); return; }
    setState('서버에 저장 중…');
    const { data, error } = await supabase.rpc('wiki_create_document', { p_title: title, p_content: content, p_content_text: plainTextFromWikiContent(content), p_ticker_code: ticker || null, p_categories: categoryList(categories), p_mutation_id: crypto.randomUUID() });
    if (error || !data) { setState(error?.message?.includes('title_taken') ? '같은 제목 또는 이전 제목이 이미 있습니다.' : `저장하지 못했습니다. 초안은 기기에 남아 있습니다.`); return; }
    localStorage.removeItem(draftKey); router.replace(`/wiki/d/${data.id}`);
  }, [categories, content, router, supabase, ticker, title]);
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article wiki-edit-form"><div className="wiki-document-head"><div><h1>새 문서</h1><p className="wiki-meta">제목만 필수입니다. 구조는 자유롭게 작성하세요.</p></div></div>
    {state && <p className="wiki-notice">{state}</p>}<label className="wiki-field"><span>제목 *</span><input autoFocus className="wiki-input wiki-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 한미반도체" /></label>
    <label className="wiki-field"><span>종목 코드 (선택)</span><input className="wiki-input" value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="042700" /></label>
    <label className="wiki-field"><span>분류 (쉼표로 구분, 선택)</span><input className="wiki-input" value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="반도체, 장비" /></label>
    <WikiEditor content={content} onChange={setContent} />
    <div className="wiki-edit-actions"><Link className="wiki-subtle" href="/wiki">취소</Link><span className="wiki-save-state">{state || '입력 내용은 이 기기에 초안으로 보관됩니다.'}</span><button type="button" className="wiki-primary" onClick={save}>저장</button></div>
  </article></main></div></WikiFrame>;
}
