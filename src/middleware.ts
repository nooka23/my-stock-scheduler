// src/middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // 현재 로그인된 유저가 있는지 확인
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 로그인 안 했는데 메인 페이지('/')로 오면 -> 로그인 페이지로 튕겨내기
  if (!session && req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 로그인 했는데 로그인 페이지로 오면 -> 메인으로 보내기 (편의성)
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return res;
}

// 이 미들웨어가 작동할 주소 설정
export const config = {
  matcher: ['/', '/login'],
};