create table if not exists public.field_irrigation_logs (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  irrigated_at timestamptz not null,
  water_depth_mm numeric check (water_depth_mm is null or water_depth_mm between 0 and 1000),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 10080),
  method text not null default 'غير محدد',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists field_irrigation_logs_field_time_idx on public.field_irrigation_logs(field_id, irrigated_at desc);
alter table public.field_irrigation_logs enable row level security;
grant select, insert, update, delete on public.field_irrigation_logs to authenticated;
create policy "Read own field irrigation logs" on public.field_irrigation_logs for select to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Insert own field irrigation logs" on public.field_irrigation_logs for insert to authenticated with check (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Update own field irrigation logs" on public.field_irrigation_logs for update to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid()))) with check (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Delete own field irrigation logs" on public.field_irrigation_logs for delete to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create table if not exists public.satellite_observations (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  acquisition_date date not null,
  indices jsonb not null check (jsonb_typeof(indices)='object'),
  valid_pixels integer check (valid_pixels is null or valid_pixels >= 0),
  geometry_pixels integer check (geometry_pixels is null or geometry_pixels >= 0),
  coverage_percent numeric check (coverage_percent is null or coverage_percent between 0 and 100),
  source text not null default 'Sentinel-2 L2A',
  weather_context jsonb,
  recorded_at timestamptz not null default now(),
  unique(field_id, acquisition_date)
);
create index if not exists satellite_observations_field_date_idx on public.satellite_observations(field_id, acquisition_date desc);
alter table public.satellite_observations enable row level security;
grant select, insert, update, delete on public.satellite_observations to authenticated;
create policy "Read own satellite observations" on public.satellite_observations for select to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Insert own satellite observations" on public.satellite_observations for insert to authenticated with check (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Update own satellite observations" on public.satellite_observations for update to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid()))) with check (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));
create policy "Delete own satellite observations" on public.satellite_observations for delete to authenticated using (owner_id=(select auth.uid()) and exists (select 1 from public.fields f join public.farms a on a.id=f.farm_id where f.id=field_id and a.owner_id=(select auth.uid())));