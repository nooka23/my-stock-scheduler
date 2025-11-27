'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUpMode) {
      // [회원가입 로직]
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        alert(`가입 실패: ${error.message}`);
      } else {
        // 가입은 성공했지만, 승인 대기 상태임
        alert("가입 신청이 완료되었습니다!\n관리자 승인 후 로그인할 수 있습니다.");
        setIsSignUpMode(false); // 로그인 화면으로 전환
      }
    } else {
      // [로그인 로직]
      // 1. 일단 아이디/비번으로 로그인 시도
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert('로그인 실패: 정보를 확인하세요.');
        setLoading(false);
        return;
      }

      // 2. ★ 승인 여부 확인 (profiles 테이블 조회)
      if (data.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_approved')
          .eq('id', data.user.id)
          .single();

        // 3. 승인되지 않았다면? -> 강제 로그아웃 시키고 쫓아냄
        if (profile && !profile.is_approved) {
          await supabase.auth.signOut(); // 로그아웃 처리
          alert("🚫 아직 승인되지 않은 계정입니다.\n관리자에게 문의하세요.");
        } else {
          // 승인된 유저라면 -> 통과
          router.push('/');
          router.refresh();
        }
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-96">
        <h1 className="text-2xl font-bold text-center text-blue-800 mb-6">
          {isSignUpMode ? "회원가입 신청" : "로그인"}
        </h1>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="이메일"
            className="border p-3 rounded-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="비밀번호 (6자리 이상)"
            className="border p-3 rounded-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button 
            type="submit" 
            disabled={loading}
            className={`text-white p-3 rounded-lg font-bold hover:opacity-90 disabled:bg-gray-400 ${isSignUpMode ? 'bg-green-600' : 'bg-blue-600'}`}
          >
            {loading ? '처리 중...' : (isSignUpMode ? '가입 신청하기' : '로그인')}
          </button>
        </form>
        
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-600">
            {isSignUpMode ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"}
          </p>
          <button 
            onClick={() => setIsSignUpMode(!isSignUpMode)}
            className="text-sm font-bold text-blue-600 hover:underline mt-1"
          >
            {isSignUpMode ? "로그인하러 가기" : "회원가입 신청"}
          </button>
        </div>

        <button onClick={() => router.push('/')} className="w-full mt-6 text-xs text-gray-400 hover:text-gray-600 border-t pt-4">
          메인으로 돌아가기
        </button>
      </div>
    </div>
  );
}