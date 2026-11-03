-- Additive product enquiries and Wasit-only drip-irrigation installation requests.
-- Offers are proposals, not payment receipts, stock reservations or fulfilment promises.
create table public.product_inquiries (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 item_code text not null check (item_code in ('drip_supplies','drip_installation','weather_station','pest_station')),
 quantity integer not null default 1 check (quantity between 1 and 10000),
 province text not null check (province in ('baghdad','basra','nineveh','erbil','najaf','karbala','kirkuk','anbar','diyala','salah_al_din','dhi_qar','maysan','wasit','babil','qadisiyyah','muthanna','sulaymaniyah','duhok')),
 district text check (district is null or char_length(district)<=120),
 area_donum numeric check (area_donum is null or (area_donum>0 and area_donum<=1000000)),
 contact_phone text check (contact_phone is null or char_length(contact_phone)<=32),
 customer_note text check (customer_note is null or char_length(customer_note)<=1500),
 status text not null default 'new' check (status in ('new','reviewing','quoted','closed','cancelled')),
 quote_iqd integer check (quote_iqd between 1 and 1000000000),
 admin_reply text check (admin_reply is null or char_length(admin_reply)<=2000),
 reviewed_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 constraint product_installation_wasit check (item_code<>'drip_installation' or (province='wasit' and quantity=1)),
 constraint product_quote_shape check (status<>'quoted' or (quote_iqd is not null and admin_reply is not null and char_length(btrim(admin_reply))>0))
);
create index product_inquiries_owner_created_idx on public.product_inquiries(owner_id,created_at desc,id);
create index product_inquiries_open_created_idx on public.product_inquiries(created_at,id) where status in ('new','reviewing','quoted');
create index product_inquiries_reviewed_by_idx on public.product_inquiries(reviewed_by) where reviewed_by is not null;
alter table public.product_inquiries enable row level security;
revoke all on public.product_inquiries from public,anon,authenticated,service_role;
grant select(id,owner_id,item_code,quantity,province,district,area_donum,contact_phone,customer_note,status,quote_iqd,admin_reply,created_at,updated_at) on public.product_inquiries to authenticated;
create policy "Owners and MFA administrators read product enquiries" on public.product_inquiries for select to authenticated using (owner_id=(select auth.uid()) or (select private.can_read_signup_notifications()));
comment on table public.product_inquiries is 'Customer requests and administrator proposals only. Product model, availability, shipping and execution are confirmed separately; no automatic payment or fulfilment.';
comment on column public.product_inquiries.province is 'Installation requests are restricted to Wasit; product supply locations are requests, not guarantees of shipping availability.';
comment on column public.product_inquiries.contact_phone is 'Optional customer contact shared only with the owner and allowlisted MFA administrators.';

create function private.create_product_inquiry(p_item_code text,p_quantity integer default 1,p_province text default null,p_district text default null,p_area_donum numeric default null,p_contact_phone text default null,p_customer_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); new_id uuid; checked_at timestamptz; day_start timestamptz;
begin
 if p_item_code is null or p_item_code not in ('drip_supplies','drip_installation','weather_station','pest_station') or p_quantity is null or p_quantity not between 1 and 10000 or p_province is null or p_province not in ('baghdad','basra','nineveh','erbil','najaf','karbala','kirkuk','anbar','diyala','salah_al_din','dhi_qar','maysan','wasit','babil','qadisiyyah','muthanna','sulaymaniyah','duhok')
  or (p_district is not null and char_length(p_district)>120) or (p_area_donum is not null and not (p_area_donum>0 and p_area_donum<=1000000)) or (p_contact_phone is not null and char_length(p_contact_phone)>32) or (p_customer_note is not null and char_length(p_customer_note)>1500)
  or (p_item_code='drip_installation' and (p_province<>'wasit' or p_quantity<>1)) then
  raise exception 'Invalid product enquiry or installation outside Wasit' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(72104,pg_catalog.hashtext(actor::text));
 checked_at:=clock_timestamp(); day_start:=date_trunc('day',checked_at at time zone 'UTC') at time zone 'UTC';
 if (select count(*) from public.product_inquiries where owner_id=actor and status in ('new','reviewing','quoted'))>=10 then raise exception 'Pending product enquiry limit reached' using errcode='55000'; end if;
 if (select count(*) from public.product_inquiries where owner_id=actor and created_at>=day_start)>=5 then raise exception 'Daily product enquiry limit reached' using errcode='54000'; end if;
 insert into public.product_inquiries(owner_id,item_code,quantity,province,district,area_donum,contact_phone,customer_note,created_at,updated_at)
 values(actor,p_item_code,p_quantity,p_province,nullif(btrim(p_district),''),p_area_donum,nullif(btrim(p_contact_phone),''),nullif(btrim(p_customer_note),''),checked_at,checked_at) returning id into new_id;
 return jsonb_build_object('id',new_id,'status','new');
end;
$$;
revoke all on function private.create_product_inquiry(text,integer,text,text,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function private.create_product_inquiry(text,integer,text,text,numeric,text,text) to authenticated;
create function public.create_product_inquiry(p_item_code text,p_quantity integer default 1,p_province text default null,p_district text default null,p_area_donum numeric default null,p_contact_phone text default null,p_customer_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_product_inquiry(p_item_code,p_quantity,p_province,p_district,p_area_donum,p_contact_phone,p_customer_note); $$;
revoke all on function public.create_product_inquiry(text,integer,text,text,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_product_inquiry(text,integer,text,text,numeric,text,text) to authenticated;

create function private.review_product_inquiry(p_inquiry_id uuid,p_status text,p_admin_reply text default null,p_quote_iqd integer default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.product_inquiries%rowtype; reply_text text:=nullif(btrim(p_admin_reply),'');
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('reviewing','quoted','closed') or (p_admin_reply is not null and char_length(p_admin_reply)>2000) or (p_quote_iqd is not null and p_quote_iqd not between 1 and 1000000000) or (p_status='quoted' and (p_quote_iqd is null or reply_text is null)) then raise exception 'Invalid product enquiry review' using errcode='22023'; end if;
 select * into target from public.product_inquiries where id=p_inquiry_id for update;
 if not found then raise exception 'Enquiry unavailable' using errcode='42501'; end if;
 if target.status not in ('new','reviewing','quoted') then raise exception 'Enquiry is already closed or cancelled' using errcode='55000'; end if;
 update public.product_inquiries set status=p_status,admin_reply=reply_text,quote_iqd=p_quote_iqd,reviewed_by=actor,updated_at=clock_timestamp() where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'status',target.status,'quote_iqd',target.quote_iqd,'admin_reply',target.admin_reply);
end;
$$;
revoke all on function private.review_product_inquiry(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.review_product_inquiry(uuid,text,text,integer) to authenticated;
create function public.review_product_inquiry(p_inquiry_id uuid,p_status text,p_admin_reply text default null,p_quote_iqd integer default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.review_product_inquiry(p_inquiry_id,p_status,p_admin_reply,p_quote_iqd); $$;
revoke all on function public.review_product_inquiry(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.review_product_inquiry(uuid,text,text,integer) to authenticated;

create function private.cancel_product_inquiry(p_inquiry_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.product_inquiries%rowtype;
begin
 select * into target from public.product_inquiries where id=p_inquiry_id and owner_id=actor for update;
 if not found then raise exception 'Enquiry unavailable' using errcode='42501'; end if;
 if target.status not in ('new','reviewing') then raise exception 'Only an unquoted open enquiry can be cancelled' using errcode='55000'; end if;
 update public.product_inquiries set status='cancelled',updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'status','cancelled');
end;
$$;
revoke all on function private.cancel_product_inquiry(uuid) from public,anon,authenticated,service_role;
grant execute on function private.cancel_product_inquiry(uuid) to authenticated;
create function public.cancel_product_inquiry(p_inquiry_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.cancel_product_inquiry(p_inquiry_id); $$;
revoke all on function public.cancel_product_inquiry(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_product_inquiry(uuid) to authenticated;

notify pgrst,'reload schema';
