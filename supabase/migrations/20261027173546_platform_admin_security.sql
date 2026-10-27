-- UR Smart additive security migration, generated with Supabase CLI 2.122.0.
-- No administrator is granted here. The owner is seeded separately using a verified auth.users UUID.
-- No historical registrations are copied; only events after trigger installation are captured.

-- Keep the internal DDL hook, but remove its unnecessary public RPC execution grants.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end $$;

-- Reports and recommendations must keep every linked farm/field inside the caller's
-- account. Restrictive policies supplement existing owner policies without deleting rows.
drop policy if exists "Report references remain in own farm" on public.field_reports;
create policy "Report references remain in own farm"
on public.field_reports as restrictive for all to authenticated
using (owner_id=(select auth.uid()))
with check (
  owner_id=(select auth.uid())
  and exists(select 1 from public.farms f where f.id=field_reports.farm_id and f.owner_id=(select auth.uid()))
  and (field_id is null or exists(select 1 from public.fields f where f.id=field_reports.field_id and f.farm_id=field_reports.farm_id))
);
drop policy if exists "Recommendation references remain in own account" on public.field_recommendations;
create policy "Recommendation references remain in own account"
on public.field_recommendations as restrictive for all to authenticated
using (owner_id=(select auth.uid()))
with check (
  owner_id=(select auth.uid())
  and (farm_id is null or exists(select 1 from public.farms f where f.id=field_recommendations.farm_id and f.owner_id=(select auth.uid())))
  and (field_id is null or exists(select 1 from public.fields fld join public.farms f on f.id=fld.farm_id where fld.id=field_recommendations.field_id and f.owner_id=(select auth.uid()) and (field_recommendations.farm_id is null or fld.farm_id=field_recommendations.farm_id)))
);

create schema if not exists private;

create table if not exists private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  added_at timestamptz not null default now()
);
alter table private.platform_admins enable row level security;
revoke all on table private.platform_admins from public, anon, authenticated, service_role;

-- The definer reads only a server-managed allowlist for the caller's authenticated identity.
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from private.platform_admins as administrator
      where administrator.user_id = (select auth.uid()) and administrator.active
    );
$$;
revoke all on function private.is_platform_admin() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.is_platform_admin() to authenticated;

-- aal1 may discover only its own role so an administrator can enroll MFA.
-- This invoker RPC cannot accept another user's UUID or grant administrator access.
create or replace function public.admin_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_platform_admin(); $$;
revoke all on function public.admin_access() from public, anon, authenticated, service_role;
grant execute on function public.admin_access() to authenticated;

create or replace function private.can_read_signup_notifications()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select private.is_platform_admin())
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$$;
revoke all on function private.can_read_signup_notifications() from public, anon, authenticated, service_role;
grant execute on function private.can_read_signup_notifications() to authenticated;

create table if not exists public.signup_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  display_name text,
  registered_at timestamptz not null,
  email_confirmed_at timestamptz,
  seen_at timestamptz,
  constraint signup_notifications_email_length check (email is null or char_length(email) <= 320),
  constraint signup_notifications_name_length check (display_name is null or char_length(display_name) <= 120)
);
create index if not exists signup_notifications_registered_idx
  on public.signup_notifications (registered_at desc, id desc);
create index if not exists signup_notifications_unseen_idx
  on public.signup_notifications (registered_at desc) where seen_at is null;
alter table public.signup_notifications enable row level security;

-- Revoke platform default table grants, then permit only authenticated RLS reads
-- and the single read-marker column. No client may INSERT, DELETE, or edit identity fields.
revoke all on table public.signup_notifications from public, anon, authenticated, service_role;
grant select on table public.signup_notifications to authenticated;
grant update (seen_at) on table public.signup_notifications to authenticated;

drop policy if exists "Administrators read registration notifications" on public.signup_notifications;
create policy "Administrators read registration notifications"
on public.signup_notifications for select to authenticated
using ((select private.can_read_signup_notifications()));

drop policy if exists "Administrators acknowledge registration notifications" on public.signup_notifications;
create policy "Administrators acknowledge registration notifications"
on public.signup_notifications for update to authenticated
using ((select private.can_read_signup_notifications()))
with check ((select private.can_read_signup_notifications()));

-- The only privileged writer is a trigger attached to auth.users.
-- Read only named, allowlisted columns/metadata strings: never serialize NEW or metadata.
create or replace function private.capture_signup_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  public_name text;
  public_email text;
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users' or tg_when <> 'AFTER'
     or tg_op not in ('INSERT', 'UPDATE') then
    raise exception 'Invalid registration notification trigger context' using errcode = '42501';
  end if;

  public_name := coalesce(
    case when jsonb_typeof(new.raw_user_meta_data->'display_name') = 'string'
      then nullif(left(btrim(new.raw_user_meta_data->>'display_name'), 120), '') end,
    case when jsonb_typeof(new.raw_user_meta_data->'full_name') = 'string'
      then nullif(left(btrim(new.raw_user_meta_data->>'full_name'), 120), '') end,
    case when jsonb_typeof(new.raw_user_meta_data->'name') = 'string'
      then nullif(left(btrim(new.raw_user_meta_data->>'name'), 120), '') end
  );
  public_email := nullif(left(btrim(new.email), 320), '');

  if tg_op = 'INSERT' then
    -- Farms reference profiles.id. Initialize only a new account's unprivileged
    -- profile; never copy a role supplied in user-editable metadata.
    insert into public.profiles (id, full_name, role)
    values (new.id, coalesce(public_name, ''), 'farmer')
    on conflict (id) do nothing;
    insert into public.signup_notifications (
      user_id, email, display_name, registered_at, email_confirmed_at
    ) values (
      new.id, public_email, public_name,
      coalesce(new.created_at, statement_timestamp()), new.email_confirmed_at
    ) on conflict (user_id) do update set
      email = excluded.email,
      display_name = excluded.display_name,
      email_confirmed_at = excluded.email_confirmed_at;
  else
    -- Confirmation or public-profile changes update an existing notification only;
    -- no implicit historical backfill and no reset of the administrator's read marker.
    update public.signup_notifications set
      email = public_email,
      display_name = public_name,
      email_confirmed_at = new.email_confirmed_at
    where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_signup_notification() from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.capture_signup_notification() to supabase_auth_admin;

drop trigger if exists ur_capture_signup_notification on auth.users;
create trigger ur_capture_signup_notification
after insert on auth.users
for each row execute function private.capture_signup_notification();

notify pgrst, 'reload schema';

drop trigger if exists ur_update_signup_notification on auth.users;
create trigger ur_update_signup_notification
after update of email, email_confirmed_at, raw_user_meta_data on auth.users
for each row execute function private.capture_signup_notification();
