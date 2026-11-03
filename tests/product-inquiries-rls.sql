-- Run the COMPLETE script after product_inquiries in one SQL session.
-- Synthetic accounts have no email/phone; every fixture ends in ROLLBACK.
-- No real customer edits, messages, provider calls, payment or fulfilment actions.
begin;
create temporary table product_inquiry_test_session(dummy boolean) on commit drop;
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
select ('00000000-0000-4000-8000-00000000e10'||n)::uuid,'authenticated','authenticated',case when n in (4,5) then null else now() end,n=5,'{}'::jsonb,now() from generate_series(1,8) n;
insert into private.platform_admins(user_id) values('00000000-0000-4000-8000-00000000e101');

select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.product_inquiries'::regclass),'Product enquiries must use RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.product_inquiries','INSERT') and not has_table_privilege('authenticated','public.product_inquiries','UPDATE') and not has_table_privilege('authenticated','public.product_inquiries','DELETE'),'Clients must not directly write enquiries or quotes');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.product_inquiries','reviewed_by','SELECT'),'Private reviewer identity must not be readable');
select pg_temp.assert_true((select count(*)=3 and bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_product_inquiry','review_product_inquiry','cancel_product_inquiry')),'Public product RPC wrappers must be INVOKER');

set local role anon;
select pg_temp.actor(null);
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit')$q$,'42501');
select pg_temp.expect_sqlstate('select id from public.product_inquiries','42501');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(gen_random_uuid(),'reviewing')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.cancel_product_inquiry(gen_random_uuid())$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e104');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000e105','aal1',true);
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('weather_station',1,'wasit')$q$,'42501');

select pg_temp.actor('00000000-0000-4000-8000-00000000e102','aal2');
-- Even metadata claiming administrator cannot create outside Wasit installations.
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_installation',1,'baghdad')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_installation',2,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('unknown',1,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry(null,1,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',0,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',10001,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',null,'wasit')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,null)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'unknown')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit',repeat('x',121))$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_installation',1,'wasit',null,0)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_installation',1,'wasit',null,1000001)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_installation',1,'wasit',null,'NaN'::numeric)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit',null,null,repeat('0',33))$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit',null,null,null,repeat('x',1501))$q$,'22023');
do $$ declare created jsonb; begin
 created:=public.create_product_inquiry('drip_installation',1,'wasit','  Synthetic district  ',4.25,'  TEST-CONTACT  ','  Synthetic installation request  ');
 perform set_config('ur.products.installation',created->>'id',true);
 perform pg_temp.assert_true(created=jsonb_build_object('id',created->>'id','status','new'),'Create must return only ID and new status');
 perform pg_temp.assert_true((select district='Synthetic district' and contact_phone='TEST-CONTACT' and customer_note='Synthetic installation request' and quote_iqd is null and admin_reply is null and area_donum=4.25 and province='wasit' and quantity=1 from public.product_inquiries where id=(created->>'id')::uuid),'Creation must preserve valid Wasit request without inventing a quote');
 created:=public.create_product_inquiry('weather_station',2,'baghdad');perform set_config('ur.products.weather',created->>'id',true);
 created:=public.create_product_inquiry('pest_station',1,'basra');perform set_config('ur.products.pest',created->>'id',true);
 created:=public.create_product_inquiry('drip_supplies',10000,'erbil');perform set_config('ur.products.supplies',created->>'id',true);
 created:=public.create_product_inquiry('drip_supplies',1,'wasit');perform set_config('ur.products.cancel',created->>'id',true);
end $$;
select pg_temp.assert_true((select count(*)=5 from public.product_inquiries),'Owner should read exactly own requests');
select pg_temp.expect_sqlstate('select reviewed_by from public.product_inquiries','42501');
select pg_temp.expect_sqlstate($q$insert into public.product_inquiries(owner_id,item_code,quantity,province) values(auth.uid(),'drip_installation',1,'baghdad')$q$,'42501');
select pg_temp.expect_sqlstate($q$update public.product_inquiries set status='quoted',quote_iqd=1,admin_reply='forged' where id=current_setting('ur.products.installation')::uuid$q$,'42501');
select pg_temp.expect_sqlstate('delete from public.product_inquiries','42501');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','forged',1)$q$,'42501');
select public.cancel_product_inquiry(current_setting('ur.products.cancel')::uuid);
select pg_temp.expect_sqlstate($q$select public.cancel_product_inquiry(current_setting('ur.products.cancel')::uuid)$q$,'55000');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('drip_supplies',1,'wasit')$q$,'54000');

select pg_temp.actor('00000000-0000-4000-8000-00000000e103','aal2');
select pg_temp.assert_true((select count(*)=0 from public.product_inquiries),'Stranger must not read owner enquiries');
select pg_temp.expect_sqlstate($q$select public.cancel_product_inquiry(current_setting('ur.products.installation')::uuid)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'reviewing')$q$,'42501');
select set_config('ur.products.stranger',(public.create_product_inquiry('pest_station',1,'duhok')->>'id'),true);

select pg_temp.actor('00000000-0000-4000-8000-00000000e101','aal1');
select pg_temp.assert_true((select count(*)=0 from public.product_inquiries),'Allowlisted administrator without MFA must not read customers');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'reviewing')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000e101','aal2');
select pg_temp.assert_true((select count(*)=6 from public.product_inquiries),'MFA allowlisted administrator should read requests');
select pg_temp.expect_sqlstate('select reviewed_by from public.product_inquiries','42501');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(gen_random_uuid(),'reviewing')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'paid','bad',1)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,null)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','Scope',null)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','  ',100)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','Scope',0)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','Scope',1000000001)$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'reviewing',repeat('x',2001))$q$,'22023');
do $$ declare reviewed jsonb; begin
 reviewed:=public.review_product_inquiry(current_setting('ur.products.installation')::uuid,'quoted','  Synthetic installation scope  ',150000);
 perform pg_temp.assert_true(reviewed=jsonb_build_object('id',current_setting('ur.products.installation'),'status','quoted','quote_iqd',150000,'admin_reply','Synthetic installation scope'),'Review must return normalized actual offer terms only');
end $$;
select public.review_product_inquiry(current_setting('ur.products.weather')::uuid,'reviewing','Checking model availability');
select public.review_product_inquiry(current_setting('ur.products.pest')::uuid,'closed','No fulfilment or charge recorded');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.pest')::uuid,'quoted','reopen',100)$q$,'55000');
select pg_temp.expect_sqlstate($q$select public.review_product_inquiry(current_setting('ur.products.cancel')::uuid,'reviewing')$q$,'55000');

select pg_temp.actor('00000000-0000-4000-8000-00000000e102');
select pg_temp.assert_true((select count(*)=5 from public.product_inquiries),'Owner visibility must remain scoped after administrator review');
select pg_temp.assert_true((select status='quoted' and quote_iqd=150000 and admin_reply='Synthetic installation scope' and province='wasit' from public.product_inquiries where id=current_setting('ur.products.installation')::uuid),'Owner should read actual quote and its scoped request');
select pg_temp.expect_sqlstate($q$select public.cancel_product_inquiry(current_setting('ur.products.installation')::uuid)$q$,'55000');
select public.cancel_product_inquiry(current_setting('ur.products.weather')::uuid);
select pg_temp.assert_true((select status='cancelled' and admin_reply='Checking model availability' from public.product_inquiries where id=current_setting('ur.products.weather')::uuid),'Cancelling a reviewing request must preserve prior reply');
select pg_temp.expect_sqlstate($q$select public.cancel_product_inquiry(current_setting('ur.products.pest')::uuid)$q$,'55000');
select pg_temp.assert_true((select count(*)=0 from public.product_inquiries where id=current_setting('ur.products.stranger')::uuid),'Another customers quote/request must remain hidden');

-- Server constraints remain effective for privileged maintenance, not just RPC clients.
reset role;
select pg_temp.expect_sqlstate($q$insert into public.product_inquiries(owner_id,item_code,quantity,province) values('00000000-0000-4000-8000-00000000e106','drip_installation',1,'baghdad')$q$,'23514');
select pg_temp.expect_sqlstate($q$insert into public.product_inquiries(owner_id,item_code,quantity,province) values('00000000-0000-4000-8000-00000000e106','drip_installation',2,'wasit')$q$,'23514');
select pg_temp.expect_sqlstate($q$insert into public.product_inquiries(owner_id,item_code,quantity,province,status) values('00000000-0000-4000-8000-00000000e106','drip_supplies',1,'wasit','quoted')$q$,'23514');
insert into public.product_inquiries(owner_id,item_code,quantity,province,created_at,updated_at)
select '00000000-0000-4000-8000-00000000e107','drip_supplies',1,'wasit',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days' from generate_series(1,10);
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000e107');
select pg_temp.expect_sqlstate($q$select public.create_product_inquiry('weather_station',1,'wasit')$q$,'55000');
select public.cancel_product_inquiry((select id from public.product_inquiries order by id limit 1));
select public.create_product_inquiry('weather_station',1,'wasit');
select pg_temp.assert_true((select count(*)=10 from public.product_inquiries where status in ('new','reviewing','quoted')),'Cancelling one pending request permits one replacement without removing history');

reset role;
select pg_temp.assert_true((select count(*)=8 from auth.users where id::text like '00000000-0000-4000-8000-00000000e10%'),'All test users should exist only inside the test transaction');
select jsonb_build_object('product_inquiries_rls','passed','scope','synthetic data; complete transaction is rolled back','tests',jsonb_build_array('owner isolation','MFA administration','Wasit-only installation','quantity/province/text/area bounds','direct-write and private-column denial','quote proposal requirements','closed/cancelled transitions','daily5 and pending10 limits')) as verification;
rollback;
