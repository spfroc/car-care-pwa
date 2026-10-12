-- Car Care PWA — BYO Supabase schema (run in YOUR project's SQL Editor)
-- Requires: Authentication enabled (email). RLS stays ON.
-- NEVER put the service_role key into the PWA. Use the anon/publishable key only.

create table if not exists public.car_care_rows (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity text not null check (entity in ('vehicles', 'records', 'stations', 'settings', 'media')),
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  device_id text,
  primary key (user_id, entity, id)
);

create index if not exists car_care_rows_updated_idx
  on public.car_care_rows (user_id, updated_at);

create index if not exists car_care_rows_entity_idx
  on public.car_care_rows (user_id, entity);

alter table public.car_care_rows enable row level security;

drop policy if exists "car_care_rows_select_own" on public.car_care_rows;
drop policy if exists "car_care_rows_insert_own" on public.car_care_rows;
drop policy if exists "car_care_rows_update_own" on public.car_care_rows;
drop policy if exists "car_care_rows_delete_own" on public.car_care_rows;

create policy "car_care_rows_select_own"
  on public.car_care_rows for select
  using (auth.uid() = user_id);

create policy "car_care_rows_insert_own"
  on public.car_care_rows for insert
  with check (auth.uid() = user_id);

create policy "car_care_rows_update_own"
  on public.car_care_rows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "car_care_rows_delete_own"
  on public.car_care_rows for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.car_care_rows to authenticated;

-- Atomic LWW upsert (eliminates client read-then-write TOCTOU).
-- Returns 'applied' | 'skipped_cloud_newer'.
create or replace function public.car_care_upsert_lww(
  p_entity text,
  p_id text,
  p_payload jsonb,
  p_updated_at timestamptz,
  p_deleted_at timestamptz,
  p_device_id text
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing_updated timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_entity not in ('vehicles', 'records', 'stations', 'settings', 'media') then
    raise exception 'invalid entity';
  end if;

  select updated_at into existing_updated
  from public.car_care_rows
  where user_id = uid and entity = p_entity and id = p_id
  for update;

  if existing_updated is not null and existing_updated > p_updated_at then
    return 'skipped_cloud_newer';
  end if;

  insert into public.car_care_rows as t (
    user_id, entity, id, payload, updated_at, deleted_at, device_id
  ) values (
    uid, p_entity, p_id, coalesce(p_payload, '{}'::jsonb), p_updated_at, p_deleted_at, p_device_id
  )
  on conflict (user_id, entity, id) do update
  set
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    device_id = excluded.device_id
  where t.updated_at <= excluded.updated_at;

  return 'applied';
end;
$$;

revoke all on function public.car_care_upsert_lww(text, text, jsonb, timestamptz, timestamptz, text) from public;
grant execute on function public.car_care_upsert_lww(text, text, jsonb, timestamptz, timestamptz, text) to authenticated;
