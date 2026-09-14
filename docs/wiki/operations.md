# 개인 위키 운영 적용 안내

이 문서는 구현이 저장소에 반영된 뒤 실제 운영 환경에 적용할 때 사용한다. 2026-09-14에 로컬 Supabase DB에 위키 마이그레이션을 적용했고 `mhoon@ibinvest.co.kr`의 Auth UUID를 유일한 소유자로 등록했다. UUID 자체는 진행 기록에 보존하지 않는다.

## 1. 적용 순서

1. 기존 DB와 Storage 백업이 최근 성공본인지 확인한다.
2. `supabase/migrations/20260914000000_create_personal_wiki.sql`과 `supabase/migrations/20260914010000_sync_common_company_wiki_documents.sql`을 순서대로 평소의 Supabase 마이그레이션 절차로 적용한다. 두 번째 마이그레이션은 보통주(`security_type = 'COMMON'`) 문서를 생성하고 이후 `companies`의 종목명 변경을 자동 동기화한다.
3. 신뢰할 수 있는 관리자 SQL 세션에서, 실제 본인 Auth UUID 한 개만 등록한다.

```sql
insert into public.wiki_access (singleton, owner_user_id)
values (true, '<본인 Auth UUID>');
```

이 UUID는 이메일이나 `profiles.is_admin` 값으로 대체하지 않는다. 이 테이블은 일반 브라우저 역할에 권한을 주지 않으며, `wiki_is_owner()` 함수가 모든 문서·첨부 접근의 공통 검사다.

## 2. 적용 직후 확인

- 본인 계정: `/wiki` 진입, 새 문서 작성, 이미지 업로드, 저장 후 새 기기에서 열기.
- 비로그인: `/wiki`가 로그인으로 이동하고 `/api/wiki/attachments/<id>`는 401을 반환하는지 확인.
- 다른 승인 사용자와 다른 관리자: `/wiki`가 기존 사이트로 돌아가며, 문서·검색·이력·첨부 API가 데이터를 반환하지 않는지 확인.
- 이미지 URL을 복사한 상태: 소유자 이외 계정에서 표시되지 않는지 확인.
- 종목 마스터: 보통주 수와 종목코드가 연결된 위키 문서 수가 일치하는지 확인한다. 제목을 직접 바꾼 문서가 이후 회사명 갱신으로 덮어써지지 않는지도 확인한다.

## 3. 복구와 내보내기

`/wiki/settings`의 내보내기는 문서 JSON·Markdown·이력 JSON·첨부 원본·manifest를 ZIP으로 내려받는다. 서버 DB 백업과 Storage 파일 백업은 한 복구본으로 함께 보관한다. 외장 하드가 준비되면 기존 서버 백업의 추가 복사본에 이 ZIP과 DB·Storage 백업을 포함하고, 격리 환경에서 복원 시험을 한다.

운영 DB에 복원 스크립트를 시험 실행하지 않는다. 기존 인프라의 별도 복원 절차를 사용한다.
