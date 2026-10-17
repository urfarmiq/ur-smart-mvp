-- UR Smart: additive migration. Does not change or delete existing tables/data.
-- Run in the Supabase SQL editor for the existing UR Smart project.
create table if not exists public.field_boundaries (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  geometry jsonb not null,
  area_m2 numeric not null check (area_m2 >= 0),
  perimeter_m numeric not null check (perimeter_m >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_boundaries_polygon check (
    geometry->>'type' = 'Polygon'
    and jsonb_typeof(geometry->'coordinates') = 'array'
  )
);
create unique index if not exists field_boundaries_field_unique on public.field_boundaries(field_id);
create index if not exists field_boundaries_owner_idx on public.field_boundaries(owner_id);
alter table public.field_boundaries enable row level security;
drop policy if exists "Read own field boundaries" on public.field_boundaries;
create policy "Read own field boundaries" on public.field_boundaries
for select to authenticated using (
 owner_id = (select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 )
);
drop policy if exists "Insert own field boundaries" on public.field_boundaries;
create policy "Insert own field boundaries" on public.field_boundaries
for insert to authenticated with check (
 owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 )
);
drop policy if exists "Update own field boundaries" on public.field_boundaries;
create policy "Update own field boundaries" on public.field_boundaries
for update to authenticated using (
 owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 )
) with check (
 owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 )
);
drop policy if exists "Delete own field boundaries" on public.field_boundaries;
create policy "Delete own field boundaries" on public.field_boundaries
for delete to authenticated using (
 owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 )
);
