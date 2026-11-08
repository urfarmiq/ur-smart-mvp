-- Run the COMPLETE script after terrain_reports in one SQL session.
-- Synthetic accounts have no email/phone. Every fixture ends in ROLLBACK.
-- No real field, account, terrain result, notification delivery or provider call.
begin;
create temporary table terrain_test_session(dummy boolean) on commit drop;
create function pg_temp.assert_true(p_test boolean,p_message text)
returns void language plpgsql security invoker as $$
begin if p_test is distinct from true then raise exception '%',p_message; end if; end $$;
create function pg_temp.expect_error(p_sql text,p_expected text,p_message text default null)
returns void language plpgsql security invoker as $$
declare actual text; message_text text;
begin
 begin execute p_sql;
 exception when others then
  get stacked diagnostics actual=returned_sqlstate,message_text=message_text;
  if actual<>p_expected or (p_message is not null and message_text<>p_message) then
   raise exception 'Expected SQLSTATE % / %, got % / %',p_expected,p_message,actual,message_text;
  end if;
  return;
 end;
 raise exception 'Statement unexpectedly succeeded: %',p_sql;
end $$;
create function pg_temp.actor(p_id uuid)
returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_id::text,''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',case when p_id is null then 'anon' else 'authenticated' end,'aal','aal1','is_anonymous',false,'user_metadata',jsonb_build_object('role','admin'))::text,true);
end $$;
create function pg_temp.terrain_boundary()
returns jsonb language sql immutable security invoker as $$
 select '{"type":"Polygon","coordinates":[[[45.00,32.00],[45.01,32.00],[45.01,32.01],[45.00,32.01],[45.00,32.00]]]}'::jsonb;
$$;
-- Deliberately minimal SYNTHETIC result used only inside this rollback test.
create function pg_temp.terrain_result()
returns jsonb language sql immutable security invoker as $$
 select '{"schema_version":1,"status":"completed","source":{"id":"copernicus-glo30"},"summary":{"test_fixture":true},"raster":{"test_fixture":true}}'::jsonb;
$$;
do $$ declare temporary_schema text:=pg_my_temp_schema()::regnamespace::text; begin
 execute format('grant usage on schema %I to anon,authenticated,service_role',temporary_schema);
 execute format('grant execute on all functions in schema %I to anon,authenticated,service_role',temporary_schema);
end $$;

insert into auth.users(id,aud,role,email_confirmed_at,is_anonymous,raw_user_meta_data,created_at)
select ('00000000-0000-4000-8000-00000000e20'||n)::uuid,'authenticated','authenticated',now(),false,'{}'::jsonb,now() from generate_series(1,3)n;
insert into public.farms(id,owner_id,name)
select ('00000000-0000-4000-8000-00000000f20'||n)::uuid,('00000000-0000-4000-8000-00000000e20'||n)::uuid,'Synthetic terrain farm' from generate_series(1,3)n;
insert into public.fields(id,farm_id,name)
select ('00000000-0000-4000-8000-00000000d20'||n)::uuid,('00000000-0000-4000-8000-00000000f20'||n)::uuid,'Synthetic terrain field' from generate_series(1,3)n;
insert into public.field_boundaries(field_id,owner_id,geometry,area_m2,perimeter_m)
select ('00000000-0000-4000-8000-00000000d20'||n)::uuid,('00000000-0000-4000-8000-00000000e20'||n)::uuid,pg_temp.terrain_boundary(),1000,150 from generate_series(1,3)n;

select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.terrain_reports'::regclass),'Terrain reports must enable RLS');
select pg_temp.assert_true(not has_table_privilege('anon','public.terrain_reports','SELECT'),'Anonymous users must have no report read privilege');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.terrain_reports','INSERT') and not has_table_privilege('authenticated','public.terrain_reports','UPDATE'),'Browser users cannot forge completed analyses');
select pg_temp.assert_true(not has_table_privilege('service_role','public.terrain_reports','UPDATE'),'Service writer cannot mutate saved reports');
select pg_temp.assert_true((select not prosecdef from pg_proc where oid='private.guard_terrain_report()'::regprocedure),'Terrain trigger must be SECURITY INVOKER');

set local role service_role;
insert into public.terrain_reports(id,field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version)
values('00000000-0000-4000-8000-00000000c201','00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1'),
      ('00000000-0000-4000-8000-00000000c202','00000000-0000-4000-8000-00000000d202','00000000-0000-4000-8000-00000000e202','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1');
select pg_temp.expect_error($q$update public.terrain_reports set algorithm_version='forged' where id='00000000-0000-4000-8000-00000000c201'$q$,'42501');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e202','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'23514','terrain_field_owner_mismatch');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),'{"type":"Polygon","coordinates":[]}','terrain-test-v1')$q$,'23514','terrain_boundary_changed');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',jsonb_set(pg_temp.terrain_result(),'{status}','"pending"'),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'23514');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result()||jsonb_build_object('oversized',repeat('x',2097152)),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'23514');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30',jsonb_build_object('id','copernicus-glo30','oversized',repeat('x',65536)),pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'23514');
reset role;

set local role anon;
select pg_temp.actor(null);
select pg_temp.expect_error('select id from public.terrain_reports','42501');
select pg_temp.expect_error('delete from public.terrain_reports','42501');
reset role;

set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e201');
select pg_temp.assert_true((select count(*)=1 from public.terrain_reports where user_id in ('00000000-0000-4000-8000-00000000e201','00000000-0000-4000-8000-00000000e202')),'Owner must see exactly own report');
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201',auth.uid(),'copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'forged')$q$,'42501');
select pg_temp.expect_error($q$update public.terrain_reports set report='{}' where id='00000000-0000-4000-8000-00000000c201'$q$,'42501');
with removed as(delete from public.terrain_reports where id='00000000-0000-4000-8000-00000000c202' returning id)
select pg_temp.assert_true((select count(*)=0 from removed),'Owner cannot delete another users report');
select pg_temp.actor('00000000-0000-4000-8000-00000000e203');
select pg_temp.assert_true((select count(*)=0 from public.terrain_reports where id in ('00000000-0000-4000-8000-00000000c201','00000000-0000-4000-8000-00000000c202')),'Stranger claiming admin metadata cannot read either report');
reset role;

-- Even a privileged UPDATE is blocked: the result and snapshot are immutable.
select pg_temp.expect_error($q$update public.terrain_reports set source_id='forged' where id='00000000-0000-4000-8000-00000000c201'$q$,'42501','terrain_reports_are_immutable');
-- A transferred field must not expose an old owners private result to either actor.
update public.farms set owner_id='00000000-0000-4000-8000-00000000e203' where id='00000000-0000-4000-8000-00000000f201';
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e201');
select pg_temp.assert_true((select count(*)=0 from public.terrain_reports where id='00000000-0000-4000-8000-00000000c201'),'Prior owner loses current-field report access');
select pg_temp.actor('00000000-0000-4000-8000-00000000e203');
select pg_temp.assert_true((select count(*)=0 from public.terrain_reports where id='00000000-0000-4000-8000-00000000c201'),'New field owner does not inherit another users result');
reset role;
update public.farms set owner_id='00000000-0000-4000-8000-00000000e201' where id='00000000-0000-4000-8000-00000000f201';

set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e201');
with removed as(delete from public.terrain_reports where id='00000000-0000-4000-8000-00000000c201' returning id)
select pg_temp.assert_true((select count(*)=1 from removed),'Owner can explicitly delete own report');
reset role;
set local role service_role;
insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version)
select '00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1' from generate_series(1,5);
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d201','00000000-0000-4000-8000-00000000e201','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'54000','terrain_hourly_quota_exceeded');
-- Historical imported records exercise storage retention without changing clocks
-- or disabling any production trigger. Only the trusted writer can set dates.
insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version,created_at)
select '00000000-0000-4000-8000-00000000d203','00000000-0000-4000-8000-00000000e203','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1',clock_timestamp()-interval '2 days' from generate_series(1,20);
select pg_temp.expect_error($q$insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version) values('00000000-0000-4000-8000-00000000d203','00000000-0000-4000-8000-00000000e203','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1')$q$,'54000','terrain_retained_report_limit');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e203');
with removed as(delete from public.terrain_reports where id=(select id from public.terrain_reports order by id limit 1) returning id)
select pg_temp.assert_true((select count(*)=1 from removed),'Explicit deletion frees one retained-report slot');
reset role;
set local role service_role;
insert into public.terrain_reports(field_id,user_id,source_id,source_metadata,report,boundary_snapshot,algorithm_version)
values('00000000-0000-4000-8000-00000000d203','00000000-0000-4000-8000-00000000e203','copernicus-glo30','{"id":"copernicus-glo30"}',pg_temp.terrain_result(),pg_temp.terrain_boundary(),'terrain-test-v1');
reset role;

select jsonb_build_object('terrain_reports_rls','passed','scope','synthetic transaction; all fixtures rolled back','tests',jsonb_build_array('service-only completed writes','owner field isolation','forged metadata denial','immutable report and snapshot','owner explicit deletion','stale boundary rejection','2MiB report and64KiB metadata bounds','five completed reports/hour','twenty retained reports/user')) as verification;
rollback;
