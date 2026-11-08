-- Additive authoritative DEM reports. No existing table, account or field changes.
-- The authenticated terrain backend supplies completed real-data analyses;
-- browser clients can read/delete their own reports but cannot create/edit them.
create table public.terrain_reports (
 id uuid primary key default gen_random_uuid(),
 field_id uuid not null references public.fields(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 source_id text not null check (source_id ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
 source_metadata jsonb not null,
 report jsonb not null,
 boundary_snapshot jsonb not null,
 algorithm_version text not null check (char_length(btrim(algorithm_version)) between 1 and 80),
 constraint terrain_source_metadata_shape check (
  coalesce(jsonb_typeof(source_metadata)='object'
   and source_metadata->>'id'=source_id
   and octet_length(source_metadata::text)<=65536,false)
 ),
 constraint terrain_completed_report_shape check (
  coalesce(jsonb_typeof(report)='object'
   and report->>'status'='completed'
   and jsonb_typeof(report->'summary')='object'
   and jsonb_typeof(report->'raster')='object'
   and report->'source'->>'id'=source_id
   and octet_length(report::text)<=2097152,false)
 ),
 constraint terrain_boundary_snapshot_shape check (
  coalesce(jsonb_typeof(boundary_snapshot)='object'
   and boundary_snapshot->>'type'='Polygon'
   and jsonb_typeof(boundary_snapshot->'coordinates')='array'
   and octet_length(boundary_snapshot::text)<=262144,false)
 )
);
create index terrain_reports_user_created_idx on public.terrain_reports(user_id,created_at desc,id);
create index terrain_reports_field_created_idx on public.terrain_reports(field_id,created_at desc,id);
alter table public.terrain_reports enable row level security;
revoke all on public.terrain_reports from public,anon,authenticated,service_role;
grant select,delete on public.terrain_reports to authenticated;
grant select,insert,delete on public.terrain_reports to service_role;

create policy "Owners read their current fields terrain reports"
on public.terrain_reports for select to authenticated using (
 user_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=terrain_reports.field_id and a.owner_id=(select auth.uid())
 )
);
create policy "Owners explicitly delete their current fields terrain reports"
on public.terrain_reports for delete to authenticated using (
 user_id=(select auth.uid()) and exists (
  select 1 from public.fields f join public.farms a on a.id=f.farm_id
  where f.id=terrain_reports.field_id and a.owner_id=(select auth.uid())
 )
);

-- SECURITY INVOKER: never introduce a privileged public RPC for creating reports.
-- This trigger also checks a trusted backend's ownership/snapshot mistakes.
create function private.guard_terrain_report()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare owner_id uuid;
begin
 if tg_op<>'INSERT' then
  raise exception 'terrain_reports_are_immutable' using errcode='42501';
 end if;
 select a.owner_id into owner_id
 from public.fields f join public.farms a on a.id=f.farm_id
 where f.id=new.field_id;
 if owner_id is null or owner_id is distinct from new.user_id then
  raise exception 'terrain_field_owner_mismatch' using errcode='23514';
 end if;
 if not exists (
  select 1 from public.field_boundaries b
  where b.field_id=new.field_id and b.owner_id=new.user_id
   and b.geometry=new.boundary_snapshot
 ) then
  raise exception 'terrain_boundary_changed' using errcode='23514';
 end if;
 -- Serialize completed writes for this user across backend instances.
 perform pg_catalog.pg_advisory_xact_lock(72108,pg_catalog.hashtext(new.user_id::text));
 if (select count(*) from public.terrain_reports where user_id=new.user_id)>=20 then
  raise exception 'terrain_retained_report_limit' using errcode='54000';
 end if;
 if (select count(*) from public.terrain_reports
     where user_id=new.user_id and created_at>=clock_timestamp()-interval '1 hour')>=5 then
  raise exception 'terrain_hourly_quota_exceeded' using errcode='54000';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_terrain_report() from public,anon,authenticated,service_role;
create trigger terrain_reports_guard before insert or update on public.terrain_reports
for each row execute function private.guard_terrain_report();

comment on table public.terrain_reports is 'Immutable completed real DEM analyses written only by authenticated terrain backend. Owner read/delete RLS;20 retained reports/user and5 completed writes/hour; no automatic history deletion. DEM results are estimates, not LiDAR or an engineering drainage design.';
comment on column public.terrain_reports.boundary_snapshot is 'Exact saved field boundary used for this analysis; later edits do not mutate the report. Saving fails if current boundary changed while analysis ran.';
comment on column public.terrain_reports.report is 'Complete source-qualified result and display rasters, maximum2MiB. Effective grid spacing belongs in source/raster metadata; never truncate or invent results to fit.';
comment on column public.terrain_reports.created_at is 'Trusted backend completion timestamp; browser clients cannot insert or update it. Historical maintenance imports may explicitly preserve their timestamps.';

notify pgrst,'reload schema';
