import type { Metadata } from 'next';
import WikiAccessBoundary from '@/components/wiki/WikiAccessBoundary';
import './wiki.css';

export const metadata: Metadata = { title: '개인 종목 위키', description: '개인 투자 리서치 위키' };

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return <WikiAccessBoundary><div className="wiki-app">{children}</div></WikiAccessBoundary>;
}
