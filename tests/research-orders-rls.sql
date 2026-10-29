-- Run the COMPLETE script in one SQL session after the research-orders migration.
-- All fixtures are synthetic, have no email/phone, and are removed by ROLLBACK.
-- No HTTP calls, payment provider actions, real-account edits or persistent rows.
begin;
insert into auth.users (id,aud,role,email_confirmed_at,is_anonymous,raw_user_meta_data,created_at)
values
 ('00000000-0000-4000-8000-00000000f101','authenticated','authenticated',now(),false,'{}',now()),
 ('00000000-0000-4000-8000-00000000f102','authenticated','authenticated',now(),false,'{"role":"admin"}',now()),
 ('00000000-0000-4000-8000-00000000f103','authenticated','authenticated',now(),false,'{}',now()),
 ('00000000-0000-4000-8000-00000000f104','authenticated','authenticated',null,false,'{}',now()),
 ('00000000-0000-4000-8000-00000000f105','authenticated','authenticated',null,true,'{}',now()),
 ('00000000-0000-4000-8000-00000000f106','authenticated','authenticated',now(),false,'{}',now()),
 ('00000000-0000-4000-8000-00000000f107','authenticated','authenticated',now(),false,'{}',now());
insert into private.platform_admins (user_id) values ('00000000-0000-4000-8000-00000000f101');

-- The valid report envelope contains aggregate/text output only, never raw files.
select set_config('ur.research.result', jsonb_build_object(
  'schema_version',1,'created_at',statement_timestamp()::text,'task_type','combined',
  'summary','Synthetic aggregate report','methodology','[]'::jsonb,
  'interpretation','[]'::jsonb,'limitations','[]'::jsonb,'next_steps','[]'::jsonb,
  'analysis',null,'maps',null,'references','[]'::jsonb,
  'provider',jsonb_build_object('name','Google Gemini','model','test'), 'notes','[]'::jsonb
)::text,true);

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin perform public.create_research_order('Fixture topic','combined');
    raise exception 'Anonymous visitor created a paid order';
  exception when insufficient_privilege then null; end;
  begin perform id from public.research_orders;
    raise exception 'Anonymous visitor read research orders';
  exception when insufficient_privilege then null; end;
  begin perform public.review_research_order(gen_random_uuid(),'approve');
    raise exception 'Anonymous visitor reviewed a payment';
  exception when insufficient_privilege then null; end;
  begin perform public.claim_research_order(gen_random_uuid());
    raise exception 'Anonymous visitor claimed a run';
  exception when insufficient_privilege then null; end;
  begin perform public.finish_research_order(gen_random_uuid(),gen_random_uuid(),'completed','{}'::jsonb);
    raise exception 'Anonymous visitor finished a run';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f104';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f104","role":"authenticated","is_anonymous":false}';
do $$ begin
  begin perform public.create_research_order('Fixture topic','combined');
    raise exception 'Unconfirmed account created a paid order';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f105';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f105","role":"authenticated","is_anonymous":true}';
do $$ begin
  begin perform public.create_research_order('Fixture topic','combined');
    raise exception 'Anonymous sign-in account created a paid order';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f102';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f102","role":"authenticated","aal":"aal2","is_anonymous":false,"user_metadata":{"role":"admin"},"app_metadata":{"role":"admin"}}';
do $$
declare created jsonb; bad_topic text;
begin
  created := public.create_research_order('  Synthetic paid research  ','combined','TEST-TRANSFER-REFERENCE');
  perform set_config('ur.research.order',created->>'id',true);
  if created->>'status' <> 'waiting_payment' or (created->>'fee_iqd')::int <> 25000
     or created ?| array['run_token','approved_by','owner_id'] then
    raise exception 'Create result changed fixed fee, initial state or safe shape';
  end if;
  if (select topic from public.research_orders where id=(created->>'id')::uuid) <> 'Synthetic paid research' then
    raise exception 'Topic was not normalized';
  end if;
  foreach bad_topic in array array[null,'',' ',repeat('x',2001)] loop
    begin perform public.create_research_order(bad_topic,'combined');
      raise exception 'Invalid topic was accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin perform public.create_research_order('Topic','unknown');
    raise exception 'Unknown task type was accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_research_order('Topic','combined',repeat('x',121));
    raise exception 'Oversized transfer reference was accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.review_research_order((created->>'id')::uuid,'approve');
    raise exception 'User-editable/forged role claims approved own payment';
  exception when insufficient_privilege then null; end;
  begin perform private.review_research_order((created->>'id')::uuid,'approve');
    raise exception 'Direct private call bypassed administrator check';
  exception when insufficient_privilege then null; end;
  begin perform public.claim_research_order((created->>'id')::uuid);
    raise exception 'Unpaid order was claimable';
  exception when insufficient_privilege then null; end;
  begin update public.research_orders set fee_iqd=1 where id=(created->>'id')::uuid;
    raise exception 'Owner changed the server-fixed price';
  exception when insufficient_privilege then null; end;
  begin update public.research_orders set status='approved',approved_at=now() where id=(created->>'id')::uuid;
    raise exception 'Owner approved payment by direct table write';
  exception when insufficient_privilege then null; end;
  begin insert into public.research_orders(owner_id,topic,task_type) values(auth.uid(),'Forged','combined');
    raise exception 'Owner inserted directly';
  exception when insufficient_privilege then null; end;
  begin delete from public.research_orders where id=(created->>'id')::uuid;
    raise exception 'Owner deleted audit-relevant order';
  exception when insufficient_privilege then null; end;
  begin perform run_token from public.research_orders;
    raise exception 'Owner read private run capability from table';
  exception when insufficient_privilege then null; end;
  begin perform approved_by from public.research_orders;
    raise exception 'Owner read reviewer identity through table';
  exception when insufficient_privilege then null; end;
  begin perform * from public.research_orders;
    raise exception 'SELECT star exposed prohibited order columns';
  exception when insufficient_privilege then null; end;
  begin perform * from private.research_runs;
    raise exception 'Owner read private attempt audit';
  exception when insufficient_privilege then null; end;
end $$;

-- Another user cannot read, claim, finish or review the target owner's order.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f103';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f103","role":"authenticated","aal":"aal2"}';
do $$ declare target uuid := current_setting('ur.research.order')::uuid; begin
  if exists(select id from public.research_orders where id=target) then raise exception 'Cross-account order was visible'; end if;
  begin perform public.claim_research_order(target);
    raise exception 'Cross-account claim succeeded';
  exception when insufficient_privilege then null; end;
  begin perform public.finish_research_order(target,gen_random_uuid(),'completed',current_setting('ur.research.result')::jsonb);
    raise exception 'Cross-account finish succeeded';
  exception when insufficient_privilege then null; end;
  begin perform public.review_research_order(target,'approve');
    raise exception 'Ordinary member reviewed another account order';
  exception when insufficient_privilege then null; end;
  begin update public.research_orders set admin_note='Forged approval' where id=target;
    raise exception 'Cross-account direct admin write succeeded';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f101';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f101","role":"authenticated","aal":"aal1"}';
do $$ declare target uuid := current_setting('ur.research.order')::uuid; begin
  if exists(select id from public.research_orders where id=target) then raise exception 'aal1 administrator read another owner order'; end if;
  begin perform public.review_research_order(target,'approve');
    raise exception 'aal1 administrator approved payment';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f101","role":"authenticated","aal":"aal2"}';
do $$ declare target uuid := current_setting('ur.research.order')::uuid; reviewed jsonb; begin
  if not exists(select id from public.research_orders where id=target) then raise exception 'aal2 administrator cannot read payment queue'; end if;
  begin perform public.review_research_order(target,'approve',repeat('x',1001));
    raise exception 'Oversized administrator note was accepted';
  exception when invalid_parameter_value then null; end;
  reviewed := public.review_research_order(target,'approve','Synthetic manual payment confirmation');
  if reviewed->>'status' <> 'approved' or (reviewed->>'fee_iqd')::int <> 25000
     or reviewed ?| array['run_token','owner_id','approved_by','email'] then
    raise exception 'Manual approval returned unsafe or incorrect state';
  end if;
  begin perform public.claim_research_order(target);
    raise exception 'Administrator claimed another owner run';
  exception when insufficient_privilege then null; end;
  begin perform public.review_research_order(target,'reject');
    raise exception 'Reviewed payment approval was mutable';
  exception when object_not_in_prerequisite_state then null; end;
  begin update public.research_orders set fee_iqd=1 where id=target;
    raise exception 'Administrator directly changed fixed price';
  exception when insufficient_privilege then null; end;
end $$;

-- Happy path: explicit administrator approval, then owner claim and finish.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f102';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f102","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$ declare target uuid := current_setting('ur.research.order')::uuid; claimed jsonb; result jsonb := current_setting('ur.research.result')::jsonb; finished jsonb; begin
  claimed := public.claim_research_order(target);
  perform set_config('ur.research.token',claimed->>'run_token',true);
  if claimed->>'id' <> target::text or claimed->>'task_type' <> 'combined'
     or (claimed->>'attempt_count')::int <> 1 or claimed->>'run_token' is null
     or claimed ?| array['approved_by','payment_reference','admin_note','owner_id'] then
    raise exception 'Claim payload is unsafe or incomplete';
  end if;
  begin perform public.claim_research_order(target);
    raise exception 'Duplicate active claim succeeded';
  exception when object_not_in_prerequisite_state then null; end;
  begin perform public.finish_research_order(target,gen_random_uuid(),'completed',result);
    raise exception 'Wrong run capability was accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'approved',result);
    raise exception 'Finish RPC changed financial approval state';
  exception when invalid_parameter_value then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result || jsonb_build_object('summary',repeat('x',262145)));
    raise exception 'Oversized result was persisted';
  exception when invalid_parameter_value then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result || '{"raw_rows":[[1,2,3]]}'::jsonb);
    raise exception 'Arbitrary raw-file top-level payload was accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result - 'provider');
    raise exception 'Result missing required envelope property was accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result || '{"schema_version":null}'::jsonb);
    raise exception 'JSON null schema version was accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result || '{"methodology":"unstructured"}'::jsonb);
    raise exception 'Incorrect envelope property type was accepted';
  exception when invalid_parameter_value then null; end;
  finished := public.finish_research_order(target,(claimed->>'run_token')::uuid,'completed',result);
  if finished->>'status' <> 'completed' or finished->>'result_status' <> 'completed' then
    raise exception 'Approved owner completion failed';
  end if;
  begin perform public.claim_research_order(target);
    raise exception 'Completed order was mutable/claimable';
  exception when object_not_in_prerequisite_state then null; end;
  begin perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'failed',result);
    raise exception 'Completed result was overwritten';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare target uuid := current_setting('ur.research.order')::uuid; begin
  if not exists(select 1 from public.research_orders where id=target and status='completed'
    and fee_iqd=25000 and approved_by='00000000-0000-4000-8000-00000000f101'
    and approved_at is not null and attempt_count=1 and run_token is null
    and result_status='completed') then raise exception 'Finish changed payment provenance or retained capability'; end if;
  if (select count(*) from private.research_runs where order_id=target) <> 1 then
    raise exception 'Rejected duplicate claim consumed a quota slot';
  end if;
  begin update public.research_orders set fee_iqd=24999 where id=target;
    raise exception 'Database constraint permitted a different research fee';
  exception when check_violation then null; end;
end $$;

-- Synthetic approved fixtures exercise rejection, expired-lease replacement,
-- stale capabilities and the three-attempt ceiling without touching real orders.
insert into public.research_orders(id,owner_id,topic,task_type,status,approved_by,approved_at)
values ('00000000-0000-4000-8000-00000000f201','00000000-0000-4000-8000-00000000f102','Retry fixture','combined','approved','00000000-0000-4000-8000-00000000f101',now());
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f102';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f102","role":"authenticated","aal":"aal1"}';
do $$ declare claimed jsonb; begin
  claimed := public.claim_research_order('00000000-0000-4000-8000-00000000f201');
  perform set_config('ur.research.old_token',claimed->>'run_token',true);
end $$;
reset role;
update public.research_orders set started_at=statement_timestamp()-interval '181 seconds'
where id='00000000-0000-4000-8000-00000000f201';
set local role authenticated;
do $$ declare claimed jsonb; target uuid := '00000000-0000-4000-8000-00000000f201'; result jsonb := current_setting('ur.research.result')::jsonb; begin
  claimed := public.claim_research_order(target);
  if claimed->>'run_token'=current_setting('ur.research.old_token') or (claimed->>'attempt_count')::int<>2 then
    raise exception 'Expired lease did not rotate capability/consume attempt';
  end if;
  begin perform public.finish_research_order(target,current_setting('ur.research.old_token')::uuid,'completed',result);
    raise exception 'Stale run capability overwrote a new attempt';
  exception when insufficient_privilege then null; end;
  perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'needs_review',result);
  claimed := public.claim_research_order(target);
  if (claimed->>'attempt_count')::int<>3 then raise exception 'needs_review retry was not counted'; end if;
  perform public.finish_research_order(target,(claimed->>'run_token')::uuid,'failed',result);
  begin perform public.claim_research_order(target);
    raise exception 'Fourth order attempt succeeded';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;

-- Confirm rejection is final, and trusted MFA administrators can review their
-- own legitimate order; ordinary metadata-based self-approval was denied above.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f101';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f101","role":"authenticated","aal":"aal2"}';
do $$ declare created jsonb; begin
  created := public.create_research_order('Administrator-owned test','combined');
  perform public.review_research_order((created->>'id')::uuid,'approve');
  created := public.create_research_order('Rejected fixture','combined');
  perform public.review_research_order((created->>'id')::uuid,'reject','Synthetic rejected transfer');
  begin perform public.claim_research_order((created->>'id')::uuid);
    raise exception 'Rejected payment was claimable';
  exception when insufficient_privilege then null; end;
end $$;

-- Pending-order bound, including the tenth allowed and eleventh denied.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f103';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f103","role":"authenticated","aal":"aal1"}';
do $$ begin
  for n in 1..10 loop perform public.create_research_order('Pending fixture '||n,'combined'); end loop;
  begin perform public.create_research_order('Eleventh pending fixture','combined');
    raise exception 'Eleventh pending order was accepted';
  exception when object_not_in_prerequisite_state then null; end;
end $$;
reset role;

-- Owner daily cap: four synthetic audit attempts + one real claim are allowed;
-- the sixth is refused. Previous-day audit rows do not consume today's quota.
insert into public.research_orders(id,owner_id,topic,task_type,status,approved_by,approved_at)
values
 ('00000000-0000-4000-8000-00000000f202','00000000-0000-4000-8000-00000000f106','Owner quota fixture','combined','approved','00000000-0000-4000-8000-00000000f101',now()),
 ('00000000-0000-4000-8000-00000000f203','00000000-0000-4000-8000-00000000f106','Sixth owner run','combined','approved','00000000-0000-4000-8000-00000000f101',now());
-- Audit rows need distinct (order,attempt) pairs, so use separate synthetic orders.
insert into public.research_orders(id,owner_id,topic,task_type,status,approved_by,approved_at)
select gen_random_uuid(),'00000000-0000-4000-8000-00000000f106','Owner quota audit '||n,'combined','approved','00000000-0000-4000-8000-00000000f101',now()
from generate_series(1,5) n;
insert into private.research_runs(order_id,owner_id,run_token,attempt_number,created_at)
select id,owner_id,gen_random_uuid(),1,
  case when topic='Owner quota audit 5' then (date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 second' else statement_timestamp() end
from public.research_orders where owner_id='00000000-0000-4000-8000-00000000f106' and topic like 'Owner quota audit %';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f106';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f106","role":"authenticated","aal":"aal1"}';
do $$ begin
  perform public.claim_research_order('00000000-0000-4000-8000-00000000f202');
  begin perform public.claim_research_order('00000000-0000-4000-8000-00000000f203');
    raise exception 'Sixth owner daily run was accepted';
  exception when program_limit_exceeded then null; end;
end $$;
reset role;

-- Global cap: add only synthetic audit rows until today's total is exactly 29.
-- No existing audit row is modified or deleted, even inside this transaction.
insert into public.research_orders(id,owner_id,topic,task_type,status,approved_by,approved_at)
values
 ('00000000-0000-4000-8000-00000000f204','00000000-0000-4000-8000-00000000f107','Thirtieth global run','combined','approved','00000000-0000-4000-8000-00000000f101',now()),
 ('00000000-0000-4000-8000-00000000f205','00000000-0000-4000-8000-00000000f107','Thirty-first global run','combined','approved','00000000-0000-4000-8000-00000000f101',now());
do $$ declare today_total integer; fixture uuid; begin
  select count(*) into today_total from private.research_runs where created_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC';
  if today_total > 29 then raise exception 'Global quota test needs at least one unused daily slot'; end if;
  for n in 1..(29-today_total) loop
    insert into public.research_orders(owner_id,topic,task_type,status,approved_by,approved_at)
    values ('00000000-0000-4000-8000-00000000f103','Global audit fixture '||n,'combined','approved','00000000-0000-4000-8000-00000000f101',now()) returning id into fixture;
    insert into private.research_runs(order_id,owner_id,run_token,attempt_number)
    values (fixture,'00000000-0000-4000-8000-00000000f103',gen_random_uuid(),1);
  end loop;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000f107';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f107","role":"authenticated","aal":"aal1"}';
do $$ begin
  perform public.claim_research_order('00000000-0000-4000-8000-00000000f204');
  begin perform public.claim_research_order('00000000-0000-4000-8000-00000000f205');
    raise exception 'Thirty-first global daily run was accepted';
  exception when program_limit_exceeded then null; end;
  begin insert into private.research_runs(order_id,owner_id,run_token,attempt_number)
    values ('00000000-0000-4000-8000-00000000f205',auth.uid(),gen_random_uuid(),1);
    raise exception 'Owner forged private quota history';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from private.research_runs where created_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC') <> 30 then
    raise exception 'Global cap did not stop exactly at 30';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('create_research_order','review_research_order','claim_research_order','finish_research_order') and p.prosecdef) then
    raise exception 'Public research RPC runs with definer rights';
  end if;
end $$;
rollback;
