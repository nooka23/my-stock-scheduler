'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClientComponentClient } from '@/lib/supabase-browser';
import { User } from '@supabase/supabase-js';
import styles from './SiteNavigation.module.css';

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

type NavItem = {
  name: string;
  href: string;
  icon: keyof typeof iconMap;
  subItems?: { name: string; href: string }[];
};

const iconMap = {
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M4 19h16" />
      <path d="M7 16V9M12 16V5M17 16v-3" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M4 16l5-5 4 4 7-8" />
      <path d="M14 7h6v6" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9Z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  ),
  game: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <rect x="3" y="8" width="18" height="10" rx="4" />
      <path d="M8 12h4M10 10v4M16.5 11.5h.01M18.5 14.5h.01" />
    </svg>
  ),
} as const;

const navItems: NavItem[] = [
  { name: '스케줄러', href: '/', icon: 'calendar' },
  { name: '데일리 리뷰', href: '/daily-review', icon: 'trend' },
  { name: '기업 분석', href: '/chart', icon: 'chart' },
  {
    name: '종목 발굴',
    href: '/discovery',
    icon: 'search',
    subItems: [
      { name: 'RS', href: '/discovery/rs' },
      { name: '시총 TOP 100', href: '/discovery/cap' },
      { name: '거래대금', href: '/discovery/volume' },
    ],
  },
  { name: '지수', href: '/market-index', icon: 'trend' },
  { name: '관심 종목', href: '/favorites', icon: 'star' },
];

const adminItems: NavItem[] = [
  { name: '관리자 홈', href: '/admin', icon: 'settings' },
  { name: '차트 게임', href: '/admin/game', icon: 'game' },
  { name: '시장 지수', href: '/admin/index', icon: 'trend' },
  {
    name: 'MH 분석',
    href: '/admin/MH',
    icon: 'chart',
    subItems: [
      { name: '차트 분석', href: '/admin/MH/chart' },
      { name: '2차 필터링', href: '/admin/MH/volume' },
      { name: '업종 지수 관리', href: '/admin/MH/index' },
      { name: '포트폴리오 관리', href: '/admin/MH/portfolio' },
    ],
  },
];

const isItemActive = (pathname: string, item: NavItem) =>
  pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));

const destination = (item: NavItem) => item.subItems?.[0].href ?? item.href;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [isWikiOwner, setIsWikiOwner] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const adminRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobilePreview = pathname === '/daily-review/mobile';
  const isAuthPage = ['/login', '/forgot-password', '/update-password'].some(path => pathname.startsWith(path));
  const isMobileOnlyPage = pathname === '/m' || pathname.startsWith('/m/');

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    async function loadProfile(currentUser: User | null) {
      const request = ++generation;
      setUser(currentUser);
      setProfile(null);
      setIsWikiOwner(false);
      if (!currentUser) return;
      const [profileResult, ownerResult] = await Promise.all([
        supabase.from('profiles').select('nickname, is_admin').eq('id', currentUser.id).single(),
        supabase.rpc('wiki_is_owner'),
      ]);
      if (cancelled || generation !== request) return;
      setProfile(profileResult.data as MyProfile | null);
      setIsWikiOwner(ownerResult.data === true);
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer Supabase queries until the auth callback has released its lock.
      window.setTimeout(() => { if (!cancelled) void loadProfile(session?.user ?? null); }, 0);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    function dismiss(event: MouseEvent | KeyboardEvent) {
      for (const ref of [adminRef, accountRef]) {
        if (event instanceof KeyboardEvent) {
          if (event.key === 'Escape' && ref.current?.open) {
            ref.current.open = false;
            ref.current.querySelector('summary')?.focus();
          }
        } else if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) {
          ref.current.open = false;
        }
      }
    }
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => { document.removeEventListener('click', dismiss); document.removeEventListener('keydown', dismiss); };
  }, []);

  function closeMenus() {
    menuRef.current?.close();
    setMenuOpen(false);
    if (adminRef.current) adminRef.current.open = false;
    if (accountRef.current) accountRef.current.open = false;
  }

  function openMenu() {
    menuRef.current?.showModal();
    setMenuOpen(true);
  }

  async function handleLogout() {
    closeMenus();
    await supabase.auth.signOut();
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '').replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`);
    });
    localStorage.clear();
    sessionStorage.clear();
    router.push(`/login?t=${Date.now()}`);
  }

  const visibleNavItems = useMemo(() => isWikiOwner
    ? [...navItems, { name: '개인 위키', href: '/wiki', icon: 'star' as const }]
    : navItems, [isWikiOwner]);
  const visibleAdminItems = profile?.is_admin ? adminItems : [];
  const activeItem = [...visibleNavItems, ...visibleAdminItems]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => isItemActive(pathname, item));
  const isAdminSection = pathname.startsWith('/admin');
  const displayName = profile?.nickname || user?.email?.split('@')[0] || '내 계정';

  if (isAuthPage || isMobileOnlyPage) return null;

  return (
    <header className={`${styles.header} ${isMobilePreview ? styles.mobilePreview : ''}`}>
      <div className={styles.topRow}>
        <Link href="/" className={styles.brand} onClick={closeMenus} aria-label="My Stock Scheduler 홈">
          <span className={styles.brandMark} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 16V9m7 7V5m7 11v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M4 20h16" stroke="currentColor" strokeOpacity=".4" /></svg></span>
          <span><strong>My Stock</strong><small>RESEARCH WORKSPACE</small></span>
        </Link>

        <nav className={styles.desktopNav} aria-label="주 메뉴">
          {visibleNavItems.map(item => (
            <Link key={item.href} href={destination(item)} onClick={closeMenus} aria-current={isItemActive(pathname, item) ? 'page' : undefined}>
              {item.name}
            </Link>
          ))}
        </nav>

        <div className={styles.desktopActions}>
          {visibleAdminItems.length > 0 && (
            <details ref={adminRef} className={styles.dropdown}>
              <summary className={isAdminSection ? styles.adminActive : ''}>{iconMap.settings}<span>관리</span><span className={styles.chevron}>⌄</span></summary>
              <nav className={styles.dropdownPanel} aria-label="관리자 메뉴">
                <p>ADMIN WORKSPACE</p>
                {visibleAdminItems.map(item => (
                  <div key={item.href}>
                    <Link href={destination(item)} onClick={closeMenus} aria-current={isItemActive(pathname, item) ? 'page' : undefined}>{iconMap[item.icon]}{item.name}</Link>
                    {item.subItems?.map(sub => <Link key={sub.href} className={styles.subLink} href={sub.href} onClick={closeMenus} aria-current={pathname === sub.href ? 'page' : undefined}>{sub.name}</Link>)}
                  </div>
                ))}
              </nav>
            </details>
          )}
          {user ? (
            <details ref={accountRef} className={styles.dropdown}>
              <summary aria-label="내 계정 메뉴"><span className={styles.avatar}>{displayName[0].toUpperCase()}</span><span className={styles.chevron}>⌄</span></summary>
              <div className={styles.dropdownPanel}>
                <div className={styles.accountInfo}><strong>{displayName}</strong><small>{user.email}</small></div>
                <Link href="/update-password" onClick={closeMenus}>비밀번호 변경</Link>
                <button type="button" onClick={handleLogout}>로그아웃</button>
              </div>
            </details>
          ) : <Link href="/login" className={styles.login}>로그인 ↗</Link>}
        </div>
        <span className={styles.mobilePageName}>{activeItem?.name ?? 'My Stock'}</span>
      </div>

      <nav className={styles.mobileNav} aria-label="모바일 주 메뉴">
        {navItems.slice(0, 3).map(item => <Link key={item.href} href={destination(item)} onClick={closeMenus} aria-current={isItemActive(pathname, item) ? 'page' : undefined}>{iconMap[item.icon]}<span>{item.name}</span></Link>)}
        <button type="button" ref={menuButtonRef} aria-haspopup="dialog" aria-controls="site-navigation-menu" aria-expanded={menuOpen} onClick={openMenu} className={activeItem && !navItems.slice(0, 3).includes(activeItem) ? styles.moreActive : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14" /></svg><span>전체 메뉴</span>
        </button>
      </nav>

      {activeItem?.subItems && <nav className={styles.subNav} aria-label={`${activeItem.name} 하위 메뉴`}><span>{activeItem.name}</span>{activeItem.subItems.map(sub => <Link key={sub.href} href={sub.href} aria-current={pathname === sub.href ? 'page' : undefined} onClick={closeMenus}>{sub.name}</Link>)}</nav>}

      <dialog ref={menuRef} id="site-navigation-menu" className={styles.menuDialog} aria-labelledby="site-menu-title" onClose={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) closeMenus(); }}>
        <div className={styles.menuBody}>
          <div className={styles.menuHeading}><div><small>MY STOCK WORKSPACE</small><h2 id="site-menu-title">전체 메뉴</h2></div><button type="button" aria-label="전체 메뉴 닫기" onClick={closeMenus}>✕</button></div>
          <nav className={styles.menuGrid} aria-label="전체 서비스">
            {visibleNavItems.map(item => <Link key={item.href} href={destination(item)} onClick={closeMenus} aria-current={isItemActive(pathname, item) ? 'page' : undefined}>{iconMap[item.icon]}<span>{item.name}</span><span aria-hidden="true">↗</span></Link>)}
          </nav>
          <div className={styles.discoveryLinks}><span>종목 발굴</span>{navItems.find(item => item.href === '/discovery')?.subItems?.map(sub => <Link key={sub.href} href={sub.href} onClick={closeMenus}>{sub.name}</Link>)}</div>
          {visibleAdminItems.length > 0 && <nav className={styles.mobileAdmin} aria-label="모바일 관리자 메뉴"><h3>관리자 작업공간</h3>{visibleAdminItems.map(item => <div key={item.href}><Link href={destination(item)} onClick={closeMenus}>{item.name} ↗</Link>{item.subItems && <div>{item.subItems.map(sub => <Link key={sub.href} href={sub.href} onClick={closeMenus}>{sub.name}</Link>)}</div>}</div>)}</nav>}
          <div className={styles.mobileAccount}>{user ? <><span>{displayName}</span><Link href="/update-password" onClick={closeMenus}>비밀번호 변경</Link><button type="button" onClick={handleLogout}>로그아웃</button></> : <><span>계정으로 이어서 사용하세요</span><Link href="/login" onClick={closeMenus}>로그인 ↗</Link></>}</div>
        </div>
      </dialog>
    </header>
  );
}
