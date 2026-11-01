-- Run the COMPLETE script after satellite_paid_access in a single SQL session.
-- Synthetic users have no email/phone. All fixtures and helpers end in ROLLBACK.
-- No real account edits, external requests or payment-provider actions.
begin;
create temporary table satellite_access_test_session(dummy boolean) on commit drop;
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
do $$ declare temporary_schema text:=pg_my_temp_schema()::regnamespace::text; begin
 execute format('grant usage on schema %I to anon,authenticated',temporary_schema);
 execute format('grant execute on all functions in schema %I to anon,authenticated',temporary_schema);
end $$;

insert into auth.users(id,aud,role,email_confirmed_at,is_anonymous,raw_user_meta_data,created_at)
select ('00000000-0000-4000-8000-00000000d10'||n)::uuid,'authenticated','authenticated',case when n in (4,5) then null else now() end,n=5,'{}'::jsonb,now() from generate_series(1,8) n;
insert into private.platform_admins(user_id) values('00000000-0000-4000-8000-00000000d101');
insert into public.farms(id,owner_id,name)
select ('00000000-0000-4000-8000-00000000d30'||n)::uuid,('00000000-0000-4000-8000-00000000d10'||n)::uuid,'Synthetic satellite-access farm '||n from generate_series(1,8) n;
insert into public.fields(id,farm_id,name)
select ('00000000-0000-4000-8000-00000000d20'||n)::uuid,('00000000-0000-4000-8000-00000000d30'||n)::uuid,'Synthetic satellite-access field '||n from generate_series(1,8) n;

-- Metadata guards: no client writes/private identities, explicit RLS, INVOKER public wrappers.
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.satellite_access_orders'::regclass),'Access orders must use RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.satellite_access_orders','INSERT') and not has_table_privilege('authenticated','public.satellite_access_orders','UPDATE') and not has_table_privilege('authenticated','public.satellite_access_orders','DELETE'),'Clients must not write payment orders directly');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.satellite_access_orders','quoted_by','SELECT') and not has_column_privilege('authenticated','public.satellite_access_orders','approved_by','SELECT') and not has_column_privilege('authenticated','public.satellite_access_orders','accepted_quote_version','SELECT'),'Private payment identities/version must not be selectable');
select pg_temp.assert_true((select count(*)=5 and bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_satellite_access_order','quote_satellite_access_order','accept_satellite_access_quote','review_satellite_access_payment','satellite_access_status')),'All public wrappers must remain INVOKER');

set local role anon;
select pg_temp.actor(null);
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.satellite_access_status('00000000-0000-4000-8000-00000000d202')$q$,'42501');
select pg_temp.expect_sqlstate('select id from public.satellite_access_orders','42501');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d104');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d204')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.satellite_access_status('00000000-0000-4000-8000-00000000d204')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000d105','aal1',true);
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d205')$q$,'42501');

-- An owner cannot buy another field, change amounts, grant approval or forge metadata roles.
select pg_temp.actor('00000000-0000-4000-8000-00000000d102','aal2');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d203')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202',0)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202',366)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202',null)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202',30,repeat('x',2001))$q$,'22023');
select set_config('ur.satellite.order',public.create_satellite_access_order('00000000-0000-4000-8000-00000000d202',30,'  Synthetic request  ')->>'id',true);
select pg_temp.assert_true((select status='waiting_quote' and duration_days=30 and quote_iqd is null and request_note='Synthetic request' and approved_at is null and expires_at is null from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Initial request terms must be unapproved and normalized');
select pg_temp.assert_true(not (public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'active')::boolean,'Pending order must not authorize satellite');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,1500,%L,7)',current_setting('ur.satellite.order'),'Forged quote'),'42501');
select pg_temp.expect_sqlstate(format('select private.quote_satellite_access_order(%L,1500,%L,7)',current_setting('ur.satellite.order'),'Forged private quote'),'42501');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.order'),'approve'),'42501');
select pg_temp.expect_sqlstate(format('update public.satellite_access_orders set status=%L where id=%L','approved',current_setting('ur.satellite.order')),'42501');
select pg_temp.expect_sqlstate('select quoted_by from public.satellite_access_orders','42501');
select pg_temp.expect_sqlstate('select * from public.satellite_access_orders','42501');
select pg_temp.expect_sqlstate(format('delete from public.satellite_access_orders where id=%L',current_setting('ur.satellite.order')),'42501');

-- The real allowlist still needs MFA for both cross-owner reads and quote/payment RPCs.
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal1');
select pg_temp.assert_true((select count(*)=0 from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'An allowlisted admin without MFA read customer orders');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,1500,%L,7)',current_setting('ur.satellite.order'),'Quoted scope'),'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal2');
select pg_temp.assert_true((select count(*)=1 from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'MFA admin could not read request');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.order'),'approve'),'42501');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,0,%L,7)',current_setting('ur.satellite.order'),'Bad quote'),'22023');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,1500,%L,0)',current_setting('ur.satellite.order'),'Bad duration'),'22023');
select public.quote_satellite_access_order(current_setting('ur.satellite.order')::uuid,1500,'Seven-day access',7);
select public.quote_satellite_access_order(current_setting('ur.satellite.order')::uuid,2400,'Nine-day access',9);

-- Stale price/duration cannot be accepted; exact accepted quote is immutable.
select pg_temp.actor('00000000-0000-4000-8000-00000000d102');
select pg_temp.expect_sqlstate(format('select public.accept_satellite_access_quote(%L,1)',current_setting('ur.satellite.order')),'55000');
select public.accept_satellite_access_quote(current_setting('ur.satellite.order')::uuid,2,'SYNTHETIC-REFERENCE');
select pg_temp.assert_true((select status='awaiting_payment' and quote_version=2 and quote_iqd=2400 and duration_days=9 and accepted_at is not null and approved_at is null and expires_at is null from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Accepted terms must retain exact price and duration without activating access');
select pg_temp.assert_true(not (public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'active')::boolean,'Customer reference alone authorized access');
select pg_temp.actor('00000000-0000-4000-8000-00000000d103');
select pg_temp.assert_true((select count(*)=0 from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Stranger read an owner order');
select pg_temp.expect_sqlstate(format('select public.accept_satellite_access_quote(%L,2)',current_setting('ur.satellite.order')),'42501');
select pg_temp.expect_sqlstate($q$select public.satellite_access_status('00000000-0000-4000-8000-00000000d202')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal2');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,3000,%L,90)',current_setting('ur.satellite.order'),'Changed after acceptance'),'55000');
select public.review_satellite_access_payment(current_setting('ur.satellite.order')::uuid,'approve','Synthetic receipt manually verified');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.order'),'approve'),'55000');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.order'),'reject'),'55000');
select pg_temp.actor('00000000-0000-4000-8000-00000000d102');
select pg_temp.assert_true((select status='approved' and expires_at-approved_at=interval '216 hours' and approved_at>=statement_timestamp()-interval '10 seconds' from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Access must start from actual payment approval for accepted duration');
select pg_temp.assert_true((public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'active')::boolean and public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'order_id'=current_setting('ur.satellite.order'),'Paid owner access was not activated');
select pg_temp.expect_sqlstate(format('update public.satellite_access_orders set expires_at=clock_timestamp()+interval %L where id=%L','365 days',current_setting('ur.satellite.order')),'42501');
reset role;

-- Expiry uses server time on every check, without mutating/deleting order history.
update public.satellite_access_orders set approved_at=statement_timestamp()-interval '10 days',expires_at=statement_timestamp()-interval '10 days'+interval '216 hours' where id=current_setting('ur.satellite.order')::uuid;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d102');
select pg_temp.assert_true(not (public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'active')::boolean,'Expired access authorized a new analysis');
select pg_temp.assert_true((select count(*)=1 from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Expired order history was removed');
reset role;
update public.satellite_access_orders set approved_at=statement_timestamp(),expires_at=statement_timestamp()+interval '216 hours' where id=current_setting('ur.satellite.order')::uuid;

-- Moving field ownership invalidates old paid ownership; it is not inherited by a new owner.
update public.farms set owner_id='00000000-0000-4000-8000-00000000d103' where id='00000000-0000-4000-8000-00000000d302';
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d102');
select pg_temp.expect_sqlstate($q$select public.satellite_access_status('00000000-0000-4000-8000-00000000d202')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000d103');
select pg_temp.assert_true(not (public.satellite_access_status('00000000-0000-4000-8000-00000000d202')->>'active')::boolean,'New field owner inherited someone else payment');
reset role;
update public.farms set owner_id='00000000-0000-4000-8000-00000000d102' where id='00000000-0000-4000-8000-00000000d302';

-- An accepted-but-unpaid deleted field cannot be approved; its history can still be rejected.
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d103');
select set_config('ur.satellite.deleted_order',public.create_satellite_access_order('00000000-0000-4000-8000-00000000d203',7)->>'id',true);
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal2');
select public.quote_satellite_access_order(current_setting('ur.satellite.deleted_order')::uuid,700,'Synthetic deleted-field order',7);
select pg_temp.actor('00000000-0000-4000-8000-00000000d103');
select public.accept_satellite_access_quote(current_setting('ur.satellite.deleted_order')::uuid,1);
reset role;
delete from public.fields where id in ('00000000-0000-4000-8000-00000000d202','00000000-0000-4000-8000-00000000d203');
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d102');
select pg_temp.assert_true((select field_id is null and status='approved' from public.satellite_access_orders where id=current_setting('ur.satellite.order')::uuid),'Deleting field must preserve paid history');
select pg_temp.expect_sqlstate($q$select public.satellite_access_status('00000000-0000-4000-8000-00000000d202')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal2');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.deleted_order'),'approve'),'42501');
select public.review_satellite_access_payment(current_setting('ur.satellite.deleted_order')::uuid,'reject','Field removed before payment');

-- A new request cannot be quoted after its field is deleted, and rejection needs no quote.
select pg_temp.actor('00000000-0000-4000-8000-00000000d106');
select set_config('ur.satellite.unquoted_deleted',public.create_satellite_access_order('00000000-0000-4000-8000-00000000d206')->>'id',true);
reset role;
delete from public.fields where id='00000000-0000-4000-8000-00000000d206';
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal2');
select pg_temp.expect_sqlstate(format('select public.quote_satellite_access_order(%L,1200,%L,30)',current_setting('ur.satellite.unquoted_deleted'),'Deleted field'),'42501');
select public.review_satellite_access_payment(current_setting('ur.satellite.unquoted_deleted')::uuid,'reject');

-- Bounded pending requests are serialized per owner, independent of other services.
select pg_temp.actor('00000000-0000-4000-8000-00000000d107');
do $$ begin for i in 1..10 loop perform public.create_satellite_access_order('00000000-0000-4000-8000-00000000d207'); end loop; end $$;
select pg_temp.expect_sqlstate($q$select public.create_satellite_access_order('00000000-0000-4000-8000-00000000d207')$q$,'55000');
select pg_temp.actor('00000000-0000-4000-8000-00000000d101','aal1');
select pg_temp.expect_sqlstate(format('select public.review_satellite_access_payment(%L,%L)',current_setting('ur.satellite.unquoted_deleted'),'reject'),'42501');
reset role;
rollback;
