import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  // 미들웨어가 쿠키를 관리하도록 설정
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // Clear bad auth cookies if refresh token is missing/invalid.
  if (error?.code === 'refresh_token_not_found' || error?.message?.includes('Refresh Token Not Found')) {
    await supabase.auth.signOut();
  }

  // 로그인 안 한 사람이 메인('/') 접근 시 -> 로그인 페이지로
  if (!session && req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 로그인 한 사람이 로그인 페이지('/login') 접근 시 -> 메인으로
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/', '/login'],
};
