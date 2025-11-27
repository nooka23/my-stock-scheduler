import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  // req와 res를 둘 다 넣어줘야 쿠키가 갱신됩니다!
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 로그인 안 함 + 메인('/') 접근 -> 로그인 페이지로
  if (!session && req.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 로그인 함 + 로그인 페이지('/login') 접근 -> 메인으로
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/', '/login'],
};