'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import WikiFrame from '@/components/wiki/WikiFrame';
import { createClientComponentClient } from '@/lib/supabase-browser';
import type { WikiDocument } from '@/lib/wiki/types';

export default function WikiSearchPage() {
  const params = useSearchParams(); const supabase = createClientComponentClient(); const query = (params.get('q') ?? '').trim(); const [documents, setDocuments] = useState<Pick<WikiDocument, 'id' | 'title' | 'content_text' | 'updated_at'>[]>([]); const [message, setMessage] = useState('검색어를 입력하세요.');
  useEffect(() => { if (!query) return; (async () => { const escaped = query.replace(/[,%_]/g, ''); const { data, error } = await supabase.from('wiki_documents').select('id,title,content_text,updated_at').or(`title.ilike.%${escaped}%,content_text.ilike.%${escaped}%`).order('updated_at', { ascending: false }).limit(50); if (error) setMessage('검색할 수 없습니다.'); else { setDocuments(data ?? []); setMessage('결과가 없습니다.'); } })(); }, [query, supabase]);
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article"><header className="wiki-document-head"><div><h1>검색</h1><p className="wiki-meta">{query ? `“${query}” 검색 결과` : '제목과 본문에서 찾습니다.'}</p></div></header>{documents.length ? <ul className="wiki-document-list">{documents.map((document) => <li key={document.id}><Link href={`/wiki/d/${document.id}`}>{document.title}</Link><p>{document.content_text.slice(0, 180)}</p></li>)}</ul> : <p className="wiki-empty">{message}</p>}</article></main></div></WikiFrame>;
}
