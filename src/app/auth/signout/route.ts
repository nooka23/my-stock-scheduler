// src/app/auth/signout/route.ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  // 1. 서버 측에서 세션 삭제 (쿠키 파괴)
  await supabase.auth.signOut();

  // 2. 로그인 페이지로 강제 이동 명령
  return NextResponse.redirect(new URL('/login', req.url), {
    status: 302,
  });
}