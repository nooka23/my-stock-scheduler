'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import WikiFrame from '@/components/wiki/WikiFrame';
import { createClientComponentClient } from '@/lib/supabase-browser';
import { plainTextFromWikiContent, type WikiRevision } from '@/lib/wiki/types';

export default function WikiHistoryPage() {
  const { id } = useParams<{ id: string }>(); const supabase = createClientComponentClient(); const [revisions, setRevisions] = useState<WikiRevision[]>([]); const [message, setMessage] = useState('이력을 불러오는 중…');
  useEffect(() => { (async () => { const { data, error } = await supabase.from('wiki_revisions').select('id,document_id,revision,title,content,ticker_code,categories,created_at,restored_from_revision').eq('document_id', id).order('revision', { ascending: false }); if (error) setMessage('이력을 불러올 수 없습니다.'); else { setRevisions((data ?? []) as WikiRevision[]); setMessage('저장된 이력이 없습니다.'); } })(); }, [id, supabase]);
  const restore = async (revision: WikiRevision) => {
    if (!window.confirm(`v${revision.revision} 내용으로 복원할까요? 현재 내용은 새 이력으로 보존됩니다.`)) return;
    setMessage('복원 중…');
    const { data: current, error: currentError } = await supabase.from('wiki_documents').select('revision').eq('id', id).single();
    if (currentError || !current) { setMessage('현재 문서를 읽지 못했습니다.'); return; }
    const { error } = await supabase.rpc('wiki_save_document', { p_document_id: id, p_base_revision: current.revision, p_title: revision.title, p_content: revision.content, p_content_text: plainTextFromWikiContent(revision.content), p_ticker_code: revision.ticker_code, p_categories: revision.categories, p_mutation_id: crypto.randomUUID(), p_restored_from_revision: revision.revision });
    if (error) { setMessage('복원하지 못했습니다. 최신 이력을 확인하세요.'); return; }
    window.location.reload();
  };
  return <WikiFrame><div className="wiki-shell"><main className="wiki-main"><article className="wiki-article"><header className="wiki-document-head"><div><h1>수정 이력</h1><p className="wiki-meta">이전 버전은 보존됩니다. 복원은 새 버전을 만드는 방식입니다.</p></div><div className="wiki-tools"><Link className="wiki-tool" href={`/wiki/d/${id}`}>문서</Link><Link className="wiki-tool" href={`/wiki/d/${id}/edit`}>편집</Link></div></header>{revisions.length ? <ol className="wiki-history">{revisions.map((revision) => <li key={revision.id}><b>v{revision.revision}</b><div><div>{revision.title}</div><time>{new Date(revision.created_at).toLocaleString('ko-KR')}{revision.restored_from_revision ? ` · v${revision.restored_from_revision}에서 복원` : ''}</time></div>{revision.revision !== revisions[0]?.revision && <button className="wiki-subtle" type="button" onClick={() => restore(revision)}>복원</button>}</li>)}</ol> : <p className="wiki-empty">{message}</p>}</article></main></div></WikiFrame>;
}
