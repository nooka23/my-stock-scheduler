'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@/lib/supabase-browser';

export default function WikiAccessBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking');

  useEffect(() => {
    let active = true;
    const verify = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const { data, error } = await supabase.rpc('wiki_is_owner');
      if (!active) return;
      if (error || data !== true) {
        setState('denied');
        window.setTimeout(() => router.replace('/'), 700);
        return;
      }
      setState('allowed');
    };
    verify();
    return () => { active = false; };
  }, [router, supabase]);

  if (state === 'checking') return <main className="wiki-status">위키 접근 권한을 확인하는 중…</main>;
  if (state === 'denied') return <main className="wiki-status">이 위키는 지정된 계정만 사용할 수 있습니다.</main>;
  return <>{children}</>;
}
