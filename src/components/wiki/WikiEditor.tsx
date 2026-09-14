'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import UniqueID from '@tiptap/extension-unique-id';
import { createClientComponentClient } from '@/lib/supabase-browser';
import type { WikiContent } from '@/lib/wiki/types';

type Props = {
  content: WikiContent;
  onChange: (content: WikiContent) => void;
};

const Button = ({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) => (
  <button type="button" aria-pressed={active} className={`wiki-editor-button ${active ? 'is-active' : ''}`} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>
    {label}
  </button>
);

export default function WikiEditor({ content, onChange }: Props) {
  const supabase = createClientComponentClient();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: '메모를 시작하세요. 제목과 구성은 자유롭습니다.' }),
      UniqueID.configure({ types: ['heading'] }),
    ],
    content,
    editorProps: { attributes: { class: 'wiki-prose wiki-editor-prose', spellCheck: 'true' } },
    onUpdate: ({ editor: nextEditor }) => onChange(nextEditor.getJSON() as WikiContent),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('링크 주소', previous ?? '');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }, [editor]);

  const addInternalLink = useCallback(async () => {
    if (!editor) return;
    const query = window.prompt('연결할 문서 제목');
    if (!query?.trim()) return;
    const { data, error } = await supabase.from('wiki_documents').select('id,title').ilike('title', query.trim()).order('updated_at', { ascending: false }).limit(8);
    if (error || !data?.length) { window.alert('일치하는 문서를 찾지 못했습니다. 먼저 문서를 만들거나 일반 링크를 사용하세요.'); return; }
    const selected = data.length === 1 ? data[0] : data.find((document) => document.title === query.trim()) ?? data[0];
    const label = editor.state.selection.empty ? selected.title : undefined;
    const chain = editor.chain().focus();
    if (label) chain.insertContent(label);
    chain.extendMarkRange('link').setLink({ href: `/wiki/d/${selected.id}` }).run();
  }, [editor, supabase]);

  const uploadImage = async (file: File) => {
    if (!editor || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 만료되었습니다.');
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'image';
      const objectPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('wiki-private').upload(objectPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: metadataError } = await supabase.from('wiki_attachments').insert({
        owner_id: user.id, storage_path: objectPath, original_filename: file.name, mime_type: file.type, byte_size: file.size,
      }).select('id').single();
      if (metadataError) throw metadataError;
      editor.chain().focus().setImage({ src: `/api/wiki/attachments/${data.id}`, alt: file.name, title: data.id }).run();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '이미지 업로드에 실패했습니다.');
    } finally { setUploading(false); }
  };

  if (!editor) return null;
  return <div className="wiki-editor">
    <div className="wiki-editor-toolbar" aria-label="편집 도구">
      <Button label="B" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Button label="I" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Button label="밑줄" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Button label="링크" active={editor.isActive('link')} onClick={addLink} />
      <Button label="문서 링크" onClick={addInternalLink} />
      <Button label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Button label="목록" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Button label="표" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Button label={uploading ? '업로드 중' : '이미지'} onClick={() => inputRef.current?.click()} />
      <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadImage(file); event.currentTarget.value = ''; }} />
    </div>
    <EditorContent editor={editor} />
  </div>;
}
