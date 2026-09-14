-- Personal wiki: one explicitly designated account only.
-- After applying this migration, configure the owner once from a trusted SQL session:
--   insert into public.wiki_access (singleton, owner_user_id)
--   values (true, '<AUTH_USER_UUID>');
-- Do not grant this table to normal application roles.

create extension if not exists pg_trgm;

create table if not exists public.wiki_access (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid not null unique references auth.users(id) on delete restrict,
  configured_at timestamptz not null default now()
);

alter table public.wiki_access enable row level security;
revoke all on public.wiki_access from anon, authenticated;

create or replace function public.wiki_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wiki_access
    where singleton = true and owner_user_id = auth.uid()
  );
$$;

revoke all on function public.wiki_is_owner() from public;
grant execute on function public.wiki_is_owner() to authenticated;

create table if not exists public.wiki_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  content_text text not null default '',
  format_version integer not null default 1 check (format_version > 0),
  revision integer not null default 1 check (revision > 0),
  ticker_code text,
  categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wiki_documents_owner_updated_idx
  on public.wiki_documents (owner_id, updated_at desc);
create index if not exists wiki_documents_search_idx
  on public.wiki_documents using gin ((title || ' ' || content_text) gin_trgm_ops);

create table if not exists public.wiki_document_names (
  normalized_title text primary key,
  document_id uuid not null references public.wiki_documents(id) on delete cascade,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists wiki_document_names_one_current_idx
  on public.wiki_document_names (document_id) where is_current;

create table if not exists public.wiki_links (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.wiki_documents(id) on delete cascade,
  target_document_id uuid references public.wiki_documents(id) on delete set null,
  target_heading_id text,
  unresolved_title text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (target_document_id is not null or unresolved_title is not null)
);
create index if not exists wiki_links_source_idx on public.wiki_links (source_document_id);

create table if not exists public.wiki_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text,
  upload_status text not null default 'ready' check (upload_status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.wiki_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.wiki_documents(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null,
  content jsonb not null,
  ticker_code text,
  categories text[] not null default '{}',
  author_id uuid not null references auth.users(id) on delete restrict,
  mutation_id uuid not null,
  restored_from_revision integer,
  created_at timestamptz not null default now(),
  unique (document_id, revision),
  unique (document_id, mutation_id)
);
create index if not exists wiki_revisions_document_idx
  on public.wiki_revisions (document_id, revision desc);

alter table public.wiki_documents enable row level security;
alter table public.wiki_document_names enable row level security;
alter table public.wiki_links enable row level security;
alter table public.wiki_attachments enable row level security;
alter table public.wiki_revisions enable row level security;

create policy "wiki owner reads documents" on public.wiki_documents for select
  using (public.wiki_is_owner() and owner_id = auth.uid());
create policy "wiki owner reads names" on public.wiki_document_names for select
  using (public.wiki_is_owner() and exists (select 1 from public.wiki_documents d where d.id = document_id and d.owner_id = auth.uid()));
create policy "wiki owner reads links" on public.wiki_links for select
  using (public.wiki_is_owner() and exists (select 1 from public.wiki_documents d where d.id = source_document_id and d.owner_id = auth.uid()));
create policy "wiki owner reads attachments" on public.wiki_attachments for select
  using (public.wiki_is_owner() and owner_id = auth.uid());
create policy "wiki owner reads revisions" on public.wiki_revisions for select
  using (public.wiki_is_owner() and exists (select 1 from public.wiki_documents d where d.id = document_id and d.owner_id = auth.uid()));

grant select on public.wiki_documents, public.wiki_document_names, public.wiki_links, public.wiki_attachments, public.wiki_revisions to authenticated;
create policy "wiki owner registers attachments" on public.wiki_attachments for insert
  with check (public.wiki_is_owner() and owner_id = auth.uid());

-- All document mutations go through these functions so that a revision and the
-- current document cannot diverge. They also reject other approved/admin users.
create or replace function public.wiki_create_document(
  p_title text,
  p_content jsonb,
  p_content_text text,
  p_ticker_code text default null,
  p_categories text[] default '{}',
  p_mutation_id uuid default gen_random_uuid()
)
returns public.wiki_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.wiki_documents;
  v_normalized text := lower(btrim(p_title));
begin
  if not public.wiki_is_owner() then raise exception 'wiki_access_denied' using errcode = '42501'; end if;
  if v_normalized = '' then raise exception 'wiki_title_required' using errcode = '22023'; end if;
  if exists (select 1 from public.wiki_document_names where normalized_title = v_normalized) then
    raise exception 'wiki_title_taken' using errcode = '23505';
  end if;

  insert into public.wiki_documents (owner_id, title, content, content_text, ticker_code, categories)
  values (auth.uid(), btrim(p_title), coalesce(p_content, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb), coalesce(p_content_text, ''), nullif(btrim(p_ticker_code), ''), coalesce(p_categories, '{}'))
  returning * into v_document;
  insert into public.wiki_document_names (normalized_title, document_id, is_current) values (v_normalized, v_document.id, true);
  insert into public.wiki_revisions (document_id, revision, title, content, ticker_code, categories, author_id, mutation_id)
  values (v_document.id, 1, v_document.title, v_document.content, v_document.ticker_code, v_document.categories, auth.uid(), p_mutation_id);
  return v_document;
end;
$$;

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
  update public.wiki_document_names set is_current = false where document_id = p_document_id and is_current;
  insert into public.wiki_document_names (normalized_title, document_id, is_current) values (v_normalized, p_document_id, true)
    on conflict (normalized_title) do update set is_current = true, document_id = excluded.document_id;
  update public.wiki_documents set title = btrim(p_title), content = coalesce(p_content, v_document.content), content_text = coalesce(p_content_text, ''), ticker_code = nullif(btrim(p_ticker_code), ''), categories = coalesce(p_categories, '{}'), revision = revision + 1, updated_at = now()
  where id = p_document_id returning * into v_document;
  insert into public.wiki_revisions (document_id, revision, title, content, ticker_code, categories, author_id, mutation_id, restored_from_revision)
  values (v_document.id, v_document.revision, v_document.title, v_document.content, v_document.ticker_code, v_document.categories, auth.uid(), p_mutation_id, p_restored_from_revision);
  return v_document;
end;
$$;

revoke all on function public.wiki_create_document(text, jsonb, text, text, text[], uuid) from public;
revoke all on function public.wiki_save_document(uuid, integer, text, jsonb, text, text, text[], uuid, integer) from public;
grant execute on function public.wiki_create_document(text, jsonb, text, text, text[], uuid) to authenticated;
grant execute on function public.wiki_save_document(uuid, integer, text, jsonb, text, text, text[], uuid, integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wiki-private', 'wiki-private', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "wiki owner reads private objects" on storage.objects for select
  using (bucket_id = 'wiki-private' and public.wiki_is_owner() and split_part(name, '/', 1) = auth.uid()::text);
create policy "wiki owner inserts private objects" on storage.objects for insert
  with check (bucket_id = 'wiki-private' and public.wiki_is_owner() and split_part(name, '/', 1) = auth.uid()::text);
create policy "wiki owner updates private objects" on storage.objects for update
  using (bucket_id = 'wiki-private' and public.wiki_is_owner() and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'wiki-private' and public.wiki_is_owner() and split_part(name, '/', 1) = auth.uid()::text);
create policy "wiki owner deletes private objects" on storage.objects for delete
  using (bucket_id = 'wiki-private' and public.wiki_is_owner() and split_part(name, '/', 1) = auth.uid()::text);
