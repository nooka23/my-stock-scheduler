-- Create and maintain one private wiki document for every COMMON security.
-- The company code is the stable identity. A document URL stays stable even
-- when the company display name changes.

alter table public.wiki_documents
  add column if not exists company_sync_enabled boolean not null default false,
  add column if not exists company_last_synced_name text;

create unique index if not exists wiki_documents_owner_ticker_code_idx
  on public.wiki_documents (owner_id, ticker_code)
  where ticker_code is not null;

create or replace function public.wiki_sync_common_company_document(
  p_code text,
  p_name text,
  p_security_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_document public.wiki_documents;
  v_title text;
  v_normalized_title text;
begin
  if p_security_type is distinct from 'COMMON' or nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null then
    return;
  end if;

  select owner_user_id into v_owner_id from public.wiki_access where singleton = true;
  if v_owner_id is null then
    return;
  end if;

  select * into v_document
  from public.wiki_documents
  where owner_id = v_owner_id and ticker_code = btrim(p_code)
  for update;

  if not found then
    v_title := btrim(p_name);
    v_normalized_title := lower(v_title);

    -- A hand-written non-stock document can occupy a company name. Keep both
    -- documents instead of replacing the handwritten one.
    if exists (
      select 1 from public.wiki_document_names
      where normalized_title = v_normalized_title
    ) then
      v_title := v_title || ' (' || btrim(p_code) || ')';
      v_normalized_title := lower(v_title);
    end if;

    insert into public.wiki_documents (
      owner_id, title, content, content_text, ticker_code,
      company_sync_enabled, company_last_synced_name
    ) values (
      v_owner_id, v_title,
      '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
      '', btrim(p_code), true, btrim(p_name)
    ) returning * into v_document;

    insert into public.wiki_document_names (normalized_title, document_id, is_current)
    values (v_normalized_title, v_document.id, true);

    insert into public.wiki_revisions (
      document_id, revision, title, content, ticker_code, categories,
      author_id, mutation_id
    ) values (
      v_document.id, 1, v_document.title, v_document.content,
      v_document.ticker_code, v_document.categories, v_owner_id, gen_random_uuid()
    );
    return;
  end if;

  -- Preserve a title the owner deliberately changed. A document that was
  -- created by this sync still follows the master name and retains old names
  -- as searchable aliases.
  if not v_document.company_sync_enabled
     or v_document.title is distinct from v_document.company_last_synced_name
     or v_document.company_last_synced_name = btrim(p_name) then
    return;
  end if;

  v_title := btrim(p_name);
  v_normalized_title := lower(v_title);
  if exists (
    select 1 from public.wiki_document_names
    where normalized_title = v_normalized_title and document_id <> v_document.id
  ) then
    update public.wiki_documents
    set company_sync_enabled = false, updated_at = now()
    where id = v_document.id;
    return;
  end if;

  update public.wiki_document_names
  set is_current = false
  where document_id = v_document.id and is_current;

  insert into public.wiki_document_names (normalized_title, document_id, is_current)
  values (v_normalized_title, v_document.id, true)
  on conflict (normalized_title) do update
    set document_id = excluded.document_id, is_current = true;

  update public.wiki_documents
  set title = v_title,
      company_last_synced_name = v_title,
      revision = revision + 1,
      updated_at = now()
  where id = v_document.id
  returning * into v_document;

  insert into public.wiki_revisions (
    document_id, revision, title, content, ticker_code, categories,
    author_id, mutation_id
  ) values (
    v_document.id, v_document.revision, v_document.title, v_document.content,
    v_document.ticker_code, v_document.categories, v_owner_id, gen_random_uuid()
  );
end;
$$;

revoke all on function public.wiki_sync_common_company_document(text, text, text)
  from public, anon, authenticated;

create or replace function public.wiki_sync_common_company_documents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company record;
  v_count integer := 0;
begin
  for v_company in
    select code, name, security_type
    from public.companies
    where security_type = 'COMMON'
    order by code
  loop
    perform public.wiki_sync_common_company_document(
      v_company.code, v_company.name, v_company.security_type
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.wiki_sync_common_company_documents()
  from public, anon, authenticated;

create or replace function public.wiki_sync_common_company_document_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wiki_sync_common_company_document(new.code, new.name, new.security_type);
  return new;
end;
$$;

revoke all on function public.wiki_sync_common_company_document_on_change()
  from public, anon, authenticated;

drop trigger if exists sync_common_company_wiki_document on public.companies;
create trigger sync_common_company_wiki_document
after insert or update of name, security_type on public.companies
for each row execute function public.wiki_sync_common_company_document_on_change();

-- Backfill the currently listed common shares. Re-running this migration's
-- function later is safe: matching ticker codes are skipped.
select public.wiki_sync_common_company_documents();

-- A normal editor save that changes the title opts the document out of future
-- master-name replacements. Content-only saves leave automatic name sync on.
create or replace function public.wiki_save_document(
  p_document_id uuid,
  p_base_revision integer,
  p_title text,
  p_content jsonb,
  p_content_text text,
  p_ticker_code text default null,
  p_categories text[] default '{}',
  p_mutation_id uuid default gen_random_uuid(),
  p_restored_from_revision integer default null
)
returns public.wiki_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.wiki_documents;
  v_existing_revision public.wiki_revisions;
  v_normalized text := lower(btrim(p_title));
begin
  if not public.wiki_is_owner() then raise exception 'wiki_access_denied' using errcode = '42501'; end if;
  select * into v_existing_revision from public.wiki_revisions where document_id = p_document_id and mutation_id = p_mutation_id;
  if found then select * into v_document from public.wiki_documents where id = p_document_id; return v_document; end if;
  select * into v_document from public.wiki_documents where id = p_document_id and owner_id = auth.uid() for update;
  if not found then raise exception 'wiki_document_not_found' using errcode = 'P0002'; end if;
  if v_document.revision <> p_base_revision then raise exception 'wiki_revision_conflict' using errcode = '40001'; end if;
  if v_normalized = '' then raise exception 'wiki_title_required' using errcode = '22023'; end if;
  if exists (select 1 from public.wiki_document_names where normalized_title = v_normalized and document_id <> p_document_id) then
    raise exception 'wiki_title_taken' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.wiki_documents
    where owner_id = auth.uid() and ticker_code = nullif(btrim(p_ticker_code), '') and id <> p_document_id
  ) then raise exception 'wiki_ticker_code_taken' using errcode = '23505'; end if;
  update public.wiki_document_names set is_current = false where document_id = p_document_id and is_current;
  insert into public.wiki_document_names (normalized_title, document_id, is_current) values (v_normalized, p_document_id, true)
    on conflict (normalized_title) do update set is_current = true, document_id = excluded.document_id;
  update public.wiki_documents
  set title = btrim(p_title),
      content = coalesce(p_content, v_document.content),
      content_text = coalesce(p_content_text, ''),
      ticker_code = nullif(btrim(p_ticker_code), ''),
      categories = coalesce(p_categories, '{}'),
      company_sync_enabled = case
        when v_document.company_sync_enabled and btrim(p_title) = v_document.title then true
        else false
      end,
      revision = revision + 1,
      updated_at = now()
  where id = p_document_id returning * into v_document;
  insert into public.wiki_revisions (document_id, revision, title, content, ticker_code, categories, author_id, mutation_id, restored_from_revision)
  values (v_document.id, v_document.revision, v_document.title, v_document.content, v_document.ticker_code, v_document.categories, auth.uid(), p_mutation_id, p_restored_from_revision);
  return v_document;
end;
$$;

revoke all on function public.wiki_save_document(uuid, integer, text, jsonb, text, text, text[], uuid, integer) from public;
grant execute on function public.wiki_save_document(uuid, integer, text, jsonb, text, text, text[], uuid, integer) to authenticated;
