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

-- Optional: revoke direct access from anon without JWT (RLS still applies when authenticated via anon key + user JWT)
grant select, insert, update, delete on public.car_care_rows to authenticated;
