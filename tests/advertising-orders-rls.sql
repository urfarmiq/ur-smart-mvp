-- Run as one transaction after advertising_orders migration.
-- Synthetic account/order rows only; no real transfers, messages or network.
-- Capacity tests require the new placements to have no live real campaigns:
-- fail safely rather than changing an existing advertiser's purchased period.
begin;
create temporary table advertising_test_session(dummy boolean) on commit drop;
create function pg_temp.assert_true(p_test boolean,p_message text)
returns void language plpgsql security invoker as $$
begin if p_test is distinct from true then raise exception '%',p_message; end if; end $$;
create function pg_temp.expect_sqlstate(p_sql text,p_expected text)
returns void language plpgsql security invoker as $$
declare actual text;
begin
 begin execute p_sql;
 exception when others then get stacked diagnostics actual=returned_sqlstate;
  if actual<>p_expected then raise exception 'Expected SQLSTATE %, got % for %',p_expected,actual,p_sql; end if;return;
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
select pg_temp.assert_true(not exists(select 1 from public.advertising_orders where status in ('active','paused') and ends_at>clock_timestamp()),'Capacity tests require empty live placements; use an isolated test project if real campaigns are running');

insert into auth.users(id,aud,role,email_confirmed_at,is_anonymous,raw_user_meta_data,created_at)
select ('00000000-0000-4000-8000-00000000ad0'||n)::uuid,'authenticated','authenticated',case when n in (4,5) then null else now() end,n=5,'{}'::jsonb,now() from generate_series(1,8) n;
insert into private.platform_admins(user_id) values('00000000-0000-4000-8000-00000000ad01');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.advertising_orders'::regclass),'Advertising orders must use RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.advertising_orders','INSERT') and not has_table_privilege('authenticated','public.advertising_orders','UPDATE') and not has_table_privilege('authenticated','public.advertising_orders','DELETE'),'No direct client advertising writes');
select pg_temp.assert_true(not has_column_privilege('authenticated','public.advertising_orders','approved_by','SELECT') and not has_column_privilege('authenticated','public.advertising_orders','quoted_by','SELECT') and not has_column_privilege('authenticated','public.advertising_orders','published_by','SELECT') and not has_column_privilege('authenticated','public.advertising_orders','accepted_quote_version','SELECT'),'Administrator IDs and accepted internal version stay private');
select pg_temp.assert_true((select count(*)=7 and bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_advertising_order','quote_advertising_order','accept_advertising_quote','review_advertising_payment','publish_advertising_order','cancel_advertising_order','list_public_advertisements')),'All public advertising wrappers must be INVOKER');
select pg_temp.assert_true(private.advertising_url_is_safe('https://'||repeat('a',63)||'.'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',57)||'.org/path?x=1'),'A public hostname of exactly 253 characters remains valid');
select pg_temp.assert_true(not private.advertising_url_is_safe('https://'||repeat('a',63)||'.'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',58)||'.org/path'),'A 254-character public hostname must be rejected');
select pg_temp.assert_true(not private.advertising_url_is_safe('https://advertiser.example.org/path'||chr(128)||'evil') and not private.advertising_url_is_safe('https://advertiser.example.org/path'||chr(160)||'evil'),'Control characters and Unicode whitespace remain invalid');

set local role anon;
select pg_temp.actor(null);
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Fixture title','Fixture body','https://advertiser.example.org')$q$,'42501');
select pg_temp.expect_sqlstate('select id from public.advertising_orders','42501');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(gen_random_uuid(),100,'Scope',7,'Title','Body','https://advertiser.example.org','home')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.accept_advertising_quote(gen_random_uuid(),1)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(gen_random_uuid(),'approve')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(gen_random_uuid(),'publish')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.cancel_advertising_order(gen_random_uuid())$q$,'42501');
select pg_temp.assert_true(public.list_public_advertisements('home')='[]'::jsonb,'Anonymous visitors may see only active paid campaigns');
select pg_temp.expect_sqlstate($q$select public.list_public_advertisements('admin')$q$,'22023');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad04');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title','Body','https://advertiser.example.org')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad05','aal1',true);
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title','Body','https://advertiser.example.org')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad02','aal2');
do $$ declare bad_url text; begin
 foreach bad_url in array array['javascript:alert(1)','http://advertiser.example.org','https://localhost','https://foo.local','https://foo.internal','https://foo.test','https://foo.invalid','https://127.0.0.1','https://192.168.1.1','https://user:pass@advertiser.example.org','https://advertiser.example.org:8443','https://advertiser.example.org/a b',E'https://advertiser.example.org/\nsecret','https://advertiser.example.org/path'||chr(92)||'evil','https://'||repeat('a',63)||'.'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',63)||'.org',null] loop
  perform pg_temp.expect_sqlstate(format('select public.create_advertising_order(%L,%L,7,%L,%L,%L)','Fixture','home','Title','Body',bad_url),'22023');
 end loop;
end $$;
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('', 'home',7,'Title','Body','https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','private',7,'Title','Body','https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',0,'Title','Body','https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',366,'Title','Body','https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,repeat('x',121),'Body','https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title',repeat('x',801),'https://advertiser.example.org')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title','Body','https://advertiser.example.org',repeat('x',101))$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title','Body','https://advertiser.example.org',null,repeat('x',33))$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Fixture','home',7,'Title','Body','https://advertiser.example.org',null,null,repeat('x',1501))$q$,'22023');
do $$ declare created jsonb; begin
 created:=public.create_advertising_order('  Synthetic Farm Supplies  ','home',7,'  Original title  ','  Original body  ','https://advertiser.example.org/offer','  Fixture contact  ','TEST-PHONE','PRIVATE-REQUEST-NOTE');
 perform set_config('ur.ads.main',created->>'id',true);
 perform pg_temp.assert_true(created=jsonb_build_object('id',created->>'id','status','new'),'Create result has only safe ID/status');
 perform pg_temp.assert_true((select company_name='Synthetic Farm Supplies' and contact_name='Fixture contact' and ad_title='Original title' and ad_body='Original body' and quote_iqd is null and approved_at is null and starts_at is null from public.advertising_orders where id=(created->>'id')::uuid),'New order cannot invent quote, receipt or publication');
 created:=public.create_advertising_order('Cancel fixture','services',7,'Title','Body','https://advertiser.example.org');perform set_config('ur.ads.cancel',created->>'id',true);
 created:=public.create_advertising_order('Reject fixture','services',7,'Title','Body','https://advertiser.example.org');perform set_config('ur.ads.reject',created->>'id',true);
 created:=public.create_advertising_order('Accepted cancel fixture','services',7,'Title','Body','https://advertiser.example.org');perform set_config('ur.ads.accepted_cancel',created->>'id',true);
end $$;
select pg_temp.expect_sqlstate($q$update public.advertising_orders set status='active'$q$,'42501');
select pg_temp.expect_sqlstate('select * from public.advertising_orders','42501');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,100,'Scope',7,'Title','Body','https://advertiser.example.org','home')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(current_setting('ur.ads.main')::uuid,'approve')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'publish')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad03');
select pg_temp.assert_true((select count(*)=0 from public.advertising_orders),'Strangers cannot read proposals or contacts');
select pg_temp.expect_sqlstate($q$select public.accept_advertising_quote(current_setting('ur.ads.main')::uuid,1)$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.cancel_advertising_order(current_setting('ur.ads.main')::uuid)$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01');
select pg_temp.assert_true((select count(*)=0 from public.advertising_orders),'Allowlist administrator without MFA cannot read private inquiries');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,100,'Scope',7,'Title','Body','https://advertiser.example.org','home')$q$,'42501');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(current_setting('ur.ads.main')::uuid,'approve')$q$,'42501');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,100,'Scope',7,'Title','Body','https://foo.local','home')$q$,'22023');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,100,'Scope',7,'Title','Body','https://advertiser.example.org/path'||chr(92)||'evil','home')$q$,'22023');
select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,100000,'First scope',7,'First reviewed title','First body','https://advertiser.example.org/first','services');
select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,120000,'Final accepted scope',14,'Final reviewed title','Literal <img src=x> body','https://advertiser.example.org/final?source=ur','home');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad02');
select pg_temp.expect_sqlstate($q$select public.accept_advertising_quote(current_setting('ur.ads.main')::uuid,1)$q$,'55000');
select public.accept_advertising_quote(current_setting('ur.ads.main')::uuid,2,'TEST-TRANSFER-NOT-PAYMENT-PROOF');
select pg_temp.assert_true((select status='awaiting_payment' and quote_version=2 and duration_days=14 and placement='home' and ad_title='Final reviewed title' and approved_at is null and starts_at is null from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),'Acceptance binds current creative, placement, duration and amount but cannot self-pay');
select pg_temp.assert_true(public.list_public_advertisements('home')='[]'::jsonb,'Accepted unpaid order remains private');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.main')::uuid,1,'Changed',1,'Changed','Changed','https://advertiser.example.org/changed','services')$q$,'55000');
select public.review_advertising_payment(current_setting('ur.ads.main')::uuid,'approve','Fixture manual receipt');
select pg_temp.assert_true((select status='approved' and approved_at is not null and starts_at is null and ends_at is null from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),'Receipt approval must not begin duration or publish');
select pg_temp.assert_true(public.list_public_advertisements('home')='[]'::jsonb,'Paid but unpublished order remains private');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(current_setting('ur.ads.main')::uuid,'approve')$q$,'55000');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(current_setting('ur.ads.main')::uuid,'reject')$q$,'55000');
select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'publish');
select pg_temp.assert_true((select status='active' and ends_at=starts_at+interval '14 days' from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),'Publication begins exact accepted duration');
do $$ begin
 perform set_config('ur.ads.first_start',(select starts_at::text from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),true);
 perform set_config('ur.ads.first_end',(select ends_at::text from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),true);
end $$;
set local role anon;
select pg_temp.actor(null);
do $$ declare cards jsonb:=public.list_public_advertisements('home'); card jsonb; begin
 perform pg_temp.assert_true(jsonb_array_length(cards)=1,'Public home sees exactly the published fixture');
 card:=cards->0;
 perform pg_temp.assert_true((select count(*)=8 from jsonb_object_keys(card)) and card ?& array['id','company_name','ad_title','ad_body','target_url','placement','starts_at','ends_at'],'Public card is an exact eight-field projection');
 perform pg_temp.assert_true(card->>'id'=current_setting('ur.ads.main') and card->>'ad_title'='Final reviewed title' and card->>'ad_body'='Literal <img src=x> body','Public creative equals the accepted terms as plain text');
 perform pg_temp.assert_true(not (card ?| array['owner_id','contact_name','contact_phone','request_note','quote_iqd','quote_scope','payment_reference','approved_by','admin_note']),'No private advertiser/payment data leaks');
end $$;
select pg_temp.assert_true(public.list_public_advertisements('services')='[]'::jsonb,'Placement cannot be broadened by client');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'pause');
select pg_temp.assert_true(public.list_public_advertisements('home')='[]'::jsonb,'Paused campaign is absent');
select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'resume');
select pg_temp.assert_true((select starts_at=current_setting('ur.ads.first_start')::timestamptz and ends_at=current_setting('ur.ads.first_end')::timestamptz from public.advertising_orders where id=current_setting('ur.ads.main')::uuid),'Resume cannot extend or reset a paid duration');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'publish')$q$,'55000');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad02');
select pg_temp.expect_sqlstate($q$select public.cancel_advertising_order(current_setting('ur.ads.main')::uuid)$q$,'55000');
select public.cancel_advertising_order(current_setting('ur.ads.cancel')::uuid);
select pg_temp.assert_true((select status='cancelled' and approved_at is null from public.advertising_orders where id=current_setting('ur.ads.cancel')::uuid),'Cancellation preserves history without receipt');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.quote_advertising_order(current_setting('ur.ads.cancel')::uuid,100,'Scope',7,'Title','Body','https://advertiser.example.org','home')$q$,'55000');
select public.review_advertising_payment(current_setting('ur.ads.reject')::uuid,'reject','Fixture rejection');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(current_setting('ur.ads.reject')::uuid,'publish')$q$,'42501');
select public.quote_advertising_order(current_setting('ur.ads.accepted_cancel')::uuid,100,'Scope',7,'Title','Body','https://advertiser.example.org','services');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad02');
select public.accept_advertising_quote(current_setting('ur.ads.accepted_cancel')::uuid,1);
select public.cancel_advertising_order(current_setting('ur.ads.accepted_cancel')::uuid);
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.review_advertising_payment(current_setting('ur.ads.accepted_cancel')::uuid,'approve')$q$,'55000');
reset role;
do $$ declare shifted timestamptz:=clock_timestamp()-interval '15 days'; begin
 update public.advertising_orders set starts_at=shifted,ends_at=shifted+make_interval(secs=>duration_days*86400) where id=current_setting('ur.ads.main')::uuid;
end $$;
set local role anon;
select pg_temp.actor(null);
select pg_temp.assert_true(public.list_public_advertisements('home')='[]'::jsonb,'Expired active campaign must disappear without a scheduled job');
reset role;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'pause')$q$,'55000');
select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'close');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order(current_setting('ur.ads.main')::uuid,'resume')$q$,'55000');
reset role;

-- Seed only synthetic already-approved orders to exercise slot admission. The
-- main order above independently proved the complete quote/accept/receipt gate.
create function pg_temp.approved_ad(p_id uuid)
returns void language plpgsql security invoker as $$
declare stamp timestamptz:=clock_timestamp();
begin
 insert into public.advertising_orders(id,owner_id,company_name,placement,duration_days,ad_title,ad_body,target_url,status,quote_iqd,quote_scope,quote_version,quoted_by,quoted_at,accepted_quote_version,accepted_at,approved_by,approved_at,created_at,updated_at)
 values(p_id,'00000000-0000-4000-8000-00000000ad02','Synthetic capacity company','services',7,'Capacity title','Capacity body','https://advertiser.example.org','approved',100,'Capacity scope',1,'00000000-0000-4000-8000-00000000ad01',stamp-interval '3 seconds',1,stamp-interval '2 seconds','00000000-0000-4000-8000-00000000ad01',stamp-interval '1 second',stamp-interval '4 seconds',stamp);
end $$;
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae11');
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae12');
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae13');
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae14');
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae11','publish');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae12','publish');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae13','publish');
select pg_temp.assert_true(jsonb_array_length(public.list_public_advertisements('services'))=3,'Three admitted campaigns are all publicly visible');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae14','publish')$q$,'55000');
select pg_temp.assert_true((select status='approved' and starts_at is null and ends_at is null from public.advertising_orders where id='00000000-0000-4000-8000-00000000ae14'),'Fourth denied campaign must retain its entire unstarted paid duration');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae11','pause');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae14','publish')$q$,'55000');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae11','resume');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae12','close');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae14','publish');
select pg_temp.assert_true(jsonb_array_length(public.list_public_advertisements('services'))=3,'Closing releases a slot for the waiting approved campaign');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae12','resume')$q$,'55000');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae13','pause');
reset role;
do $$ declare shifted timestamptz:=clock_timestamp()-interval '8 days'; begin
 update public.advertising_orders set starts_at=shifted,ends_at=shifted+make_interval(secs=>duration_days*86400) where id='00000000-0000-4000-8000-00000000ae13';
end $$;
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae15');
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae13','resume')$q$,'55000');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae15','publish');
select pg_temp.assert_true(jsonb_array_length(public.list_public_advertisements('services'))=3,'Expired reservation releases capacity without extending the expired campaign');
reset role;
-- A privileged synthetic seed represents overbooked legacy data; resuming it
-- must still fail closed without changing the existing three active campaigns.
select pg_temp.approved_ad('00000000-0000-4000-8000-00000000ae16');
do $$ declare stamp timestamptz:=clock_timestamp(); begin
 update public.advertising_orders set status='paused',starts_at=stamp,ends_at=stamp+make_interval(secs=>duration_days*86400),published_by='00000000-0000-4000-8000-00000000ad01' where id='00000000-0000-4000-8000-00000000ae16';
end $$;
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad01','aal2');
select pg_temp.expect_sqlstate($q$select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae16','resume')$q$,'55000');
select pg_temp.assert_true((select status='paused' and ends_at=starts_at+interval '7 days' from public.advertising_orders where id='00000000-0000-4000-8000-00000000ae16'),'Denied fourth resume cannot reset or extend its clock');
select public.publish_advertising_order('00000000-0000-4000-8000-00000000ae16','close');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad06');
do $$ begin
 for i in 1..5 loop perform public.create_advertising_order('Daily fixture','home',7,'Title','Body','https://advertiser.example.org');end loop;
end $$;
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Sixth fixture','home',7,'Title','Body','https://advertiser.example.org')$q$,'54000');
do $$ declare row_id uuid; begin
 for row_id in select id from public.advertising_orders where owner_id='00000000-0000-4000-8000-00000000ad06' loop perform public.cancel_advertising_order(row_id);end loop;
end $$;
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Cancelled quota bypass','home',7,'Title','Body','https://advertiser.example.org')$q$,'54000');
reset role;
insert into public.advertising_orders(owner_id,company_name,placement,duration_days,ad_title,ad_body,target_url,created_at)
select '00000000-0000-4000-8000-00000000ad07','Pending fixture','home',7,'Title','Body','https://advertiser.example.org',statement_timestamp()-interval '1 day' from generate_series(1,10);
set local role authenticated;
select pg_temp.actor('00000000-0000-4000-8000-00000000ad07');
select pg_temp.expect_sqlstate($q$select public.create_advertising_order('Eleventh pending','home',7,'Title','Body','https://advertiser.example.org')$q$,'55000');
select pg_temp.actor('00000000-0000-4000-8000-00000000ad03','aal2');
select pg_temp.assert_true((select count(*)=0 from public.advertising_orders),'Other confirmed accounts remain isolated after publication');
reset role;
rollback;
