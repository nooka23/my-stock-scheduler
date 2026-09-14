import type { ReactNode } from 'react';
import Image from 'next/image';
import type { WikiContent } from '@/lib/wiki/types';

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type?: string; attrs?: Record<string, unknown> }[]; content?: Node[] };

function renderInline(node: Node, key: string): ReactNode {
  let value: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') value = <strong key={`${key}-bold`}>{value}</strong>;
    if (mark.type === 'italic') value = <em key={`${key}-italic`}>{value}</em>;
    if (mark.type === 'underline') value = <u key={`${key}-under`}>{value}</u>;
    if (mark.type === 'code') value = <code key={`${key}-code`}>{value}</code>;
    if (mark.type === 'link') value = <a key={`${key}-link`} href={String(mark.attrs?.href ?? '#')} target={String(mark.attrs?.href ?? '').startsWith('http') ? '_blank' : undefined} rel="noreferrer">{value}</a>;
  }
  return value;
}

function children(node: Node, prefix: string, documentId?: string): ReactNode[] { return (node.content ?? []).map((item, index) => renderNode(item, `${prefix}-${index}`, documentId)); }

function renderNode(node: Node, key: string, documentId?: string): ReactNode {
  if (node.type === 'text') return renderInline(node, key);
  const content = children(node, key, documentId);
  if (node.type === 'paragraph') return <p key={key}>{content}</p>;
  if (node.type === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
    const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
    return <Tag key={key} id={id}>{content}{documentId && id ? <a className="wiki-section-edit" href={`/wiki/d/${documentId}/edit?section=${encodeURIComponent(id)}`}>[편집]</a> : null}</Tag>;
  }
  if (node.type === 'bulletList') return <ul key={key}>{content}</ul>;
  if (node.type === 'orderedList') return <ol key={key}>{content}</ol>;
  if (node.type === 'listItem') return <li key={key}>{content}</li>;
  if (node.type === 'blockquote') return <blockquote key={key}>{content}</blockquote>;
  if (node.type === 'codeBlock') return <pre key={key}><code>{content}</code></pre>;
  if (node.type === 'horizontalRule') return <hr key={key} />;
  // Authenticated wiki files are streamed from a private route, so optimization
  // stays disabled and the request retains the user's session cookie.
  if (node.type === 'image') return <figure key={key}><Image unoptimized src={String(node.attrs?.src ?? '')} alt={String(node.attrs?.alt ?? '')} width={1200} height={800} /></figure>;
  if (node.type === 'table') return <div key={key} className="wiki-table-wrap"><table><tbody>{content}</tbody></table></div>;
  if (node.type === 'tableRow') return <tr key={key}>{content}</tr>;
  if (node.type === 'tableHeader') return <th key={key}>{content}</th>;
  if (node.type === 'tableCell') return <td key={key}>{content}</td>;
  return <>{content}</>;
}

export default function WikiReader({ content, documentId }: { content: WikiContent; documentId?: string }) {
  return <div className="wiki-prose">{children(content as Node, 'root', documentId)}</div>;
}

export function headingsFromContent(content: WikiContent) {
  const items: { id: string; level: number; text: string }[] = [];
  const walk = (node: Node) => {
    if (node.type === 'heading') {
      const text = (node.content ?? []).map((child) => child.text ?? '').join('');
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : `heading-${items.length + 1}`;
      items.push({ id, level: Number(node.attrs?.level ?? 2), text });
    }
    node.content?.forEach(walk);
  };
  walk(content as Node);
  return items;
}
