-- Transactional integration checks. Run ONLY after reviewing/applying the migration.
-- No HTTP, confirmation emails, real-user edits or persistent test accounts.
-- The parent must execute this whole script in one transaction/session. ROLLBACK is required.
begin;

-- Synthetic IDs/addresses cannot collide with existing rows without aborting this test.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at)
values
 ('00000000-0000-4000-8000-00000000a101', 'authenticated', 'authenticated', 'ur-admin-test@example.invalid', '{"display_name":"Test administrator","role":"user","password":"must-not-be-copied","token":"must-not-be-copied"}', now()),
 ('00000000-0000-4000-8000-00000000a102', 'authenticated', 'authenticated', 'ur-member-test@example.invalid', '{"display_name":"<img src=x>","role":"admin","encrypted_password":"must-not-be-copied","session_id":"must-not-be-copied"}', now());
insert into private.platform_admins (user_id)
values ('00000000-0000-4000-8000-00000000a101');

insert into public.profiles (id,full_name) values
 ('00000000-0000-4000-8000-00000000a101','Security fixture administrator'),
 ('00000000-0000-4000-8000-00000000a102','Security fixture member')
on conflict (id) do update set full_name=excluded.full_name;

insert into public.farms (id,owner_id,name) values
 ('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-00000000a101','Security fixture farm'),
 ('00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-00000000a102','Other account fixture farm'),
 ('00000000-0000-4000-8000-00000000b103','00000000-0000-4000-8000-00000000a101','Second own fixture farm');
insert into public.fields (id,farm_id,name) values
 ('00000000-0000-4000-8000-00000000c101','00000000-0000-4000-8000-00000000b101','Own field'),
 ('00000000-0000-4000-8000-00000000c102','00000000-0000-4000-8000-00000000b102','Other account field'),
 ('00000000-0000-4000-8000-00000000c103','00000000-0000-4000-8000-00000000b103','Different own farm field');

do $$
declare snapshot jsonb;
begin
  if (select role from public.profiles where id='00000000-0000-4000-8000-00000000a102') <> 'farmer' then
    raise exception 'New account metadata changed default profile privileges';
  end if;
  if (select count(*) from public.signup_notifications where user_id in
      ('00000000-0000-4000-8000-00000000a101','00000000-0000-4000-8000-00000000a102')) <> 2 then
    raise exception 'New registrations were not captured exactly once';
  end if;
  select to_jsonb(n) into snapshot from public.signup_notifications n
    where user_id = '00000000-0000-4000-8000-00000000a102';
  if snapshot ?| array['password','encrypted_password','token','session_id','raw_user_meta_data']
     or snapshot::text like '%must-not-be-copied%' then
    raise exception 'Unexpected confidential fields in registration notification';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a102';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a102","role":"authenticated","aal":"aal2","user_metadata":{"role":"admin"}}';
do $$ begin
  if public.admin_access() then raise exception 'User metadata granted administrator access'; end if;
  if exists(select 1 from public.signup_notifications) then raise exception 'Ordinary member can read notifications'; end if;
  begin
    insert into private.platform_admins (user_id) values ('00000000-0000-4000-8000-00000000a102');
    raise exception 'Ordinary member can self-enroll administrator access';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a101';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a101","role":"authenticated","aal":"aal1"}';
do $$ begin
  if not public.admin_access() then raise exception 'Administrator cannot discover own role for MFA setup'; end if;
  if exists(select 1 from public.signup_notifications) then raise exception 'aal1 administrator can read notifications'; end if;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a101","role":"authenticated","aal":"aal2"}';
do $$ begin
  if (select count(*) from public.signup_notifications where user_id in
      ('00000000-0000-4000-8000-00000000a101','00000000-0000-4000-8000-00000000a102')) <> 2 then
    raise exception 'aal2 administrator cannot read notifications';
  end if;
  update public.signup_notifications set seen_at = now()
    where user_id = '00000000-0000-4000-8000-00000000a102';
  if not found then raise exception 'Administrator cannot acknowledge notification'; end if;
  begin
    update public.signup_notifications set email = 'forged@example.invalid'
      where user_id = '00000000-0000-4000-8000-00000000a102';
    raise exception 'Administrator can change notification identity';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.signup_notifications (user_id,email,registered_at)
      values ('00000000-0000-4000-8000-00000000a102','forged@example.invalid',now());
    raise exception 'Client can forge a registration notification';
  exception when insufficient_privilege then null; end;
end $$;

-- Valid writes remain possible; reference changes cannot cross an account or farm.
insert into public.field_reports (id,owner_id,farm_id,field_id,field_name,area_donum)
values ('00000000-0000-4000-8000-00000000d101','00000000-0000-4000-8000-00000000a101','00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-00000000c101','Fixture report',1);
insert into public.field_recommendations (id,owner_id,farm_id,field_id,crop,recommendation)
values ('00000000-0000-4000-8000-00000000d102','00000000-0000-4000-8000-00000000a101','00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-00000000c101','Fixture crop','Fixture advice');
do $$
declare target uuid;
begin
  update public.field_reports set notes='Valid owner update' where id='00000000-0000-4000-8000-00000000d101';
  if not found then raise exception 'Valid owner report update was blocked'; end if;
  foreach target in array array['00000000-0000-4000-8000-00000000c102'::uuid,'00000000-0000-4000-8000-00000000c103'::uuid] loop
    begin
      update public.field_reports set field_id=target where id='00000000-0000-4000-8000-00000000d101';
      raise exception 'Report accepted a foreign or mismatched field';
    exception when insufficient_privilege then null; end;
    begin
      update public.field_recommendations set field_id=target where id='00000000-0000-4000-8000-00000000d102';
      raise exception 'Recommendation accepted a foreign or mismatched field';
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    update public.field_reports set farm_id='00000000-0000-4000-8000-00000000b102' where id='00000000-0000-4000-8000-00000000d101';
    raise exception 'Report accepted another account farm';
  exception when insufficient_privilege then null; end;
  begin
    update public.field_recommendations set farm_id='00000000-0000-4000-8000-00000000b102' where id='00000000-0000-4000-8000-00000000d102';
    raise exception 'Recommendation accepted another account farm';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update auth.users set email_confirmed_at = now()
  where id = '00000000-0000-4000-8000-00000000a102';
do $$ begin
  if not exists(select 1 from public.signup_notifications
      where user_id = '00000000-0000-4000-8000-00000000a102'
        and email_confirmed_at is not null and seen_at is not null) then
    raise exception 'Confirmation update or existing read marker was lost';
  end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform 1 from public.signup_notifications;
    raise exception 'Anonymous visitor has notification table privilege';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
