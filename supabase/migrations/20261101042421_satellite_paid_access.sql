-- Additive, field-specific timed access to new satellite analysis and imagery.
-- Existing accounts, historic observations, research orders and paid reports stay intact.
create table public.satellite_access_orders (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 field_id uuid references public.fields(id) on delete set null,
 request_note text check (request_note is null or char_length(request_note)<=2000),
 status text not null default 'waiting_quote' check (status in ('waiting_quote','quoted','awaiting_payment','approved','rejected')),
 duration_days integer not null default 30 check (duration_days between 1 and 365),
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
 expires_at timestamptz,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 constraint satellite_access_quote_shape check ((quote_version=0 and quote_iqd is null and quote_scope is null and quoted_by is null and quoted_at is null) or (quote_version>0 and quote_iqd is not null and quote_scope is not null and quoted_by is not null and quoted_at is not null)),
 constraint satellite_access_acceptance_shape check ((accepted_at is null and accepted_quote_version is null) or (accepted_at is not null and accepted_quote_version is not null and accepted_quote_version=quote_version and quote_iqd is not null)),
 constraint satellite_access_approval_shape check ((approved_at is null and approved_by is null and expires_at is null and status in ('waiting_quote','quoted','awaiting_payment','rejected')) or (approved_at is not null and approved_by is not null and accepted_at is not null and status='approved' and expires_at=approved_at+make_interval(secs=>duration_days*86400))),
 constraint satellite_access_quoted_state check (status not in ('quoted','awaiting_payment','approved') or quote_version>0),
 constraint satellite_access_accepted_state check (status not in ('awaiting_payment','approved') or accepted_at is not null)
);
create index satellite_access_orders_owner_created_idx on public.satellite_access_orders(owner_id,created_at desc,id);
create index satellite_access_orders_field_idx on public.satellite_access_orders(field_id);
create index satellite_access_orders_active_idx on public.satellite_access_orders(owner_id,field_id,expires_at desc) where status='approved';
create index satellite_access_orders_pending_idx on public.satellite_access_orders(created_at,id) where status in ('waiting_quote','quoted','awaiting_payment');
create index satellite_access_orders_quoted_by_idx on public.satellite_access_orders(quoted_by) where quoted_by is not null;
create index satellite_access_orders_approved_by_idx on public.satellite_access_orders(approved_by) where approved_by is not null;
alter table public.satellite_access_orders enable row level security;
revoke all on public.satellite_access_orders from public,anon,authenticated,service_role;
grant select(id,owner_id,field_id,request_note,status,duration_days,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,admin_note,approved_at,expires_at,created_at,updated_at) on public.satellite_access_orders to authenticated;
create policy "Owners and MFA administrators read satellite access orders" on public.satellite_access_orders for select to authenticated using (owner_id=(select auth.uid()) or (select private.can_read_signup_notifications()));
comment on table public.satellite_access_orders is 'Manually quoted and accepted field-specific access. No automatic billing, renewal, guaranteed new scene or retroactive removal of owner data.';
comment on column public.satellite_access_orders.duration_days is 'Proposed duration until quoted, then exact customer-accepted duration. Each day is 86400 seconds from actual manual approval.';
comment on column public.satellite_access_orders.expires_at is 'Actual server approval time plus accepted duration. Expiry is evaluated on every satellite access check.';

create function private.create_satellite_access_order(p_field_id uuid,p_duration_days integer default 30,p_request_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); new_id uuid;
begin
 if p_duration_days is null or p_duration_days not between 1 and 365 or (p_request_note is not null and char_length(p_request_note)>2000) then raise exception 'Invalid satellite access request' using errcode='22023'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=p_field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this account' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72103,pg_catalog.hashtext(actor::text));
 if (select count(*) from public.satellite_access_orders where owner_id=actor and status in ('waiting_quote','quoted','awaiting_payment'))>=10 then raise exception 'Pending satellite access limit reached' using errcode='55000'; end if;
 insert into public.satellite_access_orders(owner_id,field_id,duration_days,request_note) values(actor,p_field_id,p_duration_days,nullif(btrim(p_request_note),'')) returning id into new_id;
 return jsonb_build_object('id',new_id,'status','waiting_quote','duration_days',p_duration_days);
end;
$$;
revoke all on function private.create_satellite_access_order(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.create_satellite_access_order(uuid,integer,text) to authenticated;
create function public.create_satellite_access_order(p_field_id uuid,p_duration_days integer default 30,p_request_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_satellite_access_order(p_field_id,p_duration_days,p_request_note); $$;
revoke all on function public.create_satellite_access_order(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.create_satellite_access_order(uuid,integer,text) to authenticated;

create function private.quote_satellite_access_order(p_order_id uuid,p_amount_iqd integer,p_scope text,p_duration_days integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.satellite_access_orders%rowtype;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_amount_iqd is null or p_amount_iqd not between 1 and 1000000000 or p_duration_days is null or p_duration_days not between 1 and 365 or p_scope is null or char_length(btrim(p_scope)) not between 1 and 2000 then raise exception 'Invalid satellite access quote' using errcode='22023'; end if;
 select * into target from public.satellite_access_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status not in ('waiting_quote','quoted') or target.accepted_at is not null or target.approved_at is not null then raise exception 'Accepted or reviewed satellite quote cannot change' using errcode='55000'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=target.owner_id) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 update public.satellite_access_orders set status='quoted',quote_iqd=p_amount_iqd,quote_scope=btrim(p_scope),duration_days=p_duration_days,quote_version=quote_version+1,quoted_by=actor,quoted_at=clock_timestamp(),updated_at=clock_timestamp() where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'status',target.status,'quote_iqd',target.quote_iqd,'quote_scope',target.quote_scope,'quote_version',target.quote_version,'duration_days',target.duration_days);
end;
$$;
revoke all on function private.quote_satellite_access_order(uuid,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.quote_satellite_access_order(uuid,integer,text,integer) to authenticated;
create function public.quote_satellite_access_order(p_order_id uuid,p_amount_iqd integer,p_scope text,p_duration_days integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.quote_satellite_access_order(p_order_id,p_amount_iqd,p_scope,p_duration_days); $$;
revoke all on function public.quote_satellite_access_order(uuid,integer,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.quote_satellite_access_order(uuid,integer,text,integer) to authenticated;

create function private.accept_satellite_access_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.satellite_access_orders%rowtype;
begin
 if p_quote_version is null or p_quote_version<1 or (p_payment_reference is not null and char_length(p_payment_reference)>120) then raise exception 'Invalid satellite quote acceptance' using errcode='22023'; end if;
 select * into target from public.satellite_access_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status<>'quoted' or target.quote_version<>p_quote_version or target.quote_iqd is null or target.quote_scope is null or target.accepted_at is not null then raise exception 'Current satellite quoted terms must be accepted' using errcode='55000'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 update public.satellite_access_orders set status='awaiting_payment',accepted_at=clock_timestamp(),accepted_quote_version=target.quote_version,payment_reference=nullif(btrim(p_payment_reference),'') ,updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'status','awaiting_payment','quote_version',target.quote_version,'duration_days',target.duration_days);
end;
$$;
revoke all on function private.accept_satellite_access_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.accept_satellite_access_quote(uuid,integer,text) to authenticated;
create function public.accept_satellite_access_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.accept_satellite_access_quote(p_order_id,p_quote_version,p_payment_reference); $$;
revoke all on function public.accept_satellite_access_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_satellite_access_quote(uuid,integer,text) to authenticated;

create function private.review_satellite_access_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.satellite_access_orders%rowtype; reviewed timestamptz; new_status text;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approve','reject') or (p_note is not null and char_length(p_note)>1000) then raise exception 'Invalid satellite payment review' using errcode='22023'; end if;
 select * into target from public.satellite_access_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 reviewed:=clock_timestamp();
 if target.status not in ('waiting_quote','quoted','awaiting_payment') or target.approved_at is not null then raise exception 'Satellite access order already reviewed' using errcode='55000'; end if;
 if p_decision='approve' then
  if target.status<>'awaiting_payment' or target.accepted_at is null or target.accepted_quote_version<>target.quote_version or target.quote_iqd is null or target.quote_scope is null then raise exception 'Accepted current quote and manual receipt required' using errcode='42501'; end if;
  if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=target.owner_id) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 end if;
 new_status:=case when p_decision='approve' then 'approved' else 'rejected' end;
 update public.satellite_access_orders set status=new_status,admin_note=nullif(btrim(p_note),''),approved_by=case when p_decision='approve' then actor else null end,approved_at=case when p_decision='approve' then reviewed else null end,expires_at=case when p_decision='approve' then reviewed+make_interval(secs=>target.duration_days*86400) else null end,updated_at=reviewed where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'status',target.status,'quote_iqd',target.quote_iqd,'duration_days',target.duration_days,'approved_at',target.approved_at,'expires_at',target.expires_at);
end;
$$;
revoke all on function private.review_satellite_access_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.review_satellite_access_payment(uuid,text,text) to authenticated;
create function public.review_satellite_access_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.review_satellite_access_payment(p_order_id,p_decision,p_note); $$;
revoke all on function public.review_satellite_access_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_satellite_access_payment(uuid,text,text) to authenticated;

create function private.satellite_access_status(p_field_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.satellite_access_orders%rowtype; checked_at timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=p_field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this account' using errcode='42501'; end if;
 select * into target from public.satellite_access_orders where owner_id=actor and field_id=p_field_id and status='approved' and approved_at<=checked_at and expires_at>checked_at and accepted_at is not null and accepted_quote_version=quote_version order by expires_at desc,id limit 1;
 if not found then return jsonb_build_object('field_id',p_field_id,'active',false,'expires_at',null,'order_id',null); end if;
 return jsonb_build_object('field_id',p_field_id,'active',true,'expires_at',target.expires_at,'order_id',target.id);
end;
$$;
revoke all on function private.satellite_access_status(uuid) from public,anon,authenticated,service_role;
grant execute on function private.satellite_access_status(uuid) to authenticated;
create function public.satellite_access_status(p_field_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.satellite_access_status(p_field_id); $$;
revoke all on function public.satellite_access_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.satellite_access_status(uuid) to authenticated;

notify pgrst,'reload schema';
