'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { User } from '@supabase/supabase-js';

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClientComponentClient();
  
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Hide sidebar on auth pages logic (Moved hook logic below, but return check later)
  const authPaths = ['/login', '/forgot-password', '/update-password'];
  const isAuthPage = authPaths.some(path => pathname.startsWith(path));

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
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    localStorage.clear();
    sessionStorage.clear();
    router.push('/login?t=' + Date.now());
  };

  // If it's an auth page, return null AFTER all hooks are defined
  if (isAuthPage) {
    return null;
  }

  const navItems = [
    { name: '스케줄러', href: '/', icon: '🗓️' },
    { name: '밴드 차트', href: '/chart', icon: '📊' },
    { name: '종목 발굴', href: '/discovery', icon: '🔍' },
    { name: '관심 종목', href: '/favorites', icon: '⭐' },
  ];

  const adminItems = [
    { name: '관리자 홈', href: '/admin', icon: '⚙️' },
    { name: '분석(Admin)', href: '/admin/chart', icon: '📈' },
  ];

  return (
    <aside 
      className={`
        flex flex-col h-screen bg-gray-100 border-r border-gray-200 transition-all duration-300
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-gray-200 h-16">
        {!isCollapsed && <span className="font-bold text-xl text-blue-800">Stock App</span>}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded hover:bg-gray-200 text-gray-500"
        >
          {isCollapsed ? (
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="3" y1="12" x2="21" y2="12"></line>
               <line x1="3" y1="6" x2="21" y2="6"></line>
               <line x1="3" y1="18" x2="21" y2="18"></line>
             </svg>
          ) : (
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <polyline points="11 17 6 12 11 7"></polyline>
               <polyline points="18 17 13 12 18 7"></polyline>
             </svg>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link 
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-md transition-colors
                    ${isActive ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'}
                  `}
                >
                  <span className="text-xl">{item.icon}</span>
                  {!isCollapsed && <span className="font-medium">{item.name}</span>}
                </Link>
              </li>
            );
          })}

          {profile?.is_admin && (
            <>
              <div className="my-4 border-t border-gray-300 mx-2"></div>
              {!isCollapsed && <div className="px-3 mb-2 text-xs font-bold text-gray-400 uppercase">Admin</div>}
              {adminItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link 
                      href={item.href}
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-md transition-colors
                        ${isActive ? 'bg-purple-50 text-purple-700 shadow-sm' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'}
                      `}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {!isCollapsed && <span className="font-medium">{item.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      </nav>

      {/* User Profile / Footer */}
      {user && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {profile?.nickname?.[0] || user.email?.[0]?.toUpperCase()}
            </div>
            
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {profile?.nickname || user.email?.split('@')[0]}
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            )}
          </div>
          
          {!isCollapsed && (
            <button 
              onClick={handleLogout}
              className="mt-3 w-full py-1.5 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded border border-gray-200 transition-colors"
            >
              로그아웃
            </button>
          )}
        </div>
      )}
    </aside>
  );
}