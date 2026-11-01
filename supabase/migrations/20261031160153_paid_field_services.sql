-- Additive paid field-service requests and owner-scoped on-demand periodic reports.
-- Existing research orders, profiles, fields, users and billing settings are unchanged.
create table public.field_service_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  field_id uuid references public.fields(id) on delete set null,
  service_type text not null check (service_type in ('field_report','field_monitoring')),
  request_note text check (request_note is null or char_length(request_note) <= 2000),
  cadence_days smallint,
  report_count smallint not null,
  status text not null default 'waiting_quote' check (status in ('waiting_quote','quoted','awaiting_payment','approved','running','completed','failed','rejected')),
  quote_iqd integer check (quote_iqd between 1 and 1000000000),
  quote_scope text check (quote_scope is null or char_length(btrim(quote_scope)) between 1 and 2000),
  quote_version integer not null default 0 check (quote_version >= 0),
  quoted_by uuid references auth.users(id),
  quoted_at timestamptz,
  accepted_quote_version integer,
  accepted_at timestamptz,
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  completed_reports smallint not null default 0 check (completed_reports >= 0 and completed_reports <= report_count),
  period_attempts smallint not null default 0 check (period_attempts between 0 and 3),
  run_token uuid,
  started_at timestamptz,
  next_due_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint field_service_plan_shape check ((service_type='field_report' and cadence_days is null and report_count=1) or (service_type='field_monitoring' and cadence_days is not null and cadence_days in (7,14,30) and report_count between 2 and 12)),
  constraint field_service_quote_shape check ((quote_version=0 and quote_iqd is null and quote_scope is null and quoted_by is null and quoted_at is null) or (quote_version>0 and quote_iqd is not null and quote_scope is not null and quoted_by is not null and quoted_at is not null)),
  constraint field_service_acceptance_shape check ((accepted_at is null and accepted_quote_version is null) or (accepted_at is not null and accepted_quote_version is not null and accepted_quote_version=quote_version and quote_iqd is not null)),
  constraint field_service_approval_shape check ((approved_at is null and approved_by is null and next_due_at is null and status in ('waiting_quote','quoted','awaiting_payment','rejected')) or (approved_at is not null and approved_by is not null and accepted_at is not null and next_due_at is not null and status in ('approved','running','completed','failed'))),
  constraint field_service_running_shape check ((status='running' and run_token is not null and started_at is not null) or (status<>'running' and run_token is null)),
  constraint field_service_complete_shape check ((status='completed' and completed_reports=report_count) or (status<>'completed' and completed_reports<report_count))
);
create index field_service_orders_owner_created_idx on public.field_service_orders(owner_id,created_at desc,id);
create index field_service_orders_field_idx on public.field_service_orders(field_id);
create index field_service_orders_quoted_by_idx on public.field_service_orders(quoted_by) where quoted_by is not null;
create index field_service_orders_approved_by_idx on public.field_service_orders(approved_by) where approved_by is not null;
create index field_service_orders_pending_idx on public.field_service_orders(created_at,id) where status in ('waiting_quote','quoted','awaiting_payment');
alter table public.field_service_orders enable row level security;
revoke all on public.field_service_orders from public,anon,authenticated,service_role;
grant select(id,owner_id,field_id,service_type,request_note,cadence_days,report_count,status,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,admin_note,approved_at,created_at,updated_at,completed_reports,period_attempts,started_at,next_due_at) on public.field_service_orders to authenticated;
create policy "Owners and MFA administrators read field service orders" on public.field_service_orders for select to authenticated using (owner_id=(select auth.uid()) or (select private.can_read_signup_notifications()));
comment on column public.field_service_orders.quote_iqd is 'Manual quote accepted by the owner before an MFA allowlisted administrator confirms receipt. No automatic collection.';
comment on column public.field_service_orders.run_token is 'Private owner run capability; excluded from all client table reads.';
comment on column public.field_service_orders.next_due_at is 'Earliest next on-demand report time. This is not a background scheduler or notification.';

create table public.field_service_reports (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.field_service_orders(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 report_number smallint not null check (report_number between 1 and 12),
 due_at timestamptz not null,
 status text not null check (status in ('completed','needs_review','failed')),
 created_at timestamptz not null default statement_timestamp(),
 result jsonb not null check (jsonb_typeof(result)='object' and octet_length(result::text)<=131072),
 unique(order_id,report_number)
);
create index field_service_reports_owner_created_idx on public.field_service_reports(owner_id,created_at desc,id);
alter table public.field_service_reports enable row level security;
revoke all on public.field_service_reports from public,anon,authenticated,service_role;
grant select(id,order_id,owner_id,report_number,due_at,status,created_at,result) on public.field_service_reports to authenticated;
create policy "Owners and MFA administrators read field service reports" on public.field_service_reports for select to authenticated using (owner_id=(select auth.uid()) or (select private.can_read_signup_notifications()));
comment on column public.field_service_reports.result is 'Bounded owner-submitted report. Not an attestation of provider authenticity, independent review or payment. No raw upload files.';

create table private.field_service_runs (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.field_service_orders(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 report_number smallint not null check (report_number between 1 and 12),
 attempt_number smallint not null check (attempt_number between 1 and 3),
 run_token uuid not null unique,
 created_at timestamptz not null default statement_timestamp(),
 unique(order_id,report_number,attempt_number)
);
create index field_service_runs_owner_created_idx on private.field_service_runs(owner_id,created_at);
create index field_service_runs_created_idx on private.field_service_runs(created_at);
alter table private.field_service_runs enable row level security;
revoke all on private.field_service_runs from public,anon,authenticated,service_role;

create function private.field_service_actor()
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists(select 1 from auth.users u where u.id=actor and not coalesce(u.is_anonymous,false) and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then
  raise exception 'A confirmed nonanonymous account is required' using errcode='42501';
 end if;
 return actor;
end;
$$;
revoke all on function private.field_service_actor() from public,anon,authenticated,service_role;
grant execute on function private.field_service_actor() to authenticated;

create function private.create_field_service_order(p_field_id uuid,p_service_type text,p_request_note text default null,p_cadence_days integer default null,p_report_count integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); new_id uuid;
begin
 if p_report_count is null or p_service_type is null or p_service_type not in ('field_report','field_monitoring') or (p_request_note is not null and char_length(p_request_note)>2000) or not ((p_service_type='field_report' and p_cadence_days is null and p_report_count=1) or (p_service_type='field_monitoring' and p_cadence_days is not null and p_cadence_days in (7,14,30) and p_report_count between 2 and 12)) then
  raise exception 'Invalid field service plan' using errcode='22023';
 end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=p_field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this account' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72101,pg_catalog.hashtext(actor::text));
 if (select count(*) from public.field_service_orders where owner_id=actor and status in ('waiting_quote','quoted','awaiting_payment'))>=10 then raise exception 'Pending order limit reached' using errcode='55000'; end if;
 insert into public.field_service_orders(owner_id,field_id,service_type,request_note,cadence_days,report_count) values(actor,p_field_id,p_service_type,nullif(btrim(p_request_note),''),p_cadence_days,p_report_count) returning id into new_id;
 return jsonb_build_object('id',new_id,'status','waiting_quote','service_type',p_service_type);
end;
$$;
revoke all on function private.create_field_service_order(uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.create_field_service_order(uuid,text,text,integer,integer) to authenticated;
create function public.create_field_service_order(p_field_id uuid,p_service_type text,p_request_note text default null,p_cadence_days integer default null,p_report_count integer default 1)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_field_service_order(p_field_id,p_service_type,p_request_note,p_cadence_days,p_report_count); $$;
revoke all on function public.create_field_service_order(uuid,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.create_field_service_order(uuid,text,text,integer,integer) to authenticated;

create function private.quote_field_service_order(p_order_id uuid,p_amount_iqd integer,p_scope text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.field_service_orders%rowtype;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_amount_iqd is null or p_amount_iqd<1 or p_amount_iqd>1000000000 or p_scope is null or char_length(btrim(p_scope)) not between 1 and 2000 then raise exception 'Invalid quote' using errcode='22023'; end if;
 select * into target from public.field_service_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status not in ('waiting_quote','quoted') or target.accepted_at is not null or target.approved_at is not null then raise exception 'Accepted or reviewed quotes cannot change' using errcode='55000'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=target.owner_id) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 update public.field_service_orders set status='quoted',quote_iqd=p_amount_iqd,quote_scope=btrim(p_scope),quote_version=quote_version+1,quoted_by=actor,quoted_at=statement_timestamp(),updated_at=statement_timestamp() where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'status',target.status,'quote_iqd',target.quote_iqd,'quote_scope',target.quote_scope,'quote_version',target.quote_version);
end;
$$;
revoke all on function private.quote_field_service_order(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.quote_field_service_order(uuid,integer,text) to authenticated;
create function public.quote_field_service_order(p_order_id uuid,p_amount_iqd integer,p_scope text)
returns jsonb language sql security invoker set search_path='' as $$ select private.quote_field_service_order(p_order_id,p_amount_iqd,p_scope); $$;
revoke all on function public.quote_field_service_order(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.quote_field_service_order(uuid,integer,text) to authenticated;

create function private.accept_field_service_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.field_service_orders%rowtype;
begin
 if p_quote_version is null or p_quote_version<1 or (p_payment_reference is not null and char_length(p_payment_reference)>120) then raise exception 'Invalid quote acceptance' using errcode='22023'; end if;
 select * into target from public.field_service_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status<>'quoted' or target.quote_version<>p_quote_version or target.quote_iqd is null or target.quote_scope is null or target.accepted_at is not null then raise exception 'Current quoted terms must be accepted' using errcode='55000'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 update public.field_service_orders set status='awaiting_payment',accepted_at=statement_timestamp(),accepted_quote_version=target.quote_version,payment_reference=nullif(btrim(p_payment_reference),''),updated_at=statement_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'status','awaiting_payment','quote_version',target.quote_version);
end;
$$;
revoke all on function private.accept_field_service_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.accept_field_service_quote(uuid,integer,text) to authenticated;
create function public.accept_field_service_quote(p_order_id uuid,p_quote_version integer,p_payment_reference text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.accept_field_service_quote(p_order_id,p_quote_version,p_payment_reference); $$;
revoke all on function public.accept_field_service_quote(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_field_service_quote(uuid,integer,text) to authenticated;

create function private.review_field_service_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.field_service_orders%rowtype; reviewed timestamptz; new_status text;
begin
 if not coalesce(private.can_read_signup_notifications(),false) then raise exception 'MFA platform administrator required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approve','reject') or (p_note is not null and char_length(p_note)>1000) then raise exception 'Invalid payment review' using errcode='22023'; end if;
 select * into target from public.field_service_orders where id=p_order_id for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 reviewed:=clock_timestamp();
 if target.approved_at is not null or target.status not in ('waiting_quote','quoted','awaiting_payment') then raise exception 'Order has already been reviewed' using errcode='55000'; end if;
 if p_decision='approve' then
  if target.status<>'awaiting_payment' or target.accepted_at is null or target.accepted_quote_version<>target.quote_version or target.quote_iqd is null or target.quote_scope is null then raise exception 'An accepted current quote and manual receipt are required' using errcode='42501'; end if;
  if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=target.owner_id) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 end if;
 new_status:=case when p_decision='approve' then 'approved' else 'rejected' end;
 update public.field_service_orders set status=new_status,admin_note=nullif(btrim(p_note),''),approved_at=case when p_decision='approve' then reviewed else null end,approved_by=case when p_decision='approve' then actor else null end,next_due_at=case when p_decision='approve' then reviewed else null end,updated_at=reviewed where id=target.id;
 return jsonb_build_object('id',target.id,'status',new_status,'quote_iqd',target.quote_iqd,'approved_at',case when p_decision='approve' then reviewed else null end);
end;
$$;
revoke all on function private.review_field_service_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.review_field_service_payment(uuid,text,text) to authenticated;
create function public.review_field_service_payment(p_order_id uuid,p_decision text,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.review_field_service_payment(p_order_id,p_decision,p_note); $$;
revoke all on function public.review_field_service_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_field_service_payment(uuid,text,text) to authenticated;

create function private.claim_field_service_report(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.field_service_orders%rowtype; claim_time timestamptz; day_start timestamptz; capability uuid; ordinal integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(72102,1);
 select * into target from public.field_service_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 claim_time:=clock_timestamp();
 if target.approved_at is null or target.approved_by is null or target.accepted_at is null or target.accepted_quote_version<>target.quote_version or target.quote_iqd is null then raise exception 'Manual payment confirmation required' using errcode='42501'; end if;
 if target.status not in ('approved','failed','running') or target.completed_reports>=target.report_count then raise exception 'Order is not claimable' using errcode='55000'; end if;
 if target.status='running' and target.started_at>claim_time-interval '180 seconds' then raise exception 'Report already has an active run' using errcode='55000'; end if;
 if target.period_attempts>=3 then raise exception 'Report attempt limit reached' using errcode='55000'; end if;
 if target.next_due_at is null or target.next_due_at>claim_time then raise exception 'The next report is not due yet' using errcode='55000'; end if;
 if not exists(select 1 from public.fields fld join public.farms farm on farm.id=fld.farm_id where fld.id=target.field_id and farm.owner_id=actor) then raise exception 'Field unavailable for this owner' using errcode='42501'; end if;
 day_start:=date_trunc('day',claim_time at time zone 'UTC') at time zone 'UTC';
 if (select count(*) from private.field_service_runs where owner_id=actor and created_at>=day_start)>=5 or (select count(*) from private.field_service_runs where created_at>=day_start)>=30 then raise exception 'Field report daily quota reached' using errcode='54000'; end if;
 capability:=gen_random_uuid();ordinal:=target.completed_reports+1;
 insert into private.field_service_runs(order_id,owner_id,report_number,attempt_number,run_token,created_at) values(target.id,actor,ordinal,target.period_attempts+1,capability,claim_time);
 update public.field_service_orders set status='running',period_attempts=target.period_attempts+1,run_token=capability,started_at=claim_time,updated_at=claim_time where id=target.id;
 return jsonb_build_object('id',target.id,'order_id',target.id,'run_token',capability,'field_id',target.field_id,'service_type',target.service_type,'report_number',ordinal,'due_at',target.next_due_at,'report_count',target.report_count,'cadence_days',target.cadence_days,'attempt_number',target.period_attempts+1);
end;
$$;
revoke all on function private.claim_field_service_report(uuid) from public,anon,authenticated,service_role;
grant execute on function private.claim_field_service_report(uuid) to authenticated;
create function public.claim_field_service_report(p_order_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.claim_field_service_report(p_order_id); $$;
revoke all on function public.claim_field_service_report(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_field_service_report(uuid) to authenticated;

create function private.finish_field_service_report(p_order_id uuid,p_run_token uuid,p_status text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=private.field_service_actor(); target public.field_service_orders%rowtype; ordinal integer; total_completed integer; new_status text; saved_report_id uuid; finished_at timestamptz;
 result_keys text[]:=array['schema_version','created_at','service_type','report_number','due_at','field','satellite','weather','irrigation_logs','comparison','summary','recommendations','limitations','notes','sources'];
begin
 select * into target from public.field_service_orders where id=p_order_id and owner_id=actor for update;
 if not found then raise exception 'Order unavailable' using errcode='42501'; end if;
 if target.status<>'running' or p_run_token is null or target.run_token is distinct from p_run_token or target.approved_at is null or target.approved_by is null then raise exception 'Matching paid active run required' using errcode='42501'; end if;
 ordinal:=target.completed_reports+1;
 if p_status is null or p_status not in ('completed','needs_review','failed') or p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>131072 then raise exception 'Invalid report envelope' using errcode='22023'; end if;
 if not (p_result ?& result_keys) or p_result-result_keys<>'{}'::jsonb or p_result->'schema_version'<>'1'::jsonb or p_result->>'service_type' is distinct from target.service_type or p_result->'report_number'<>to_jsonb(ordinal)
  or jsonb_typeof(p_result->'created_at')<>'string' or jsonb_typeof(p_result->'due_at')<>'string'
  or jsonb_typeof(p_result->'field')<>'object' or jsonb_typeof(p_result->'satellite') not in ('object','null') or jsonb_typeof(p_result->'weather') not in ('object','null') or jsonb_typeof(p_result->'comparison') not in ('object','null')
  or jsonb_typeof(p_result->'irrigation_logs')<>'array' or jsonb_typeof(p_result->'summary')<>'string' or jsonb_typeof(p_result->'recommendations')<>'array' or jsonb_typeof(p_result->'limitations')<>'array' or jsonb_typeof(p_result->'notes')<>'array' or jsonb_typeof(p_result->'sources')<>'object' then
  raise exception 'Invalid report envelope fields' using errcode='22023';
 end if;
 insert into public.field_service_reports(order_id,owner_id,report_number,due_at,status,result) values(target.id,actor,ordinal,target.next_due_at,p_status,p_result)
 on conflict(order_id,report_number) do update set status=excluded.status,result=excluded.result,created_at=statement_timestamp() returning id into saved_report_id;
 finished_at:=clock_timestamp();
 total_completed:=target.completed_reports+case when p_status='failed' then 0 else 1 end;
 new_status:=case when p_status='failed' then 'failed' when total_completed>=target.report_count then 'completed' else 'approved' end;
 update public.field_service_orders set status=new_status,completed_reports=total_completed,period_attempts=case when p_status='failed' then target.period_attempts else 0 end,run_token=null,next_due_at=case when new_status in ('completed','failed') then target.next_due_at else finished_at+make_interval(days=>target.cadence_days) end,updated_at=finished_at where id=target.id returning * into target;
 return jsonb_build_object('id',target.id,'order_id',target.id,'report_id',saved_report_id,'report_number',ordinal,'report_status',p_status,'result_status',p_status,'status',new_status,'order_status',new_status,'completed_reports',total_completed,'report_count',target.report_count,'next_due_at',target.next_due_at);
end;
$$;
revoke all on function private.finish_field_service_report(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finish_field_service_report(uuid,uuid,text,jsonb) to authenticated;
create function public.finish_field_service_report(p_order_id uuid,p_run_token uuid,p_status text,p_result jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.finish_field_service_report(p_order_id,p_run_token,p_status,p_result); $$;
revoke all on function public.finish_field_service_report(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_field_service_report(uuid,uuid,text,jsonb) to authenticated;

notify pgrst,'reload schema';
