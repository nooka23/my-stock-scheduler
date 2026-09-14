-- Remove manual section numbers from the untouched stock template. The reader
-- already supplies outline numbering, so storing it in every heading is noisy.

with updated_documents as (
  update public.wiki_documents
  set content = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(content, '{content,0,content,0,text}', '"한 줄 정리"'::jsonb),
                  '{content,2,content,0,text}', '"기업 개요"'::jsonb),
                '{content,7,content,0,text}', '"경쟁 구도"'::jsonb),
              '{content,9,content,0,text}', '"밸류체인"'::jsonb),
            '{content,14,content,0,text}', '"실적"'::jsonb),
          '{content,16,content,0,text}', '"차트"'::jsonb),
        '{content,18,content,0,text}', '"투자 포인트"'::jsonb),
      '{content,20,content,0,text}', '"리스크"'::jsonb),
    '{content,22,content,0,text}', '"Check List"'::jsonb),
  content_text = '한 줄 정리 기업 개요 사업 구조 주요 제품 / 서비스 경쟁 구도 밸류체인 주요 고객 공급사 / 밸류체인 실적 차트 투자 포인트 리스크 Check List',
  revision = revision + 1,
  updated_at = now()
  where company_sync_enabled = true
    and content_text = '0. 한 줄 정리 1. 기업 개요 사업 구조 주요 제품 / 서비스 2. 경쟁 구도 3. 밸류체인 주요 고객 공급사 / 밸류체인 4. 실적 5. 차트 6. 투자 포인트 7. 리스크 8. Check List'
  returning *
)
insert into public.wiki_revisions (
  document_id, revision, title, content, ticker_code, categories, author_id, mutation_id
)
select
  id, revision, title, content, ticker_code, categories, owner_id, gen_random_uuid()
from updated_documents;
