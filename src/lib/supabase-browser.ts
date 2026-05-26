// src/lib/supabase-browser.ts
//
// 브라우저(클라이언트 컴포넌트)에서 사용하는 Supabase 클라이언트 래퍼.
// ngrok 무료 버전이 브라우저 요청에 경고 페이지를 보여주는 문제를 우회하기 위해
// 'ngrok-skip-browser-warning' 헤더를 자동으로 추가한다.
//
// 기존에 '@supabase/auth-helpers-nextjs'에서 직접 import하던 것을
// 이 파일에서 import하도록 변경한다.

import { createClientComponentClient as _createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export function createClientComponentClient() {
  return _createClientComponentClient({
    options: {
      global: {
        headers: {
          'ngrok-skip-browser-warning': 'true',
        },
      },
    },
  });
}
