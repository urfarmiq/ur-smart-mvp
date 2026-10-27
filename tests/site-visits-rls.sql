-- Execute this complete script in one database session after the analytics
-- migration. All accounts, counters, and notices created here are rolled back.
-- No emails are sent, no real account is changed, and no raw visit data exists.
begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at)
values
 ('00000000-0000-4000-8000-00000000e101','authenticated','authenticated','ur-visits-admin@example.invalid','{"role":"farmer"}',now()),
 ('00000000-0000-4000-8000-00000000e102','authenticated','authenticated','ur-visits-member@example.invalid','{"role":"admin"}',now());
insert into private.platform_admins (user_id) values ('00000000-0000-4000-8000-00000000e101');

-- Remember actual totals instead of assuming an empty production database.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e101';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e101","role":"authenticated","aal":"aal2"}';
do $$ declare snapshot jsonb; begin
  snapshot := public.admin_site_visits();
  perform set_config('ur.visits.baseline', snapshot::text, true);
end $$;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"anon"}';
do $$ declare bad_page text; begin
  perform public.record_site_visit('home');
  perform public.record_site_visit('home');
  perform public.record_site_visit('weather');
  foreach bad_page in array array[null,'','admin','auth','home?email=private@example.invalid',repeat('x',500)] loop
    begin
      perform public.record_site_visit(bad_page);
      raise exception 'Invalid page was accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.admin_site_visits();
    raise exception 'Anonymous visitor read private analytics';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.site_page_views;
    raise exception 'Anonymous visitor read aggregate table directly';
  exception when insufficient_privilege then null; end;
  begin
    insert into private.site_page_views (day,page_key,view_count) values (current_date,'home',500);
    raise exception 'Anonymous visitor can choose counter or date';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.site_visit_settings;
    raise exception 'Anonymous visitor read analytics settings directly';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.platform_admins;
    raise exception 'Private schema usage exposed administrator allowlist';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e102';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e102","role":"authenticated","aal":"aal2","user_metadata":{"role":"admin"}}';
do $$ begin
  perform public.record_site_visit('dashboard');
  begin
    perform public.admin_site_visits();
    raise exception 'Ordinary member read private analytics';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.site_page_views;
    raise exception 'Member read aggregate table directly';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e101';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e101","role":"authenticated","aal":"aal1"}';
do $$ begin
  begin
    perform public.admin_site_visits();
    raise exception 'Administrator without MFA read analytics';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e101","role":"authenticated","aal":"aal2"}';
do $$
declare snapshot jsonb; baseline jsonb := current_setting('ur.visits.baseline')::jsonb; metric text; today_text text;
begin
  snapshot := public.admin_site_visits();
  foreach metric in array array['today_views','week_views','month_views','total_views'] loop
    if (snapshot->>metric)::bigint <> (baseline->>metric)::bigint + 4 then
      raise exception 'Counter mismatch: %', metric;
    end if;
  end loop;
  if jsonb_array_length(snapshot->'daily') <> 30 or jsonb_array_length(snapshot->'pages') <> 7 then
    raise exception 'Daily or page series has unexpected length';
  end if;
  today_text := ((statement_timestamp() at time zone 'Asia/Baghdad')::date)::text;
  if (snapshot->'daily'->29->>'day') <> today_text
     or (snapshot->'daily'->29->>'views')::bigint <> (snapshot->>'today_views')::bigint then
    raise exception 'Baghdad current day is inconsistent';
  end if;
  if snapshot->>'started_at' is null or snapshot ?| array['user_id','ip','email','session_id'] then
    raise exception 'Missing start time or unexpected personal analytics data';
  end if;
  begin
    update private.site_page_views set view_count=100 where page_key='home';
    raise exception 'Administrator can mutate aggregate table directly';
  exception when insufficient_privilege then null; end;
end $$;

-- Isolate a cap test inside the same rollback-only transaction.
reset role;
insert into private.site_page_views (day,page_key,view_count)
values ((statement_timestamp() at time zone 'Asia/Baghdad')::date,'field-analysis',100000)
on conflict (day,page_key) do update set view_count=100000;
set local role anon;
select public.record_site_visit('field-analysis');
reset role;
do $$ begin
  if (select view_count from private.site_page_views
      where day=(statement_timestamp() at time zone 'Asia/Baghdad')::date and page_key='field-analysis') <> 100000 then
    raise exception 'Daily per-page cap was not respected';
  end if;
  if (select count(*) from information_schema.columns where table_schema='private' and table_name='site_page_views') <> 4 then
    raise exception 'Unexpected individual visitor columns';
  end if;
end $$;
rollback;
