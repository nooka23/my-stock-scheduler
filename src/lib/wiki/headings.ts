import type { WikiContent } from '@/lib/wiki/types';

type HeadingNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: HeadingNode[];
};

export type WikiHeading = {
  id: string;
  level: number;
  depth: number;
  number: string;
  text: string;
};

export function headingsFromContent(content: WikiContent): WikiHeading[] {
  const rawItems: Omit<WikiHeading, 'depth' | 'number'>[] = [];
  const getText = (node: HeadingNode): string => node.text ?? (node.content ?? []).map(getText).join('');
  const walk = (node: HeadingNode) => {
    if (node.type === 'heading') {
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : `heading-${rawItems.length + 1}`;
      rawItems.push({
        id,
        level: Math.max(1, Number(node.attrs?.level ?? 2)),
        text: (node.content ?? []).map(getText).join(''),
      });
    }
    node.content?.forEach(walk);
  };
  walk(content as HeadingNode);
  if (!rawItems.length) return [];

  // Use the shallowest heading as this document's top level. That keeps H2
  // based templates numbered 1, 1.1, 1.1.1 and tolerates skipped heading levels.
  const firstLevel = rawItems.reduce((minimum, item) => Math.min(minimum, item.level), rawItems[0].level);
  const counters: number[] = [];
  return rawItems.map((item) => {
    const depth = Math.max(1, item.level - firstLevel + 1);
    if (counters.length < depth) {
      for (let index = counters.length; index < depth - 1; index += 1) counters[index] = 1;
      counters[depth - 1] = 0;
    } else {
      counters.length = depth;
    }
    counters[depth - 1] += 1;
    return { ...item, depth, number: counters.join('.') };
  });
}
