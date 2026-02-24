'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState(''); // 닉네임 상태
  const [loading, setLoading] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false); // 로그인/회원가입 모드 전환

  // ★ 쿠키를 자동으로 처리해주는 Supabase 클라이언트
  const supabase = createClientComponentClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUpMode) {
      // ----------------------------------------------------
      // [회원가입 로직]
      // ----------------------------------------------------
      if (!nickname) {
        alert("닉네임을 입력해주세요!");
        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        alert('Passwords do not match.');
        setLoading(false);
        return;
      }
      // 1. 회원가입 시도
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // 이메일 확인 링크 클릭 시 돌아올 주소 (이메일 인증을 켰을 경우 대비)
          emailRedirectTo: `${location.origin}/auth/callback`,
        },
      });

      if (error) {
        alert(`가입 실패: ${error.message}`);
      } else {
        // 2. 가입 성공 시 'profiles' 테이블에 닉네임 업데이트
        if (data.user) {
          const { error: profileError } = await supabase
            .from('profiles')
            .update({ nickname: nickname })
            .eq('id', data.user.id);

          if (profileError) {
            console.error("닉네임 저장 중 오류 발생:", profileError);
          }
        }

        alert("가입 신청이 완료되었습니다!\n관리자 승인 후 로그인할 수 있습니다.");
        
        // 가입 후 로그인 모드로 전환 및 입력창 초기화
        setIsSignUpMode(false);
        setNickname('');
        setPassword('');

        setConfirmPassword('');
      }

    } else {
      // ----------------------------------------------------
      // [로그인 로직]
      // ----------------------------------------------------
      
      // 1. 로그인 시도 (쿠키 생성)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert('로그인 실패: 아이디나 비밀번호를 확인하세요.');
        setLoading(false);
        return;
      }

      // 2. 승인 여부 확인 (profiles 테이블 조회)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('is_approved')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error("프로필 조회 에러:", profileError);
      }

      // 3. 미승인 계정이면 강제 로그아웃
      if (profile && !profile.is_approved) {
        await supabase.auth.signOut(); // 쿠키 삭제
        alert("🚫 아직 승인되지 않은 계정입니다.\n관리자에게 문의하세요.");
      } else {
        // 4. 승인된 계정이면 메인으로 이동
        alert("✅ 로그인 성공! 환영합니다.");
        router.refresh(); // 미들웨어에게 쿠키 갱신 알림
        router.push('/'); 
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
          {isSignUpMode && (
            <input
              type="password"
              placeholder="Confirm password"
              className="border p-3 rounded-lg"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          )}
          
          {/* ★ 회원가입 모드일 때만 닉네임 입력창 표시 */}
          {isSignUpMode && (
            <input
              type="text"
              placeholder="사용할 닉네임 (예: 김주식)"
              className="border p-3 rounded-lg bg-blue-50 focus:bg-white transition-colors"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
          )}

          <button 
            type="submit" 
            disabled={loading}
            className={`text-white p-3 rounded-lg font-bold hover:opacity-90 disabled:bg-gray-400 transition-colors ${isSignUpMode ? 'bg-green-600' : 'bg-blue-600'}`}
          >
            {loading ? '처리 중...' : (isSignUpMode ? '가입 신청하기' : '로그인')}
          </button>
        </form>
        
        {/* 비밀번호 찾기 링크 (로그인 모드일 때만 표시) */}
        {!isSignUpMode && (
          <div className="text-right mt-2">
            <button 
              onClick={() => router.push('/forgot-password')}
              className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
        )}

        {/* 모드 전환 (로그인 <-> 회원가입) */}
        <div className="mt-6 text-center pt-4 border-t">
          <p className="text-sm text-gray-600 mb-1">
            {isSignUpMode ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"}
          </p>
          <button 
            onClick={() => {
              setIsSignUpMode(!isSignUpMode);
              setNickname(''); // 모드 전환 시 닉네임 초기화
              setEmail('');
              setPassword('');

              setConfirmPassword('');
            }}
            className="text-sm font-bold text-blue-600 hover:underline"
          >
            {isSignUpMode ? "로그인하러 가기" : "회원가입 신청하기"}
          </button>
        </div>

      </div>
    </div>
  );
}