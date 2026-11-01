-- Run the COMPLETE script in one session after the paid-field-services migration.
-- Synthetic accounts have no email/phone. All fixtures and test helpers ROLLBACK.
-- No external requests, real-account changes, payments or persistent test rows.
begin;
create temporary table field_service_test_session(dummy boolean) on commit drop;

create function pg_temp.assert_true(p_test boolean,p_message text)
returns void language plpgsql security invoker as $$
begin if p_test is distinct from true then raise exception '%',p_message; end if; end $$;
create function pg_temp.expect_sqlstate(p_sql text,p_expected text)
returns void language plpgsql security invoker as $$
declare actual text;
begin
 begin execute p_sql;
 exception when others then
  get stacked diagnostics actual=returned_sqlstate;
  if actual<>p_expected then raise exception 'Expected SQLSTATE %, got % for %',p_expected,actual,p_sql; end if;
  return;
 end;
 raise exception 'Statement unexpectedly succeeded: %',p_sql;
end $$;
create function pg_temp.actor(p_id uuid,p_aal text default 'aal1',p_anonymous boolean default false)
returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_id::text,''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role',case when p_id is null then 'anon' else 'authenticated' end,'aal',p_aal,'is_anonymous',p_anonymous,'user_metadata',jsonb_build_object('role','admin'),'app_metadata',jsonb_build_object('role','admin'))::text,true);
end $$;
create function pg_temp.report_result(p_type text default 'field_report',p_number integer default 1)
returns jsonb language sql security invoker as $$
 select jsonb_build_object('schema_version',1,'created_at',clock_timestamp()::text,
  'service_type',p_type,'report_number',p_number,'due_at',clock_timestamp()::text,
  'field',jsonb_build_object('name','Synthetic field'),'satellite',null,'weather',null,
  'irrigation_logs','[]'::jsonb,'comparison',null,'summary','Synthetic bounded report',
  'recommendations','[]'::jsonb,'limitations','[]'::jsonb,'notes','[]'::jsonb,'sources','{}'::jsonb);
$$;
-- INVOKER helper used only by the database owner for isolated quota/lease fixtures.
create function pg_temp.approved_order(p_id uuid,p_owner uuid,p_field uuid,p_type text default 'field_report',p_count integer default 1,p_cadence integer default null)
returns uuid language plpgsql security invoker as $$
begin
 insert into public.field_service_orders(id,owner_id,field_id,service_type,report_count,cadence_days,status,
  quote_iqd,quote_scope,quote_version,quoted_by,quoted_at,accepted_quote_version,accepted_at,approved_by,approved_at,next_due_at)
 values(p_id,p_owner,p_field,p_type,p_count,p_cadence,'approved',1000,'Synthetic agreed scope',1,
  '00000000-0000-4000-8000-00000000c101',clock_timestamp(),1,clock_timestamp(),
  '00000000-0000-4000-8000-00000000c101',clock_timestamp(),clock_timestamp());
 return p_id;
end $$;
do $$ declare temporary_schema text:=pg_my_temp_schema()::regnamespace::text; begin
 execute format('grant usage on schema %I to anon,authenticated',temporary_schema);
 execute format('grant execute on all functions in schema %I to anon,authenticated',temporary_schema);
end $$;

insert into auth.users(id,aud,role,email_confirmed_at,is_anonymous,raw_user_meta_data,created_at)
select ('00000000-0000-4000-8000-00000000c10'||n)::uuid,'authenticated','authenticated',
 case when n in (4,5) then null else now() end,n=5,'{}'::jsonb,now()
from generate_series(1,8) n;
insert into private.platform_admins(user_id) values('00000000-0000-4000-8000-00000000c101');
insert into public.farms(id,owner_id,name)
select ('00000000-0000-4000-8000-00000000c30'||n)::uuid,('00000000-0000-4000-8000-00000000c10'||n)::uuid,'Synthetic field-service farm '||n
from generate_series(1,8) n;
insert into public.fields(id,farm_id,name)
select ('00000000-0000-4000-8000-00000000c20'||n)::uuid,('00000000-0000-4000-8000-00000000c30'||n)::uuid,'Synthetic field-service field '||n
from generate_series(1,8) n;

set local role anon;
select pg_temp.actor(null);
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_report')$q$,'42501');
select pg_temp.expect_sqlstate('select id from public.field_service_orders','42501');
select pg_temp.expect_sqlstate('select id from public.field_service_reports','42501');
select pg_temp.expect_sqlstate('select public.claim_field_service_report(gen_random_uuid())','42501');
select pg_temp.expect_sqlstate($q$select public.review_field_service_payment(gen_random_uuid(),'approve')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c104');
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c204','field_report')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000c105','aal1',true);
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c205','field_report')$q$,'42501');

-- Ordinary owner cannot grant payment privileges through editable role claims.
select pg_temp.actor('00000000-0000-4000-8000-00000000c102','aal2');
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c203','field_report')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c202','unknown')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_monitoring',null,1,2)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_monitoring',null,7,13)$q$,'22023');
select set_config('ur.field.order',(public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_monitoring','  Fixture request  ',7,2)->>'id'),true);
select pg_temp.assert_true((select status='waiting_quote' and quote_iqd is null and request_note='Fixture request' from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'New order has incorrect initial terms');
select pg_temp.expect_sqlstate(format('select public.quote_field_service_order(%L,1000,%L)',current_setting('ur.field.order'),'Forged quote'),'42501');
select pg_temp.expect_sqlstate(format('select private.quote_field_service_order(%L,1000,%L)',current_setting('ur.field.order'),'Forged private quote'),'42501');
select pg_temp.expect_sqlstate(format('select public.review_field_service_payment(%L,%L)',current_setting('ur.field.order'),'approve'),'42501');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'42501');
select pg_temp.expect_sqlstate(format('update public.field_service_orders set status=%L where id=%L','approved',current_setting('ur.field.order')),'42501');
select pg_temp.expect_sqlstate($q$insert into public.field_service_orders(owner_id,field_id,service_type,report_count) values(auth.uid(),'00000000-0000-4000-8000-00000000c202','field_report',1)$q$,'42501');
select pg_temp.expect_sqlstate(format('delete from public.field_service_orders where id=%L',current_setting('ur.field.order')),'42501');
select pg_temp.expect_sqlstate('select run_token from public.field_service_orders','42501');
select pg_temp.expect_sqlstate('select quoted_by,approved_by,accepted_quote_version from public.field_service_orders','42501');
select pg_temp.expect_sqlstate('select * from public.field_service_orders','42501');
select pg_temp.expect_sqlstate('select * from private.field_service_runs','42501');

select pg_temp.actor('00000000-0000-4000-8000-00000000c103','aal2');
select pg_temp.assert_true(not exists(select id from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'Stranger read another account order');
select pg_temp.expect_sqlstate(format('select public.accept_field_service_quote(%L,1)',current_setting('ur.field.order')),'42501');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'42501');
select pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,gen_random_uuid(),%L,pg_temp.report_result())',current_setting('ur.field.order'),'completed'),'42501');

-- Allowlisted administrators still require an aal2 session for queue and payment.
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal1');
select pg_temp.assert_true(not exists(select id from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'aal1 administrator read payment queue');
select pg_temp.expect_sqlstate(format('select public.quote_field_service_order(%L,1000,%L)',current_setting('ur.field.order'),'Scope'),'42501');
select pg_temp.expect_sqlstate(format('select public.review_field_service_payment(%L,%L)',current_setting('ur.field.order'),'approve'),'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal2');
select pg_temp.assert_true(exists(select id from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'aal2 administrator cannot read queue');
select pg_temp.expect_sqlstate(format('select public.review_field_service_payment(%L,%L)',current_setting('ur.field.order'),'approve'),'42501');
select pg_temp.expect_sqlstate(format('select public.quote_field_service_order(%L,0,%L)',current_setting('ur.field.order'),'Scope'),'22023');
select public.quote_field_service_order(current_setting('ur.field.order')::uuid,15000,'  First scope  ');
select public.quote_field_service_order(current_setting('ur.field.order')::uuid,18000,'Final agreed two-report scope');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
select pg_temp.expect_sqlstate(format('select public.accept_field_service_quote(%L,1)',current_setting('ur.field.order')),'55000');
select public.accept_field_service_quote(current_setting('ur.field.order')::uuid,2,'SYNTHETIC-TRANSFER');
select pg_temp.assert_true((select status='awaiting_payment' and quote_version=2 and quote_iqd=18000 and accepted_at is not null from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'Owner did not accept exact current quote');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal2');
select pg_temp.expect_sqlstate(format('select public.quote_field_service_order(%L,1,%L)',current_setting('ur.field.order'),'Changed after acceptance'),'55000');
select public.review_field_service_payment(current_setting('ur.field.order')::uuid,'approve','Synthetic manual receipt confirmed');
select pg_temp.expect_sqlstate(format('select public.review_field_service_payment(%L,%L)',current_setting('ur.field.order'),'reject'),'55000');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'42501');
reset role;

-- Overdue orders produce a current report, then wait a full cadence from finish.
update public.field_service_orders set approved_at=clock_timestamp()-interval '21 days',next_due_at=clock_timestamp()-interval '21 days' where id=current_setting('ur.field.order')::uuid;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
select set_config('ur.field.token',public.claim_field_service_report(current_setting('ur.field.order')::uuid)->>'run_token',true);
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'55000');
select pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,gen_random_uuid(),%L,pg_temp.report_result(%L,1))',current_setting('ur.field.order'),'completed','field_monitoring'),'42501');
select pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,%L,%L,pg_temp.report_result(%L,1)-%L)',current_setting('ur.field.order'),current_setting('ur.field.token'),'completed','field_monitoring','sources'),'22023');
select pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,%L,%L,pg_temp.report_result(%L,1)||jsonb_build_object(%L,repeat(%L,131073)))',current_setting('ur.field.order'),current_setting('ur.field.token'),'completed','field_monitoring','summary','x'),'22023');
select public.finish_field_service_report(current_setting('ur.field.order')::uuid,current_setting('ur.field.token')::uuid,'needs_review',pg_temp.report_result('field_monitoring',1));
select pg_temp.assert_true((select status='approved' and completed_reports=1 and period_attempts=0 and next_due_at>clock_timestamp()+interval '6 days 23 hours' from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'Partial report did not consume one report and schedule a full interval');
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'55000');
select pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,%L,%L,pg_temp.report_result(%L,1))',current_setting('ur.field.order'),current_setting('ur.field.token'),'failed','field_monitoring'),'42501');
reset role;
update public.field_service_orders set next_due_at=clock_timestamp()-interval '1 second' where id=current_setting('ur.field.order')::uuid;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
do $$ declare claimed jsonb; finished jsonb; begin
 claimed:=public.claim_field_service_report(current_setting('ur.field.order')::uuid);
 perform pg_temp.assert_true((claimed->>'report_number')::integer=2 and (claimed->>'attempt_number')::integer=1,'Next reporting period did not reset attempts/increment ordinal');
 finished:=public.finish_field_service_report(current_setting('ur.field.order')::uuid,(claimed->>'run_token')::uuid,'completed',pg_temp.report_result('field_monitoring',2));
 perform pg_temp.assert_true(finished->>'status'='completed' and (finished->>'completed_reports')::integer=2,'Finite reporting plan did not complete');
end $$;
select pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',current_setting('ur.field.order')),'55000');
select pg_temp.assert_true((select count(*)=2 from public.field_service_reports where order_id=current_setting('ur.field.order')::uuid),'Periodic report history lost an ordinal');
select pg_temp.expect_sqlstate(format('update public.field_service_reports set result=%L::jsonb where order_id=%L','{}',current_setting('ur.field.order')),'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000c103');
select pg_temp.assert_true(not exists(select id from public.field_service_reports where order_id=current_setting('ur.field.order')::uuid),'Stranger read owner report results');
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal1');
select pg_temp.assert_true(not exists(select id from public.field_service_reports where order_id=current_setting('ur.field.order')::uuid),'aal1 administrator read another owner report');
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal2');
select pg_temp.assert_true((select count(*)=2 from public.field_service_reports where order_id=current_setting('ur.field.order')::uuid),'aal2 administrator cannot review report history');
reset role;

-- Failed output does not consume entitlement; expired leases rotate capabilities.
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c401','00000000-0000-4000-8000-00000000c108','00000000-0000-4000-8000-00000000c208');
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c108');
select set_config('ur.field.stale_token',public.claim_field_service_report('00000000-0000-4000-8000-00000000c401')->>'run_token',true);
reset role;
update public.field_service_orders set started_at=clock_timestamp()-interval '181 seconds' where id='00000000-0000-4000-8000-00000000c401';
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c108');
do $$ declare claimed jsonb; target uuid:='00000000-0000-4000-8000-00000000c401'; begin
 claimed:=public.claim_field_service_report(target);
 perform pg_temp.assert_true((claimed->>'attempt_number')::integer=2 and claimed->>'run_token'<>current_setting('ur.field.stale_token'),'Expired lease failed to rotate capability/count attempt');
 perform pg_temp.expect_sqlstate(format('select public.finish_field_service_report(%L,%L,%L,pg_temp.report_result())',target,current_setting('ur.field.stale_token'),'completed'),'42501');
 perform public.finish_field_service_report(target,(claimed->>'run_token')::uuid,'failed',pg_temp.report_result());
 perform pg_temp.assert_true((select status='failed' and completed_reports=0 and period_attempts=2 from public.field_service_orders where id=target),'Failed report consumed paid entitlement/reset retry count');
 claimed:=public.claim_field_service_report(target);
 perform pg_temp.assert_true((claimed->>'attempt_number')::integer=3 and (claimed->>'report_number')::integer=1,'Failed retry changed ordinal or lost attempt count');
 perform public.finish_field_service_report(target,(claimed->>'run_token')::uuid,'failed',pg_temp.report_result());
 perform pg_temp.expect_sqlstate(format('select public.claim_field_service_report(%L)',target),'55000');
end $$;
reset role;
select pg_temp.assert_true((select count(*)=3 from private.field_service_runs where order_id='00000000-0000-4000-8000-00000000c401'),'Duplicate denied claim consumed quota or audit attempt lost');
select pg_temp.assert_true((select count(*)=1 from public.field_service_reports where order_id='00000000-0000-4000-8000-00000000c401'),'Failed retries created duplicate report ordinals');

-- Deleting a field preserves paid history, but quoting/approval/run are denied.
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
select set_config('ur.field.deleted_pending',public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_report')->>'id',true);
select set_config('ur.field.deleted_awaiting',public.create_field_service_order('00000000-0000-4000-8000-00000000c202','field_report')->>'id',true);
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal2');
select public.quote_field_service_order(current_setting('ur.field.deleted_awaiting')::uuid,1000,'Synthetic deletion fixture');
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
select public.accept_field_service_quote(current_setting('ur.field.deleted_awaiting')::uuid,1);
reset role;
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c402','00000000-0000-4000-8000-00000000c102','00000000-0000-4000-8000-00000000c202');
delete from public.fields where id='00000000-0000-4000-8000-00000000c202';
select pg_temp.assert_true((select field_id is null from public.field_service_orders where id=current_setting('ur.field.order')::uuid),'Deleting field did not preserve completed history with null field id');
select pg_temp.assert_true((select count(*)=2 from public.field_service_reports where order_id=current_setting('ur.field.order')::uuid),'Deleting field deleted historical reports');
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c102');
select pg_temp.expect_sqlstate($q$select public.claim_field_service_report('00000000-0000-4000-8000-00000000c402')$q$,'42501');
select pg_temp.assert_true((select status='approved' from public.field_service_orders where id='00000000-0000-4000-8000-00000000c402'),'Denied deleted-field run changed financial status');
select pg_temp.actor('00000000-0000-4000-8000-00000000c101','aal2');
select pg_temp.expect_sqlstate(format('select public.quote_field_service_order(%L,1000,%L)',current_setting('ur.field.deleted_pending'),'Unavailable field'),'42501');
select pg_temp.expect_sqlstate(format('select public.review_field_service_payment(%L,%L)',current_setting('ur.field.deleted_awaiting'),'approve'),'42501');
select public.review_field_service_payment(current_setting('ur.field.deleted_pending')::uuid,'reject','Synthetic deleted-field request');
select pg_temp.assert_true((select status='rejected' from public.field_service_orders where id=current_setting('ur.field.deleted_pending')::uuid),'Administrator could not close unavailable-field request');
reset role;

-- Pending-order cap includes all three unpaid stages; no automatic collection.
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c103');
do $$ begin for n in 1..10 loop perform public.create_field_service_order('00000000-0000-4000-8000-00000000c203','field_report'); end loop; end $$;
select pg_temp.expect_sqlstate($q$select public.create_field_service_order('00000000-0000-4000-8000-00000000c203','field_report')$q$,'55000');
reset role;

-- Five owner claims/day, with previous UTC-day attempts excluded.
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c403','00000000-0000-4000-8000-00000000c106','00000000-0000-4000-8000-00000000c206');
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c404','00000000-0000-4000-8000-00000000c106','00000000-0000-4000-8000-00000000c206');
do $$ declare fixture uuid; begin
 for n in 1..5 loop
  fixture:=pg_temp.approved_order(gen_random_uuid(),'00000000-0000-4000-8000-00000000c106','00000000-0000-4000-8000-00000000c206');
  insert into private.field_service_runs(order_id,owner_id,report_number,attempt_number,run_token,created_at)
  values(fixture,'00000000-0000-4000-8000-00000000c106',1,1,gen_random_uuid(),case when n=5 then date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 second' else clock_timestamp() end);
 end loop;
end $$;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c106');
select public.claim_field_service_report('00000000-0000-4000-8000-00000000c403');
select pg_temp.expect_sqlstate($q$select public.claim_field_service_report('00000000-0000-4000-8000-00000000c404')$q$,'54000');
reset role;

-- Fill only synthetic audit rows to the global daily boundary, preserving all
-- pre-existing data even inside the rollback transaction. Fail if already full.
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c405','00000000-0000-4000-8000-00000000c107','00000000-0000-4000-8000-00000000c207');
select pg_temp.approved_order('00000000-0000-4000-8000-00000000c406','00000000-0000-4000-8000-00000000c107','00000000-0000-4000-8000-00000000c207');
do $$ declare today_total integer; fixture uuid; begin
 select count(*) into today_total from private.field_service_runs where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
 if today_total>29 then raise exception 'Global quota fixture requires one free daily slot'; end if;
 for n in 1..(29-today_total) loop
  fixture:=pg_temp.approved_order(gen_random_uuid(),'00000000-0000-4000-8000-00000000c103','00000000-0000-4000-8000-00000000c203');
  insert into private.field_service_runs(order_id,owner_id,report_number,attempt_number,run_token)
  values(fixture,'00000000-0000-4000-8000-00000000c103',1,1,gen_random_uuid());
 end loop;
end $$;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000c107');
select public.claim_field_service_report('00000000-0000-4000-8000-00000000c405');
select pg_temp.expect_sqlstate($q$select public.claim_field_service_report('00000000-0000-4000-8000-00000000c406')$q$,'54000');
select pg_temp.expect_sqlstate($q$insert into private.field_service_runs(order_id,owner_id,report_number,attempt_number,run_token) values('00000000-0000-4000-8000-00000000c406',auth.uid(),1,1,gen_random_uuid())$q$,'42501');
reset role;
select pg_temp.assert_true((select count(*)=30 from private.field_service_runs where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'),'Global cap did not stop at thirty');
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_field_service_order','quote_field_service_order','accept_field_service_quote','review_field_service_payment','claim_field_service_report','finish_field_service_report') and p.prosecdef),'Public field-service RPC has DEFINER rights');
select pg_temp.assert_true((select count(*)=6 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('create_field_service_order','quote_field_service_order','accept_field_service_quote','review_field_service_payment','claim_field_service_report','finish_field_service_report') and p.prosecdef and p.proconfig @> array['search_path=""']),'Checked private RPCs lack fixed empty search_path');
rollback;
