'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import WikiFrame from '@/components/wiki/WikiFrame';
import WikiReader, { headingsFromContent } from '@/components/wiki/WikiReader';
import { createClientComponentClient } from '@/lib/supabase-browser';
import type { WikiDocument } from '@/lib/wiki/types';

export default function WikiDocumentPage() {
  const { id } = useParams<{ id: string }>(); const supabase = createClientComponentClient(); const [document, setDocument] = useState<WikiDocument | null>(null); const [error, setError] = useState('');
  useEffect(() => { (async () => { const { data, error: requestError } = await supabase.from('wiki_documents').select('*').eq('id', id).single(); if (requestError) setError('문서를 찾을 수 없습니다.'); else setDocument(data as WikiDocument); })(); }, [id, supabase]);
  const headings = useMemo(() => document ? headingsFromContent(document.content) : [], [document]);
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article">{error && <p className="wiki-empty">{error}</p>}{document && <>
    <header className="wiki-document-head"><div><h1>{document.title}</h1><p className="wiki-meta">최근 수정 시각: {new Date(document.updated_at).toLocaleString('ko-KR')}</p></div><div className="wiki-tools"><Link className="wiki-tool" href={`/wiki/d/${document.id}/edit`}>편집</Link><Link className="wiki-tool" href={`/wiki/d/${document.id}/history`}>역사</Link></div></header>
    {document.categories.length > 0 && <div className="wiki-categories"><strong>분류:</strong>{document.categories.map((category) => <a href={`/wiki/search?q=${encodeURIComponent(category)}`} key={category}>{category}</a>)}</div>}
    {headings.length > 0 && <details open className="wiki-toc"><summary>목차</summary>{headings.map((heading, index) => <a key={heading.id} data-level={heading.level} href={`#${heading.id}`}>{index + 1}. {heading.text}</a>)}</details>}
    <WikiReader content={document.content} documentId={document.id} />
  </>}</article></main><aside className="wiki-sidebar"><div className="wiki-side-card"><h2>문서 도구</h2><ul><li><Link href={`/wiki/d/${id}/edit`}>전체 편집</Link></li><li><Link href={`/wiki/d/${id}/history`}>수정 이력</Link></li></ul></div></aside></div></WikiFrame>;
}
