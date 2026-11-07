-- Additive terrain reports. Does not alter existing field, satellite, weather or report data.
create table if not exists public.terrain_reports (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 field_id uuid not null references public.fields(id) on delete cascade,
 source text not null check (char_length(btrim(source)) between 1 and 200),
 dem_instance text not null check (dem_instance in ('COPERNICUS_30','COPERNICUS_90')),
 resolution_m numeric not null check (resolution_m between 1 and 1000),
 report_data jsonb not null check (jsonb_typeof(report_data)='object'),
 created_at timestamptz not null default statement_timestamp()
);
create index if not exists terrain_reports_field_created_idx
 on public.terrain_reports(field_id,created_at desc,id);
create index if not exists terrain_reports_owner_created_idx
 on public.terrain_reports(owner_id,created_at desc,id);
alter table public.terrain_reports enable row level security;
revoke all on public.terrain_reports from public,anon,authenticated;
grant select,insert on public.terrain_reports to authenticated;
drop policy if exists "Read own terrain reports" on public.terrain_reports;
create policy "Read own terrain reports" on public.terrain_reports
 for select to authenticated
 using (owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 ));
drop policy if exists "Insert own terrain reports" on public.terrain_reports;
create policy "Insert own terrain reports" on public.terrain_reports
 for insert to authenticated
 with check (owner_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=field_id and a.owner_id=(select auth.uid())
 ));
comment on table public.terrain_reports is 'Immutable account-owned first-pass terrain analysis reports derived from a named Copernicus DEM dataset. Pooling and drainage paths are estimates, not engineering designs.';
comment on column public.terrain_reports.report_data is 'Summary metrics and stated limitations only. Raster grids are not stored in this table.';
