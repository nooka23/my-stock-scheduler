'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import WikiFrame from '@/components/wiki/WikiFrame';
import WikiEditor from '@/components/wiki/WikiEditor';
import { createClientComponentClient } from '@/lib/supabase-browser';
import { categoryList, extractWikiSection, plainTextFromWikiContent, replaceWikiSection, type WikiContent, type WikiDocument } from '@/lib/wiki/types';

export default function WikiEditPage() {
  const { id } = useParams<{ id: string }>();
  const sectionId = useSearchParams().get('section');
  const router = useRouter();
  const supabase = createClientComponentClient();
  const draftKey = `personal-wiki:${id}:${sectionId ?? 'all'}`;
  const [document, setDocument] = useState<WikiDocument | null>(null);
  const [title, setTitle] = useState(''); const [ticker, setTicker] = useState(''); const [categories, setCategories] = useState('');
  const [content, setContent] = useState<WikiContent>({ type: 'doc', content: [{ type: 'paragraph' }] });
  const [sectionRange, setSectionRange] = useState<{ start: number; end: number } | null>(null);
  const [state, setState] = useState('불러오는 중…');
  const loaded = useRef(false);
  const isSectionEdit = Boolean(sectionId && sectionRange);

  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('wiki_documents').select('*').eq('id', id).single();
    if (error || !data) { setState('문서를 찾을 수 없습니다.'); return; }
    const next = data as WikiDocument;
    setDocument(next); setTitle(next.title); setTicker(next.ticker_code ?? ''); setCategories(next.categories.join(', '));
    const selected = sectionId ? extractWikiSection(next.content, sectionId) : null;
    if (sectionId && !selected) { setState('편집할 절을 찾지 못했습니다. 전체 편집으로 전환하세요.'); return; }
    setSectionRange(selected ? { start: selected.start, end: selected.end } : null);
    const initialContent = selected?.content ?? next.content;
    setContent(initialContent);
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (draft?.baseRevision === next.revision) { setContent(draft.content); if (!selected) { setTitle(draft.title); setTicker(draft.ticker); setCategories(draft.categories); } setState('기기에 저장된 미완료 초안을 불러왔습니다.'); }
      else setState(selected ? '이 절만 편집합니다. 제목 단계 이동은 전체 편집에서 하세요.' : '서버의 최신 문서입니다.');
    } catch { setState(selected ? '이 절만 편집합니다. 제목 단계 이동은 전체 편집에서 하세요.' : '서버의 최신 문서입니다.'); }
    loaded.current = true;
  })(); }, [draftKey, id, sectionId, supabase]);

  useEffect(() => {
    if (!loaded.current || !document) return;
    localStorage.setItem(draftKey, JSON.stringify({ baseRevision: document.revision, title, ticker, categories, content }));
  }, [categories, content, document, draftKey, ticker, title]);

  const save = useCallback(async () => {
    if (!document || (!isSectionEdit && !title.trim())) { setState('제목을 입력하세요.'); return; }
    const wholeContent = sectionRange ? replaceWikiSection(document.content, sectionRange.start, sectionRange.end, content) : content;
    setState('서버에 저장 중…');
    const { data, error } = await supabase.rpc('wiki_save_document', {
      p_document_id: document.id, p_base_revision: document.revision, p_title: title, p_content: wholeContent,
      p_content_text: plainTextFromWikiContent(wholeContent), p_ticker_code: ticker || null, p_categories: categoryList(categories),
      p_mutation_id: crypto.randomUUID(), p_restored_from_revision: null,
    });
    if (error || !data) { setState(error?.message?.includes('revision_conflict') ? '다른 기기에서 먼저 저장되었습니다. 내 초안은 기기에 보관됩니다. 최신 문서를 다시 열어 비교하세요.' : '저장하지 못했습니다. 초안은 기기에 남아 있습니다.'); return; }
    localStorage.removeItem(draftKey); router.replace(`/wiki/d/${document.id}`);
  }, [categories, content, document, draftKey, isSectionEdit, router, sectionRange, supabase, ticker, title]);

  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article wiki-edit-form">
    <header className="wiki-document-head"><div><h1>{isSectionEdit ? '절 편집' : '문서 편집'}</h1><p className="wiki-meta">{isSectionEdit ? '절의 내용만 바꿉니다.' : '전체 편집'} · 현재 버전 {document?.revision ?? '—'}</p></div></header>
    {state && <p className="wiki-notice">{state}</p>}
    {document && <>{!isSectionEdit && <><label className="wiki-field"><span>제목 *</span><input className="wiki-input wiki-title-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="wiki-field"><span>종목 코드 (선택)</span><input className="wiki-input" value={ticker} onChange={(event) => setTicker(event.target.value)} /></label><label className="wiki-field"><span>분류 (쉼표로 구분)</span><input className="wiki-input" value={categories} onChange={(event) => setCategories(event.target.value)} /></label></>}<WikiEditor content={content} onChange={setContent} /><div className="wiki-edit-actions"><Link className="wiki-subtle" href={`/wiki/d/${id}`}>취소</Link><span className="wiki-save-state">저장 실패 시 초안을 이 기기에 남깁니다.</span><button type="button" className="wiki-primary" onClick={save}>저장</button></div></>}
  </article></main></div></WikiFrame>;
}
