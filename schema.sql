-- THE EDIT — database and photo storage.
-- Run once in Supabase → SQL Editor → New query → paste → Run.

-- 1. One table holds every record (garments, looks, inspo, trips, try-ons, profile).
create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);

-- Each person sees and edits only their own records.
alter table public.docs enable row level security;
drop policy if exists "docs: read own"   on public.docs;
drop policy if exists "docs: insert own" on public.docs;
drop policy if exists "docs: update own" on public.docs;
drop policy if exists "docs: delete own" on public.docs;
create policy "docs: read own"   on public.docs for select using (auth.uid() = user_id);
create policy "docs: insert own" on public.docs for insert with check (auth.uid() = user_id);
create policy "docs: update own" on public.docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "docs: delete own" on public.docs for delete using (auth.uid() = user_id);

-- Live sync between your phone and laptop.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 2. A private bucket for photos. Files live under a folder named after your user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', false, 20971520, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "images: read own"   on storage.objects;
drop policy if exists "images: upload own" on storage.objects;
drop policy if exists "images: update own" on storage.objects;
drop policy if exists "images: delete own" on storage.objects;
create policy "images: read own"   on storage.objects for select using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: upload own" on storage.objects for insert with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: update own" on storage.objects for update using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: delete own" on storage.objects for delete using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
