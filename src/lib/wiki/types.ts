export type WikiDocument = {
  id: string;
  owner_id: string;
  title: string;
  content: WikiContent;
  content_text: string;
  format_version: number;
  revision: number;
  ticker_code: string | null;
  categories: string[];
  created_at: string;
  updated_at: string;
};

export type WikiRevision = {
  id: string;
  document_id: string;
  revision: number;
  title: string;
  content: WikiContent;
  ticker_code: string | null;
  categories: string[];
  created_at: string;
  restored_from_revision: number | null;
};

export type WikiContent = Record<string, unknown>;

export const EMPTY_WIKI_DOCUMENT: WikiContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export function plainTextFromWikiContent(content: WikiContent): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const value = node as { text?: unknown; content?: unknown };
    if (typeof value.text === 'string') parts.push(value.text);
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(content);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function categoryList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

type ContentNode = { type?: string; attrs?: { id?: string; level?: number }; content?: ContentNode[]; [key: string]: unknown };

export function extractWikiSection(content: WikiContent, headingId: string) {
  const nodes = Array.isArray(content.content) ? content.content as ContentNode[] : [];
  const start = nodes.findIndex((node) => node.type === 'heading' && node.attrs?.id === headingId);
  if (start < 0) return null;
  const level = Number(nodes[start].attrs?.level ?? 2);
  let end = nodes.length;
  for (let index = start + 1; index < nodes.length; index += 1) {
    if (nodes[index].type === 'heading' && Number(nodes[index].attrs?.level ?? 2) <= level) { end = index; break; }
  }
  return { start, end, content: { type: 'doc', content: nodes.slice(start, end) } as WikiContent };
}

export function replaceWikiSection(original: WikiContent, sectionStart: number, sectionEnd: number, replacement: WikiContent): WikiContent {
  const nodes = Array.isArray(original.content) ? original.content as ContentNode[] : [];
  const next = Array.isArray(replacement.content) ? replacement.content : [];
  return { ...original, content: [...nodes.slice(0, sectionStart), ...next, ...nodes.slice(sectionEnd)] } as WikiContent;
}
