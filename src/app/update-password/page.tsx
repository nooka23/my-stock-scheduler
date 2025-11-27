'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClientComponentClient();
  const router = useRouter();

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-96">
        <h1 className="text-2xl font-bold text-center text-blue-800 mb-6">새 비밀번호 설정</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">
          새로 사용할 비밀번호를 입력해주세요.
        </p>
        
        <form onSubmit={handleUpdate} className="flex flex-col gap-4">
          <input
            type="password"
            placeholder="새 비밀번호 (6자리 이상)"
            className="border p-3 rounded-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button 
            type="submit" 
            disabled={loading}
            className="bg-green-600 text-white p-3 rounded-lg font-bold hover:bg-green-700 disabled:bg-gray-400"
          >
            {loading ? '변경 중...' : '비밀번호 변경하기'}
          </button>
        </form>
      </div>
    </div>
  );
}