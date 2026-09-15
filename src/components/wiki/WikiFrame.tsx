import Link from 'next/link';

export default function WikiFrame({ children }: { children: React.ReactNode }) {
  return <>
    <header className="wiki-nav"><div className="wiki-nav-inner">
      <Link className="wiki-brand" href="/wiki">개인 종목 위키<small>PRIVATE RESEARCH</small></Link>
      <nav className="wiki-nav-links"><Link href="/wiki">문서</Link><Link href="/wiki/categories">분류</Link><Link href="/wiki/new">새 문서</Link><Link href="/wiki/settings">내보내기</Link><Link className="wiki-nav-back" href="/">기존 사이트로</Link></nav>
      <form className="wiki-search" action="/wiki/search"><input name="q" placeholder="여기에서 검색" aria-label="위키 검색" /><button type="submit" aria-label="검색">⌕</button></form>
    </div></header>
    {children}
  </>;
}
