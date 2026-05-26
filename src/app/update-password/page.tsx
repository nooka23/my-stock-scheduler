'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClientComponentClient();
  const router = useRouter();

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (password !== confirmPassword) {
      alert('비밀번호가 일치하지 않습니다. 다시 확인해주세요.');
      setLoading(false);
      return;
    }

    // ★ 현재 로그인된 유저의 비밀번호를 업데이트함
    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      alert(`변경 실패: ${error.message}`);
    } else {
      alert("비밀번호가 성공적으로 변경되었습니다!\n메인 화면으로 이동합니다.");
      router.refresh();
      router.push('/');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="app-card-strong w-full max-w-md p-8">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
          Security Settings
        </p>
        <h1 className="mb-6 mt-2 text-center text-3xl font-semibold text-slate-950">
          새 비밀번호 설정
        </h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          안전을 위해 새로 사용할 비밀번호를 두 번 입력해주세요.
        </p>
        
        <form onSubmit={handleUpdate} className="flex flex-col gap-4">
          <input
            type="password"
            placeholder="새 비밀번호 (6자리 이상)"
            className="app-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <input
            type="password"
            placeholder="새 비밀번호 확인"
            className="app-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
          <button 
            type="submit" 
            disabled={loading}
            className="rounded-2xl p-3 font-semibold text-white transition-colors hover:opacity-90 disabled:bg-gray-400 bg-slate-950 mt-2"
          >
            {loading ? '변경 중...' : '비밀번호 변경하기'}
          </button>
        </form>
      </div>
    </div>
  );
}