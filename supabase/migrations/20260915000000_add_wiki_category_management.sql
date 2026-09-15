create or replace function public.wiki_list_categories()
returns table(category text, document_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select categories.category, count(*)::bigint as document_count
  from (
    select distinct d.id, btrim(value) as category
    from public.wiki_documents d
    cross join lateral unnest(d.categories) as category_values(value)
    where public.wiki_is_owner()
      and d.owner_id = auth.uid()
      and btrim(value) <> ''
  ) categories
  group by categories.category
  order by lower(categories.category), categories.category;
$$;

create or replace function public.wiki_add_category_to_documents(
  p_category text,
  p_document_ids uuid[],
  p_mutation_id uuid default gen_random_uuid()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text := btrim(p_category);
  v_document_id uuid;
  v_document public.wiki_documents;
  v_updated_count integer := 0;
  v_requested_count integer;
begin
  if not public.wiki_is_owner() then
    raise exception 'wiki_access_denied' using errcode = '42501';
  end if;
  if v_category = '' or char_length(v_category) > 80 then
    raise exception 'wiki_category_invalid' using errcode = '22023';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) = 0 then
    raise exception 'wiki_documents_required' using errcode = '22023';
  end if;
  if p_mutation_id is null then
    raise exception 'wiki_mutation_id_required' using errcode = '22023';
  end if;

  select count(distinct requested.id)::integer into v_requested_count
  from unnest(p_document_ids) as requested(id);
  if v_requested_count <> cardinality(p_document_ids) then
    raise exception 'wiki_duplicate_documents' using errcode = '22023';
  end if;

  -- Validate the whole selection first so a bad or unauthorized id cannot
  -- leave only part of a batch applied.
  if (select count(*) from public.wiki_documents d
      where d.id = any(p_document_ids) and d.owner_id = auth.uid()) <> v_requested_count then
    raise exception 'wiki_document_not_found' using errcode = 'P0002';
  end if;

  -- A deterministic lock order avoids deadlocks when requests overlap.
  for v_document_id in
    select requested.id from unnest(p_document_ids) as requested(id) order by requested.id
  loop
    select * into v_document
    from public.wiki_documents d
    where d.id = v_document_id and d.owner_id = auth.uid()
    for update;

    -- A response-lost retry with the same mutation id is a no-op.
    if exists (
      select 1 from public.wiki_revisions r
      where r.document_id = v_document.id and r.mutation_id = p_mutation_id
    ) then
      continue;
    end if;

    if v_category = any(coalesce(v_document.categories, '{}'::text[])) then
      continue;
    end if;

    update public.wiki_documents
    set categories = array_append(coalesce(categories, '{}'::text[]), v_category),
        revision = revision + 1,
        updated_at = now()
    where id = v_document.id
    returning * into v_document;

    insert into public.wiki_revisions (
      document_id, revision, title, content, ticker_code, categories,
      author_id, mutation_id
    ) values (
      v_document.id, v_document.revision, v_document.title, v_document.content,
      v_document.ticker_code, v_document.categories, auth.uid(), p_mutation_id
    );
    v_updated_count := v_updated_count + 1;
  end loop;

  return v_updated_count;
end;
$$;

revoke all on function public.wiki_list_categories() from public;
revoke all on function public.wiki_add_category_to_documents(text, uuid[], uuid) from public;
grant execute on function public.wiki_list_categories() to authenticated;
grant execute on function public.wiki_add_category_to_documents(text, uuid[], uuid) to authenticated;
