-- Keep the already-applied advertising workflow and rows unchanged. Align URL
-- admission with the public/admin validators before any campaigns are created.
create or replace function private.advertising_url_is_safe(p_url text)
returns boolean language sql immutable security invoker set search_path=''
as $$
 select p_url is not null and char_length(p_url) between 1 and 1000
   and position(chr(92) in p_url)=0
   and char_length(substring(p_url from '^https://([^/?#:]+)')) between 1 and 253
   and p_url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(:443)?([/?#][^[:space:][:cntrl:]]*)?$'
   and p_url !~* '^https://([^/?#]*\.)?(localhost|local|internal|test|invalid)(:443)?([/?#]|$)';
$$;
revoke all on function private.advertising_url_is_safe(text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
