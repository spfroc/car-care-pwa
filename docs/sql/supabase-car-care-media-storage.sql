-- Car Care PWA — M3-A private media Storage (run in YOUR project's SQL Editor)
-- Prerequisites: docs/sql/supabase-car-care-rows.sql already applied; Auth enabled.
-- NEVER put the service_role key into the PWA. Use the anon/publishable key only.
-- Bucket is PRIVATE. Object paths MUST be: {auth.uid()}/{media_id}/{sha256}.{ext}

-- 1) Private bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'car-care-media',
  'car-care-media',
  false,
  1500000,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) Per-user isolation: first path segment == auth.uid()
drop policy if exists "car_care_media_select_own" on storage.objects;
drop policy if exists "car_care_media_insert_own" on storage.objects;
drop policy if exists "car_care_media_update_own" on storage.objects;
drop policy if exists "car_care_media_delete_own" on storage.objects;

create policy "car_care_media_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'car-care-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car_care_media_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'car-care-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car_care_media_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'car-care-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'car-care-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "car_care_media_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'car-care-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Optional helper: list live media storage keys for the caller (orphan GC).
-- Returns storage_key text from non-deleted media payloads that have one.
create or replace function public.car_care_list_media_storage_keys()
returns table (media_id text, storage_key text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.id as media_id,
    r.payload->>'storageKey' as storage_key
  from public.car_care_rows r
  where r.user_id = auth.uid()
    and r.entity = 'media'
    and r.deleted_at is null
    and coalesce(r.payload->>'storageKey', '') <> '';
$$;

revoke all on function public.car_care_list_media_storage_keys() from public;
grant execute on function public.car_care_list_media_storage_keys() to authenticated;
