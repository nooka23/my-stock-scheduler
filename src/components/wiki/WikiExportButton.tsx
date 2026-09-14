'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import { createClientComponentClient } from '@/lib/supabase-browser';
import type { WikiContent, WikiDocument, WikiRevision } from '@/lib/wiki/types';

type Attachment = { id: string; original_filename: string; mime_type: string; byte_size: number; storage_path: string; created_at: string };
type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type?: string; attrs?: Record<string, unknown> }[]; content?: Node[] };

function markdown(content: WikiContent): string {
  const inline = (node: Node): string => {
    let value = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') value = `**${value}**`;
      if (mark.type === 'italic') value = `*${value}*`;
      if (mark.type === 'link') value = `[${value}](${String(mark.attrs?.href ?? '')})`;
    }
    return value;
  };
  const render = (node: Node): string => {
    const inside = (node.content ?? []).map(render).join('');
    if (node.type === 'text') return inline(node);
    if (node.type === 'paragraph') return `${inside}\n\n`;
    if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 2))} ${inside}\n\n`;
    if (node.type === 'bulletList') return (node.content ?? []).map((item) => `- ${render(item).trim()}\n`).join('') + '\n';
    if (node.type === 'orderedList') return (node.content ?? []).map((item, index) => `${index + 1}. ${render(item).trim()}\n`).join('') + '\n';
    if (node.type === 'listItem') return inside;
    if (node.type === 'blockquote') return inside.split('\n').filter(Boolean).map((line) => `> ${line}\n`).join('') + '\n';
    if (node.type === 'image') return `![${String(node.attrs?.alt ?? '')}](attachments/${String(node.attrs?.title ?? '')})\n\n`;
    if (node.type === 'horizontalRule') return '---\n\n';
    return inside;
  };
  return render(content as Node).trimEnd() + '\n';
}

export default function WikiExportButton() {
  const supabase = createClientComponentClient();
  const [state, setState] = useState('');
  const exportAll = async () => {
    setState('내보내기 준비 중…');
    try {
      const [{ data: documents, error: documentError }, { data: revisions, error: revisionError }, { data: attachments, error: attachmentError }] = await Promise.all([
        supabase.from('wiki_documents').select('*').order('updated_at'),
        supabase.from('wiki_revisions').select('*').order('document_id').order('revision'),
        supabase.from('wiki_attachments').select('id,original_filename,mime_type,byte_size,storage_path,created_at').order('created_at'),
      ]);
      if (documentError || revisionError || attachmentError) throw documentError ?? revisionError ?? attachmentError;
      const zip = new JSZip(); const documentsFolder = zip.folder('documents')!; const attachmentsFolder = zip.folder('attachments')!;
      for (const document of (documents ?? []) as WikiDocument[]) {
        const fileBase = `${document.id}-${document.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}`;
        documentsFolder.file(`${fileBase}.json`, JSON.stringify(document, null, 2));
        documentsFolder.file(`${fileBase}.md`, `# ${document.title}\n\n${markdown(document.content)}`);
      }
      zip.file('history.json', JSON.stringify((revisions ?? []) as WikiRevision[], null, 2));
      const manifest: { exportedAt: string; formatVersion: number; documents: number; attachments: Attachment[] } = { exportedAt: new Date().toISOString(), formatVersion: 1, documents: documents?.length ?? 0, attachments: (attachments ?? []) as Attachment[] };
      for (const attachment of manifest.attachments) {
        const response = await fetch(`/api/wiki/attachments/${attachment.id}`);
        if (!response.ok) throw new Error(`${attachment.original_filename}을 가져오지 못했습니다.`);
        attachmentsFolder.file(`${attachment.id}-${attachment.original_filename}`, await response.blob());
      }
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `personal-wiki-${new Date().toISOString().slice(0, 10)}.zip`; link.click(); URL.revokeObjectURL(url);
      setState('내보내기를 완료했습니다.');
    } catch (error) { setState(error instanceof Error ? error.message : '내보내기에 실패했습니다.'); }
  };
  return <div><button className="wiki-primary" type="button" onClick={exportAll}>전체 내보내기 (.zip)</button>{state && <p className="wiki-meta">{state}</p>}</div>;
}
