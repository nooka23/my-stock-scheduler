'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { User } from '@supabase/supabase-js';

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
  { name: '밴드 차트', href: '/chart', icon: 'chart' },
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
  pathname === item.href || (item.subItems ? pathname.startsWith(item.href) : false);

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClientComponentClient();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const authPaths = ['/login', '/forgot-password', '/update-password'];
  const isAuthPage = authPaths.some((path) => pathname.startsWith(path));
  const isMobileOnlyPage = pathname === '/m' || pathname.startsWith('/m/');

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const { data } = await supabase
          .from('profiles')
          .select('nickname, is_admin')
          .eq('id', session.user.id)
          .single();
        if (data) setProfile(data as MyProfile);
      }
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    document.cookie.split(';').forEach((c) => {
      document.cookie = c.replace(/^ +/, '').replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`);
    });
    localStorage.clear();
    sessionStorage.clear();
    router.push(`/login?t=${Date.now()}`);
  };

  const visibleAdminItems = useMemo(() => (profile?.is_admin ? adminItems : []), [profile?.is_admin]);

  const activeItem = useMemo(() => {
    return [...navItems, ...visibleAdminItems].find((item) => isItemActive(pathname, item)) ?? null;
  }, [pathname, visibleAdminItems]);

  if (isAuthPage || isMobileOnlyPage) {
    return null;
  }

  return (
    <header className="border-b border-[var(--border)] bg-[rgba(255,255,255,0.9)] backdrop-blur-md">
      <div className="flex items-center gap-4 px-4 py-3 lg:px-8">
        <Link href="/" className="shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
            Research OS
          </p>
          <div className="mt-1 text-lg font-semibold text-slate-950">My Stock Scheduler</div>
        </Link>

        <nav className="min-w-0 flex-1 overflow-x-auto">
          <ul className="flex min-w-max items-center gap-2">
            {navItems.map((item) => {
              const isActive = isItemActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.subItems ? item.subItems[0].href : item.href}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-[var(--primary-soft)] bg-[var(--surface-accent)] text-[var(--primary-strong)]'
                        : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:bg-[var(--surface-muted)] hover:text-slate-900'
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full ${
                      isActive ? 'bg-white text-[var(--primary-strong)]' : 'bg-[var(--surface-muted)] text-[var(--text-muted)]'
                    }`}>
                      {iconMap[item.icon]}
                    </span>
                    <span>{item.name}</span>
                  </Link>
                </li>
              );
            })}

            {visibleAdminItems.length > 0 && (
              <>
                <li className="mx-2 h-5 w-px bg-[var(--border)]" />
                {visibleAdminItems.map((item) => {
                  const isActive = isItemActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.subItems ? item.subItems[0].href : item.href}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:bg-[var(--surface-muted)] hover:text-slate-900'
                        }`}
                      >
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          isActive ? 'bg-white text-amber-700' : 'bg-[var(--surface-muted)] text-[var(--text-muted)]'
                        }`}>
                          {iconMap[item.icon]}
                        </span>
                        <span>{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        </nav>

        {user && (
          <div className="hidden shrink-0 items-center gap-3 lg:flex">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {profile?.nickname?.[0] || user.email?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {profile?.nickname || user.email?.split('@')[0]}
              </p>
              <p className="truncate text-xs text-[var(--text-muted)]">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-full border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              로그아웃
            </button>
          </div>
        )}
      </div>

      {activeItem?.subItems && (
        <div className="border-t border-[var(--border)] bg-[rgba(248,250,252,0.92)] px-4 py-2 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">
              {activeItem.name}
            </span>
            {activeItem.subItems.map((sub) => {
              const isSubActive = pathname === sub.href;
              return (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    isSubActive
                      ? 'bg-white text-[var(--primary-strong)] shadow-[var(--shadow-sm)]'
                      : 'text-[var(--text-muted)] hover:bg-white hover:text-slate-900'
                  }`}
                >
                  {sub.name}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
