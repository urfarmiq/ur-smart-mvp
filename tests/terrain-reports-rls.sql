-- Run after 20261108010000_terrain_reports.sql in a Supabase SQL session.
-- Read-only assertions: this script creates no persistent rows.
do $$
declare
 rls_enabled boolean;
begin
 select c.relrowsecurity into rls_enabled
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='terrain_reports';
 if rls_enabled is distinct from true then raise exception 'RLS is not enabled on terrain_reports'; end if;
 if not has_table_privilege('authenticated','public.terrain_reports','select') then raise exception 'authenticated lacks SELECT'; end if;
 if not has_table_privilege('authenticated','public.terrain_reports','insert') then raise exception 'authenticated lacks INSERT'; end if;
 if has_table_privilege('authenticated','public.terrain_reports','update') or has_table_privilege('authenticated','public.terrain_reports','delete') then raise exception 'reports must remain immutable'; end if;
 if has_table_privilege('anon','public.terrain_reports','select') or has_table_privilege('anon','public.terrain_reports','insert') then raise exception 'anon must not access terrain_reports'; end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='terrain_reports' and policyname='Read own terrain reports' and cmd='SELECT' and qual ilike '%auth.uid%') then raise exception 'Owner SELECT policy is missing'; end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='terrain_reports' and policyname='Insert own terrain reports' and cmd='INSERT' and with_check ilike '%auth.uid%') then raise exception 'Owner INSERT policy is missing'; end if;
end $$;
select 'terrain_reports RLS, grants and immutability checks passed' as result;
