-- Additive advertising orders; no advertisements become public until accepted,
-- manually paid and explicitly published by an MFA allowlisted administrator.
create function private.advertising_url_is_safe(p_url text)
returns boolean language sql immutable security invoker set search_path=''
as $$
 select p_url is not null and char_length(p_url) between 1 and 1000
   and p_url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(:443)?([/?#][^[:space:][:cntrl:]]*)?$'
   and p_url !~* '^https://([^/?#]*\.)?(localhost|local|internal|test|invalid)(:443)?([/?#]|$)';
$$;
revoke all on function private.advertising_url_is_safe(text) from public,anon,authenticated,service_role;

create table public.advertising_orders (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 company_name text not null check (char_length(btrim(company_name)) between 1 and 120),
 contact_name text check (contact_name is null or char_length(contact_name)<=100),
 contact_phone text check (contact_phone is null or char_length(contact_phone)<=32),
 request_note text check (request_note is null or char_length(request_note)<=1500),
 placement text not null check (placement in ('home','services')),
 duration_days integer not null check (duration_days between 1 and 365),
 ad_title text not null check (char_length(btrim(ad_title)) between 1 and 120),
 ad_body text not null check (char_length(btrim(ad_body)) between 1 and 800),
 target_url text not null check (private.advertising_url_is_safe(target_url)),
 status text not null default 'new' check (status in ('new','quoted','awaiting_payment','approved','active','paused','closed','rejected','cancelled')),
 quote_iqd integer check (quote_iqd between 1 and 1000000000),
 quote_scope text check (quote_scope is null or char_length(btrim(quote_scope)) between 1 and 2000),
 quote_version integer not null default 0 check (quote_version>=0),
 quoted_by uuid references auth.users(id),
 quoted_at timestamptz,
 accepted_quote_version integer,
 accepted_at timestamptz,
 payment_reference text check (payment_reference is null or char_length(payment_reference)<=120),
 admin_note text check (admin_note is null or char_length(admin_note)<=1000),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 published_by uuid references auth.users(id),
 starts_at timestamptz,
 ends_at timestamptz,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 constraint advertising_quote_shape check ((quote_version=0 and quote_iqd is null and quote_scope is null and quoted_by is null and quoted_at is null) or (quote_version>0 and quote_iqd is not null and quote_scope is not null and quoted_by is not null and quoted_at is not null)),
 constraint advertising_acceptance_shape check ((accepted_at is null and accepted_quote_version is null) or (accepted_at is not null and accepted_quote_version is not null and accepted_quote_version=quote_version and quote_iqd is not null)),
 constraint advertising_quoted_state check (status not in ('quoted','awaiting_payment','approved','active','paused','closed') or quote_version>0),
 constraint advertising_accepted_state check (status not in ('awaiting_payment','approved','active','paused','closed') or accepted_at is not null),
 constraint advertising_approval_shape check ((approved_at is null and approved_by is null and status in ('new','quoted','awaiting_payment','rejected','cancelled')) or (approved_at is not null and approved_by is not null and accepted_at is not null and status in ('approved','active','paused','closed'))),
 constraint advertising_publication_shape check ((starts_at is null and ends_at is null and published_by is null and status not in ('active','paused')) or (starts_at is not null and ends_at is not null and ends_at=starts_at+make_interval(secs=>duration_days*86400) and published_by is not null and approved_at is not null and status in ('active','paused','closed')))
);
create index advertising_orders_owner_created_idx on public.advertising_orders(owner_id,created_at desc,id);
create index advertising_orders_pending_idx on public.advertising_orders(created_at,id) where status in ('new','quoted','awaiting_payment','approved');
create index advertising_orders_public_idx on public.advertising_orders(placement,ends_at desc,starts_at desc,id) where status='active';
create index advertising_orders_quoted_by_idx on public.advertising_orders(quoted_by) where quoted_by is not null;
create index advertising_orders_approved_by_idx on public.advertising_orders(approved_by) where approved_by is not null;
create index advertising_orders_published_by_idx on public.advertising_orders(published_by) where published_by is not null;
alter table public.advertising_orders enable row level security;
revoke all on public.advertising_orders from public,anon,authenticated,service_role;
grant select(id,owner_id,company_name,contact_name,contact_phone,request_note,placement,duration_days,ad_title,ad_body,target_url,status,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,admin_note,approved_at,starts_at,ends_at,created_at,updated_at) on public.advertising_orders to authenticated;
create policy "Owners and MFA administrators read advertising orders" on public.advertising_orders for select to authenticated using (owner_id=(select auth.uid()) or (select private.can_read_signup_notifications()));
comment on table public.advertising_orders is 'Private advertiser inquiries, accepted offers and manual receipts. Public listing is an explicit projection of currently active paid campaigns only, not proof of clicks or impressions.';
comment on column public.advertising_orders.starts_at is 'Actual first publication time; payment approval alone does not start or publish an advertisement.';
comment on column public.advertising_orders.ends_at is 'First publication plus accepted 24-hour days. Pausing and resuming never extend this period.';

create function private.create_advertising_order(p_company_name text,p_placement text,p_duration_days integer,p_ad_title text,p_ad_body text,p_target_url text,p_contact_name text default null,p_contact_phone text default null,p_request_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); new_id uuid; checked_at timestamptz; day_start timestamptz;
begin
 if p_company_name is null or char_length(btrim(p_company_name)) not between 1 and 120 or p_placement is null or p_placement not in ('home','services') or p_duration_days is null or p_duration_days not between 1 and 365 or p_ad_title is null or char_length(btrim(p_ad_title)) not between 1 and 120 or p_ad_body is null or char_length(btrim(p_ad_body)) not between 1 and 800 or not private.advertising_url_is_safe(p_target_url) or (p_contact_name is not null and char_length(p_contact_name)>100) or (p_contact_phone is not null and char_length(p_contact_phone)>32) or (p_request_note is not null and char_length(p_request_note)>1500) then raise exception 'Invalid advertising request' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72105,pg_catalog.hashtext(actor::text));
 checked_at:=clock_timestamp();day_start:=date_trunc('day',checked_at at time zone 'UTC') at time zone 'UTC';
 if (select count(*) from public.advertising_orders where owner_id=actor and status in ('new','quoted','awaiting_payment'))>=10 then raise exception 'Pending advertising order limit reached' using errcode='55000'; end if;
 if (select count(*) from public.advertising_orders where owner_id=actor and created_at>=day_start)>=5 then raise exception 'Daily advertising order limit reached' using errcode='54000'; end if;
 insert into public.advertising_orders(owner_id,company_name,contact_name,contact_phone,request_note,placement,duration_days,ad_title,ad_body,target_url,created_at,updated_at)
 values(actor,btrim(p_company_name),nullif(btrim(p_contact_name),''),nullif(btrim(p_contact_phone),''),nullif(btrim(p_request_note),''),p_placement,p_duration_days,btrim(p_ad_title),btrim(p_ad_body),p_target_url,checked_at,checked_at) returning id into new_id;
 return jsonb_build_object('id',new_id,'status','new');
end;
$$;
revoke all on function private.create_advertising_order(text,text,integer,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.create_advertising_order(text,text,integer,text,text,text,text,text,text) to authenticated;
create function public.create_advertising_order(p_company_name text,p_placement text,p_duration_days integer,p_ad_title text,p_ad_body text,p_target_url text,p_contact_name text default null,p_contact_phone text default null,p_request_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_advertising_order(p_company_name,p_placement,p_duration_days,p_ad_title,p_ad_body,p_target_url,p_contact_name,p_contact_phone,p_request_note); $$;
revoke all on function public.create_advertising_order(text,text,integer,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_advertising_order(text,text,integer,text,text,text,text,text,text) to authenticated;

create function private.quote_advertising_order(p_order_id uuid,p_amount_iqd integer,p_scope text,p_duration_days integer,p_ad_title text,p_ad_body text,p_target_url text,p_placement text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.advertising_orders%rowtype;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_amount_iqd is null or p_amount_iqd not between 1 and 1000000000 or p_scope is null or char_length(btrim(p_scope)) not between 1 and 2000 or p_duration_days is null or p_duration_days not between 1 and 365 or p_ad_title is null or char_length(btrim(p_ad_title)) not between 1 and 120 or p_ad_body is null or char_length(btrim(p_ad_body)) not between 1 and 800 or not private.advertising_url_is_safe(p_target_url) or p_placement is null or p_placement not in ('home','services') then raise exception 'Invalid advertising quote' using errcode='22023'; end if;
 select * into target from public.advertising_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status not in ('new','quoted') or target.accepted_at is not null or target.approved_at is not null then raise exception 'Accepted or reviewed advertising quotes cannot change' using errcode='55000'; end if;
 update public.advertising_orders set status='quoted',quote_iqd=p_amount_iqd,quote_scope=btrim(p_scope),duration_days=p_duration_days,ad_title=btrim(p_ad_title),ad_body=btrim(p_ad_body),target_url=p_target_url,placement=p_placement,quote_version=quote_version+1,quoted_by=actor,quoted_at=clock_timestamp(),updated_at=clock_timestamp() where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'status',target.status,'quote_iqd',target.quote_iqd,'quote_scope',target.quote_scope,'quote_version',target.quote_version,'duration_days',target.duration_days,'ad_title',target.ad_title,'ad_body',target.ad_body,'target_url',target.target_url,'placement',target.placement);
end;
$$;
revoke all on function private.quote_advertising_order(uuid,integer,text,integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.quote_advertising_order(uuid,integer,text,integer,text,text,text,text) to authenticated;
create function public.quote_advertising_order(p_order_id uuid,p_amount_iqd integer,p_scope text,p_duration_days integer,p_ad_title text,p_ad_body text,p_target_url text,p_placement text)
returns jsonb language sql security invoker set search_path='' as $$ select private.quote_advertising_order(p_order_id,p_amount_iqd,p_scope,p_duration_days,p_ad_title,p_ad_body,p_target_url,p_placement); $$;
revoke all on function public.quote_advertising_order(uuid,integer,text,integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.quote_advertising_order(uuid,integer,text,integer,text,text,text,text) to authenticated;

create function private.accept_advertising_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.advertising_orders%rowtype;
begin
 if p_quote_version is null or p_quote_version<1 or (p_payment_reference is not null and char_length(p_payment_reference)>120) then raise exception 'Invalid advertising quote acceptance' using errcode='22023'; end if;
 select * into target from public.advertising_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status<>'quoted' or target.quote_version<>p_quote_version or target.quote_iqd is null or target.quote_scope is null or target.accepted_at is not null then raise exception 'Current advertising quoted terms must be accepted' using errcode='55000'; end if;
 update public.advertising_orders set status='awaiting_payment',accepted_at=clock_timestamp(),accepted_quote_version=target.quote_version,payment_reference=nullif(btrim(p_payment_reference),''),updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'status','awaiting_payment','quote_version',target.quote_version);
end;
$$;
revoke all on function private.accept_advertising_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.accept_advertising_quote(uuid,integer,text) to authenticated;
create function public.accept_advertising_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.accept_advertising_quote(p_order_id,p_quote_version,p_payment_reference); $$;
revoke all on function public.accept_advertising_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_advertising_quote(uuid,integer,text) to authenticated;

create function private.review_advertising_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.advertising_orders%rowtype; checked_at timestamptz; new_status text;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approve','reject') or (p_note is not null and char_length(p_note)>1000) then raise exception 'Invalid advertising payment review' using errcode='22023'; end if;
 select * into target from public.advertising_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 checked_at:=clock_timestamp();
 if target.approved_at is not null or target.status not in ('new','quoted','awaiting_payment') then raise exception 'Advertising order has already been reviewed' using errcode='55000'; end if;
 if p_decision='approve' and (target.status<>'awaiting_payment' or target.accepted_at is null or target.accepted_quote_version<>target.quote_version or target.quote_iqd is null or target.quote_scope is null) then raise exception 'An accepted current quote and manual receipt are required' using errcode='42501'; end if;
 new_status:=case when p_decision='approve' then 'approved' else 'rejected' end;
 update public.advertising_orders set status=new_status,admin_note=nullif(btrim(p_note),''),approved_at=case when p_decision='approve' then checked_at else null end,approved_by=case when p_decision='approve' then actor else null end,updated_at=checked_at where id=target.id;
 return jsonb_build_object('id',target.id,'status',new_status,'approved_at',case when p_decision='approve' then checked_at else null end);
end;
$$;
revoke all on function private.review_advertising_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.review_advertising_payment(uuid,text,text) to authenticated;
create function public.review_advertising_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.review_advertising_payment(p_order_id,p_decision,p_note); $$;
revoke all on function public.review_advertising_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_advertising_payment(uuid,text,text) to authenticated;

create function private.publish_advertising_order(p_order_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.advertising_orders%rowtype; checked_at timestamptz; new_status text;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('publish','pause','resume','close') then raise exception 'Invalid advertising publication action' using errcode='22023'; end if;
 select * into target from public.advertising_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 checked_at:=clock_timestamp();
 if target.approved_at is null or target.approved_by is null or target.accepted_at is null or target.accepted_quote_version<>target.quote_version or target.quote_iqd is null then raise exception 'Accepted manually paid advertising required' using errcode='42501'; end if;
 if p_action in ('publish','resume') then
  -- A paused campaign keeps its paid reservation until its original end.
  -- Serialize admission so a fourth paid campaign cannot run invisibly behind
  -- the three-card public limit. Capacity denial never starts the new clock.
  perform pg_catalog.pg_advisory_xact_lock(72106,pg_catalog.hashtext(target.placement));
  checked_at:=clock_timestamp();
  if (select count(*) from public.advertising_orders where placement=target.placement and id<>target.id and status in ('active','paused') and ends_at>checked_at)>=3 then raise exception 'Advertising placement is full; wait before publication' using errcode='55000'; end if;
 end if;
 if p_action='publish' then
  if target.status<>'approved' or target.starts_at is not null or target.ends_at is not null then raise exception 'Advertising cannot be published again' using errcode='55000'; end if;
  update public.advertising_orders set status='active',starts_at=checked_at,ends_at=checked_at+make_interval(secs=>duration_days*86400),published_by=actor,updated_at=checked_at where id=target.id returning * into target;
 else
  if p_action='pause' then
   if target.status<>'active' or target.ends_at<=checked_at then raise exception 'Only unexpired active advertisements may pause' using errcode='55000'; end if;new_status:='paused';
  elsif p_action='resume' then
   if target.status<>'paused' or target.ends_at<=checked_at then raise exception 'Only unexpired paused advertisements may resume' using errcode='55000'; end if;new_status:='active';
  else
   if target.status not in ('approved','active','paused') then raise exception 'Advertising cannot be closed again' using errcode='55000'; end if;new_status:='closed';
  end if;
  update public.advertising_orders set status=new_status,updated_at=checked_at where id=target.id returning * into target;
 end if;
 return jsonb_build_object('id',target.id,'status',target.status,'starts_at',target.starts_at,'ends_at',target.ends_at);
end;
$$;
revoke all on function private.publish_advertising_order(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.publish_advertising_order(uuid,text) to authenticated;
create function public.publish_advertising_order(p_order_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$ select private.publish_advertising_order(p_order_id,p_action); $$;
revoke all on function public.publish_advertising_order(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_advertising_order(uuid,text) to authenticated;

create function private.cancel_advertising_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.advertising_orders%rowtype;
begin
 select * into target from public.advertising_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status not in ('new','quoted','awaiting_payment') or target.approved_at is not null then raise exception 'Only unpaid open advertising orders may be cancelled' using errcode='55000'; end if;
 update public.advertising_orders set status='cancelled',updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'status','cancelled');
end;
$$;
revoke all on function private.cancel_advertising_order(uuid) from public,anon,authenticated,service_role;
grant execute on function private.cancel_advertising_order(uuid) to authenticated;
create function public.cancel_advertising_order(p_order_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.cancel_advertising_order(p_order_id); $$;
revoke all on function public.cancel_advertising_order(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_advertising_order(uuid) to authenticated;

-- Intentional narrow public reader: the table and advertiser contacts remain
-- private. A website visitor may read only three currently public paid cards.
create function private.list_public_advertisements(p_placement text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare checked_at timestamptz:=clock_timestamp(); result jsonb;
begin
 if p_placement is null or p_placement not in ('home','services') then raise exception 'Invalid public advertisement placement' using errcode='22023'; end if;
 select coalesce(jsonb_agg(card order by starts_at desc,id),'[]'::jsonb) into result from (
  select o.id,o.starts_at,jsonb_build_object('id',o.id,'company_name',o.company_name,'ad_title',o.ad_title,'ad_body',o.ad_body,'target_url',o.target_url,'placement',o.placement,'starts_at',o.starts_at,'ends_at',o.ends_at) as card
  from public.advertising_orders o
  where o.placement=p_placement and o.status='active' and o.approved_at is not null and o.approved_by is not null and o.accepted_at is not null and o.accepted_quote_version=o.quote_version and o.starts_at<=checked_at and o.ends_at>checked_at
  order by o.starts_at desc,o.id limit 3
 ) active_cards;
 return result;
end;
$$;
revoke all on function private.list_public_advertisements(text) from public,anon,authenticated,service_role;
grant execute on function private.list_public_advertisements(text) to anon,authenticated;
create function public.list_public_advertisements(p_placement text)
returns jsonb language sql security invoker set search_path='' as $$ select private.list_public_advertisements(p_placement); $$;
revoke all on function public.list_public_advertisements(text) from public,anon,authenticated,service_role;
grant execute on function public.list_public_advertisements(text) to anon,authenticated;

notify pgrst,'reload schema';
