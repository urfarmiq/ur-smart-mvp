-- Aggregate-only page-view statistics. This migration never reads auth.users,
-- fields, profiles, IP addresses, request headers, or browser identifiers.
-- Anonymous callers may increment an allowlisted page, but cannot read counters.
-- Read access remains restricted to the server-managed administrator with aal2.

create table if not exists private.site_page_views (
  day date not null,
  page_key text not null,
  view_count bigint not null default 1,
  last_counted_at timestamptz not null default statement_timestamp(),
  primary key (day, page_key),
  constraint site_page_views_page_allowlist check (page_key in (
    'home','dashboard','field-map','field-analysis','satellite-analysis','operations','weather'
  )),
  constraint site_page_views_count_bounds check (view_count between 1 and 100000)
);
alter table private.site_page_views enable row level security;
revoke all on table private.site_page_views from public, anon, authenticated, service_role;

create table if not exists private.site_visit_settings (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default statement_timestamp()
);
alter table private.site_visit_settings enable row level security;
revoke all on table private.site_visit_settings from public, anon, authenticated, service_role;
insert into private.site_visit_settings (singleton) values (true)
on conflict (singleton) do nothing;

-- The narrow anonymous writer deliberately uses definer privileges to update
-- otherwise-inaccessible aggregate counters. It cannot accept a date, count,
-- user identity, arbitrary path, or extra data. There is no individual visit log.
create or replace function private.record_site_visit(p_page text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_day date := (statement_timestamp() at time zone 'Asia/Baghdad')::date;
begin
  if p_page is null or char_length(p_page) > 32 or p_page not in (
    'home','dashboard','field-map','field-analysis','satellite-analysis','operations','weather'
  ) then
    raise exception 'Unknown site page' using errcode = '22023';
  end if;

  -- Atomic UPSERT handles concurrent visits without lost increments. The cap
  -- bounds counter growth; it is not bot detection or per-visitor rate limiting.
  insert into private.site_page_views as counter (day, page_key)
  values (visit_day, p_page)
  on conflict (day, page_key) do update set
    view_count = counter.view_count + 1,
    last_counted_at = statement_timestamp()
  where counter.view_count < 100000;
end;
$$;
revoke all on function private.record_site_visit(text) from public, anon, authenticated, service_role;
grant usage on schema private to anon, authenticated;
grant execute on function private.record_site_visit(text) to anon, authenticated;

create or replace function public.record_site_visit(p_page text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.record_site_visit(p_page); $$;
revoke all on function public.record_site_visit(text) from public, anon, authenticated, service_role;
grant execute on function public.record_site_visit(text) to anon, authenticated;

create or replace function private.admin_site_visits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  visit_day date := (statement_timestamp() at time zone 'Asia/Baghdad')::date;
  result jsonb;
begin
  -- Mandatory server-side authorization before reading any analytics table.
  -- This helper verifies auth.uid() against the private allowlist and signed aal.
  if not coalesce(private.can_read_signup_notifications(), false) then
    raise exception 'Administrator verification required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'started_at', (select started_at from private.site_visit_settings where singleton),
    'today_views', coalesce(sum(view_count) filter (where day = visit_day), 0),
    'week_views', coalesce(sum(view_count) filter (where day between visit_day - 6 and visit_day), 0),
    'month_views', coalesce(sum(view_count) filter (where day between visit_day - 29 and visit_day), 0),
    'total_views', coalesce(sum(view_count), 0),
    'daily', (
      select jsonb_agg(jsonb_build_object('day', calendar.day, 'views', coalesce(totals.views, 0)) order by calendar.day)
      from (select visit_day - offset_days as day from generate_series(0,29) as days(offset_days)) calendar
      left join (
        select day, sum(view_count) as views from private.site_page_views
        where day between visit_day - 29 and visit_day group by day
      ) totals using (day)
    ),
    'pages', (
      select jsonb_agg(jsonb_build_object('page', pages.page_key, 'views', coalesce(totals.views, 0))
        order by coalesce(totals.views, 0) desc, pages.page_key)
      from unnest(array['home','dashboard','field-map','field-analysis','satellite-analysis','operations','weather']) as pages(page_key)
      left join (
        select page_key, sum(view_count) as views from private.site_page_views group by page_key
      ) totals using (page_key)
    )
  ) into result from private.site_page_views;
  return result;
end;
$$;
revoke all on function private.admin_site_visits() from public, anon, authenticated, service_role;
grant execute on function private.admin_site_visits() to authenticated;

create or replace function public.admin_site_visits()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_site_visits(); $$;
revoke all on function public.admin_site_visits() from public, anon, authenticated, service_role;
grant execute on function public.admin_site_visits() to authenticated;

notify pgrst, 'reload schema';
