'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const supabase = createClientComponentClient();
  const router = useRouter();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // 중요: 이메일 링크를 누르면 이동할 주소 (비밀번호 변경 페이지)
      redirectTo: `${location.origin}/update-password`,
    });

    if (error) {
      alert(`에러 발생: ${error.message}`);
    } else {
      alert("이메일로 비밀번호 재설정 링크를 보냈습니다.\n메일함을 확인해주세요!");
      router.push('/login'); // 로그인 페이지로 이동
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-96">
        <h1 className="text-2xl font-bold text-center text-blue-800 mb-6">비밀번호 찾기</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">
          가입한 이메일을 입력하시면<br/>재설정 링크를 보내드립니다.
        </p>
        
        <form onSubmit={handleReset} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="이메일 입력"
            className="border p-3 rounded-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button 
            type="submit" 
            disabled={loading}
            className="bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? '전송 중...' : '링크 보내기'}
          </button>
        </form>
        
        <button 
          onClick={() => router.push('/login')}
          className="w-full mt-4 text-sm text-gray-500 hover:underline"
        >
          로그인으로 돌아가기
        </button>
      </div>
    </div>
  );
}