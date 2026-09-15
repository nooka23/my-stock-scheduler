'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import WikiFrame from '@/components/wiki/WikiFrame';
import { createClientComponentClient } from '@/lib/supabase-browser';

type CategorySummary = { category: string; document_count: number };
type CategoryDocument = { id: string; title: string; ticker_code: string | null; updated_at: string; categories: string[] };
type SearchDocument = Pick<CategoryDocument, 'id' | 'title' | 'ticker_code' | 'categories'>;

const PAGE_SIZE = 50;
const categoryHref = (name: string, page = 0) => `/wiki/categories?name=${encodeURIComponent(name)}${page > 0 ? `&page=${page}` : ''}`;

export default function WikiCategoriesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClientComponentClient();
  const category = (params.get('name') ?? '').trim();
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0);
  const [categorySummaries, setCategorySummaries] = useState<CategorySummary[]>([]);
  const [documents, setDocuments] = useState<CategoryDocument[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchDocument[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const documentLoadSequence = useRef(0);

  const categoryCount = useMemo(
    () => categorySummaries.find((item) => item.category === category)?.document_count ?? 0,
    [category, categorySummaries],
  );

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    const { data, error } = await supabase.rpc('wiki_list_categories');
    if (error) {
      setMessage('분류를 불러오지 못했습니다.');
      setCategoriesLoading(false);
      return;
    }
    setCategorySummaries((data ?? []) as CategorySummary[]);
    setCategoriesLoading(false);
  }, [supabase]);

  const loadCategoryDocuments = useCallback(async () => {
    if (!category) return;
    const requestId = ++documentLoadSequence.current;
    setLoading(true);
    const start = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('wiki_documents')
      .select('id,title,ticker_code,updated_at,categories')
      .contains('categories', [category])
      .order('title')
      .range(start, start + PAGE_SIZE - 1);
    if (requestId !== documentLoadSequence.current) return;
    if (error) {
      setMessage('이 분류의 문서를 불러오지 못했습니다.');
      setDocuments([]);
      setHasNextPage(false);
    } else {
      const rows = (data ?? []) as CategoryDocument[];
      setDocuments(rows);
      setHasNextPage(rows.length === PAGE_SIZE);
      setMessage(rows.length ? '' : '아직 이 분류에 등록된 문서가 없습니다.');
    }
    setLoading(false);
  }, [category, page, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCategories(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCategories]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCategoryDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCategoryDocuments]);

  const openNewCategory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    router.push(`/wiki/categories?name=${encodeURIComponent(name)}`);
  };

  const searchDocuments = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    if (!query) {
      setSearchResults([]);
      setMessage('종목명이나 종목코드를 입력하세요.');
      return;
    }
    const safeQuery = query.replace(/[(),]/g, '').trim();
    if (!safeQuery) {
      setSearchResults([]);
      setMessage('종목명이나 종목코드를 입력하세요.');
      return;
    }
    setSearching(true);
    setMessage('검색 중…');
    const pattern = `%${safeQuery}%`;
    const [titleResult, tickerResult] = await Promise.all([
      supabase.from('wiki_documents').select('id,title,ticker_code,categories').ilike('title', pattern).order('title').limit(PAGE_SIZE),
      supabase.from('wiki_documents').select('id,title,ticker_code,categories').ilike('ticker_code', pattern).order('title').limit(PAGE_SIZE),
    ]);
    if (titleResult.error || tickerResult.error) {
      setSearchResults([]);
      setMessage('문서 검색에 실패했습니다.');
    } else {
      const unique = new Map<string, SearchDocument>();
      [...(titleResult.data ?? []), ...(tickerResult.data ?? [])].forEach((document) => unique.set(document.id, document as SearchDocument));
      const matches = [...unique.values()].sort((left, right) => left.title.localeCompare(right.title, 'ko'));
      setSearchResults(matches);
      setMessage(matches.length ? '' : '검색 결과가 없습니다.');
    }
    setSearching(false);
  };

  const toggleDocument = (document: SearchDocument, checked: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[document.id] = document.title;
      else delete next[document.id];
      return next;
    });
  };

  const addCategoryToSelected = async () => {
    const documentIds = Object.keys(selected);
    if (!category || !documentIds.length) return;
    setSaving(true);
    setMessage(`${documentIds.length}개 문서에 분류를 적용하는 중…`);
    const { data, error } = await supabase.rpc('wiki_add_category_to_documents', {
      p_category: category,
      p_document_ids: documentIds,
      p_mutation_id: crypto.randomUUID(),
    });
    if (error) {
      setMessage(error.message.includes('wiki_document_not_found')
        ? '선택한 문서 일부를 찾지 못해 변경을 모두 취소했습니다. 다시 검색해 주세요.'
        : '분류를 저장하지 못했습니다. 기존 문서 분류는 변경되지 않았습니다.');
    } else {
      const count = Number(data ?? 0);
      setMessage(`${count}개 문서에 “${category}” 분류를 추가했습니다. 변경 내용은 각 문서의 수정 이력에 기록됐습니다.`);
      setSelected({});
      setSearchResults([]);
      setSearch('');
      await loadCategories();
      if (page === 0) await loadCategoryDocuments();
      else router.replace(categoryHref(category));
    }
    setSaving(false);
  };

  if (!category) {
    return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article">
      <header className="wiki-home-head"><div><p className="wiki-meta"><Link href="/wiki">위키</Link> / 분류</p><h1>분류</h1><p className="wiki-meta">분류별로 문서를 모아봅니다.</p></div></header>
      <form className="wiki-category-create" onSubmit={openNewCategory}>
        <label className="wiki-field"><span>새 분류에 문서 지정</span><input className="wiki-input" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={80} placeholder="예: 로봇" /></label>
        <button className="wiki-primary" type="submit" disabled={!newCategory.trim()}>분류 선택 후 종목 찾기</button>
      </form>
      <h2 className="wiki-category-heading">사용 중인 분류</h2>
      {categoriesLoading ? <p className="wiki-empty">분류를 불러오는 중…</p> : categorySummaries.length ? <ul className="wiki-document-list wiki-category-list">{categorySummaries.map((item) => <li key={item.category}><Link href={categoryHref(item.category)}>{item.category}</Link><span>{Number(item.document_count)}개 문서</span></li>)}</ul> : <p className="wiki-empty">{message || '아직 등록된 분류가 없습니다.'}</p>}
    </article></main></div></WikiFrame>;
  }

  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article">
    <header className="wiki-home-head"><div><p className="wiki-meta"><Link href="/wiki">위키</Link> / <Link href="/wiki/categories">분류</Link></p><h1>{category}</h1><p className="wiki-meta">{categoryCount}개 문서</p></div><Link className="wiki-tool" href="/wiki/categories">분류 목록</Link></header>
    <div className="wiki-category-actions"><button type="button" className="wiki-primary" onClick={() => { setShowPicker((value) => !value); setMessage(''); }}>{showPicker ? '문서 선택 닫기' : '문서 추가'}</button></div>
    {message && !showPicker && <p className="wiki-notice" role="status">{message}</p>}
    {showPicker && <section className="wiki-category-picker" aria-labelledby="wiki-category-picker-title">
      <h2 id="wiki-category-picker-title">{category} 분류에 문서 추가</h2>
      <p className="wiki-meta">제목이나 종목코드로 찾고 여러 문서를 선택할 수 있습니다. 기존 분류는 유지됩니다.</p>
      <form className="wiki-category-search" onSubmit={searchDocuments}>
        <input className="wiki-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="종목명 또는 종목코드" aria-label="종목명 또는 종목코드 검색" />
        <button className="wiki-tool" type="submit" disabled={searching}>{searching ? '검색 중…' : '검색'}</button>
      </form>
      {searchResults.length > 0 && <ul className="wiki-category-pick-list">{searchResults.map((document) => {
        const alreadyAdded = document.categories?.some((value) => value.trim() === category) ?? false;
        return <li key={document.id}>
          <label><input type="checkbox" checked={Boolean(selected[document.id])} disabled={alreadyAdded || saving} onChange={(event) => toggleDocument(document, event.target.checked)} /><span><strong>{document.title}</strong>{document.ticker_code && <small>{document.ticker_code}</small>}</span></label>
          {alreadyAdded && <small className="wiki-meta">이미 지정됨</small>}
        </li>;
      })}</ul>}
      {message && <p className="wiki-meta">{message}</p>}
      <div className="wiki-category-bulk-bar"><span>{Object.keys(selected).length}개 선택</span><button type="button" className="wiki-primary" disabled={saving || Object.keys(selected).length === 0} onClick={addCategoryToSelected}>{saving ? '저장 중…' : '선택 문서에 분류 추가'}</button></div>
    </section>}
    <h2 className="wiki-category-heading">문서 목록</h2>
    {loading ? <p className="wiki-empty">문서를 불러오는 중…</p> : documents.length ? <>
      <ul className="wiki-document-list">{documents.map((document) => <li key={document.id}><Link href={`/wiki/d/${document.id}`}>{document.title}</Link>{document.ticker_code && <small className="wiki-category-ticker">{document.ticker_code}</small>}<p>수정 {new Date(document.updated_at).toLocaleString('ko-KR')}</p></li>)}</ul>
      <div className="wiki-category-pagination"><button className="wiki-tool" type="button" disabled={page === 0 || loading} onClick={() => router.push(categoryHref(category, page - 1))}>이전</button><span>{page + 1} 페이지</span><button className="wiki-tool" type="button" disabled={!hasNextPage || loading} onClick={() => router.push(categoryHref(category, page + 1))}>다음</button></div>
    </> : <p className="wiki-empty">{message || '아직 이 분류에 등록된 문서가 없습니다.'}</p>}
  </article></main></div></WikiFrame>;
}
