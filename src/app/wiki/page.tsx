'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import WikiFrame from '@/components/wiki/WikiFrame';
import { createClientComponentClient } from '@/lib/supabase-browser';
import type { WikiDocument } from '@/lib/wiki/types';

export default function WikiHomePage() {
  const supabase = createClientComponentClient();
  const [documents, setDocuments] = useState<Pick<WikiDocument, 'id' | 'title' | 'content_text' | 'updated_at' | 'categories'>[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('문서를 불러오는 중…');
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('wiki_documents').select('id,title,content_text,updated_at,categories').order('updated_at', { ascending: false }).limit(100);
    if (error) setMessage('위키를 아직 사용할 수 없습니다. 소유자 설정과 마이그레이션을 확인하세요.');
    else { setDocuments(data ?? []); setMessage('아직 작성한 문서가 없습니다.'); }
  })(); }, [supabase]);
  const shown = useMemo(() => documents.filter((document) => `${document.title} ${document.content_text}`.toLowerCase().includes(query.toLowerCase())), [documents, query]);
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article">
    <div className="wiki-home-head"><div><h1>문서</h1><p className="wiki-meta">내가 작성한 투자 기록입니다.</p><Link className="wiki-tool" href="/wiki/categories">분류별로 보기</Link></div><Link className="wiki-primary" href="/wiki/new">새 문서</Link></div>
    <input className="wiki-home-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목과 본문에서 찾기" aria-label="문서 검색" />
    {shown.length ? <ul className="wiki-document-list">{shown.map((document) => <li key={document.id}><Link href={`/wiki/d/${document.id}`}>{document.title}</Link><p>{document.content_text.slice(0, 140) || '내용 없음'} · {new Date(document.updated_at).toLocaleString('ko-KR')}</p></li>)}</ul> : <p className="wiki-empty">{message}</p>}
  </article></main><aside className="wiki-sidebar"><div className="wiki-side-card"><h2>최근 수정</h2><ul>{documents.slice(0, 8).map((document) => <li key={document.id}><Link href={`/wiki/d/${document.id}`}>{document.title}</Link></li>)}</ul></div></aside></div></WikiFrame>;
}
