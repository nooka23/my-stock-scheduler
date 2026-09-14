-- Add the initial analysis outline only to untouched documents that were
-- generated from COMMON securities. Handwritten and already edited documents
-- are intentionally left alone.

with updated_documents as (
  update public.wiki_documents
  set content = '{
    "type":"doc",
    "content":[
      {"type":"heading","attrs":{"level":2,"id":"stock-section-0"},"content":[{"type":"text","text":"0. 한 줄 정리"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-1"},"content":[{"type":"text","text":"1. 기업 개요"}]},
      {"type":"heading","attrs":{"level":3,"id":"stock-business-model"},"content":[{"type":"text","text":"사업 구조"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":3,"id":"stock-products"},"content":[{"type":"text","text":"주요 제품 / 서비스"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-2"},"content":[{"type":"text","text":"2. 경쟁 구도"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-3"},"content":[{"type":"text","text":"3. 밸류체인"}]},
      {"type":"heading","attrs":{"level":3,"id":"stock-customers"},"content":[{"type":"text","text":"주요 고객"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":3,"id":"stock-suppliers"},"content":[{"type":"text","text":"공급사 / 밸류체인"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-4"},"content":[{"type":"text","text":"4. 실적"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-5"},"content":[{"type":"text","text":"5. 차트"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-6"},"content":[{"type":"text","text":"6. 투자 포인트"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-7"},"content":[{"type":"text","text":"7. 리스크"}]},
      {"type":"paragraph"},
      {"type":"heading","attrs":{"level":2,"id":"stock-section-8"},"content":[{"type":"text","text":"8. Check List"}]},
      {"type":"paragraph"}
    ]
  }'::jsonb,
  content_text = '0. 한 줄 정리 1. 기업 개요 사업 구조 주요 제품 / 서비스 2. 경쟁 구도 3. 밸류체인 주요 고객 공급사 / 밸류체인 4. 실적 5. 차트 6. 투자 포인트 7. 리스크 8. Check List',
  revision = revision + 1,
  updated_at = now()
  where company_sync_enabled = true
    and content = '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
    and content_text = ''
  returning *
)
insert into public.wiki_revisions (
  document_id, revision, title, content, ticker_code, categories, author_id, mutation_id
)
select
  id, revision, title, content, ticker_code, categories, owner_id, gen_random_uuid()
from updated_documents;
