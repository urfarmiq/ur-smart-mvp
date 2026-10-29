-- Additive, manual payment approval followed by owner-authorized automatic research.
-- Generated with Supabase CLI. This migration grants no new administrator identity.
create table public.research_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) between 1 and 2000),
  task_type text not null check (task_type in ('combined','data','maps','study')),
  fee_iqd integer not null default 25000 check (fee_iqd = 25000),
  status text not null default 'waiting_payment'
    check (status in ('waiting_payment','approved','running','completed','needs_review','failed','rejected')),
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  run_token uuid,
  started_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 262144)),
  result_status text check (result_status in ('completed','needs_review','failed')),
  constraint research_orders_approval_state check (
    (status in ('waiting_payment','rejected') and approved_by is null and approved_at is null)
    or (status in ('approved','running','completed','needs_review','failed') and approved_by is not null and approved_at is not null)
  ),
  constraint research_orders_running_state check (
    (status = 'running' and run_token is not null and started_at is not null)
    or (status <> 'running' and run_token is null)
  )
);
create index research_orders_owner_created_idx on public.research_orders (owner_id, created_at desc, id);
create index research_orders_approved_by_idx on public.research_orders (approved_by) where approved_by is not null;
create index research_orders_pending_idx on public.research_orders (created_at, id) where status = 'waiting_payment';
alter table public.research_orders enable row level security;
revoke all on public.research_orders from public, anon, authenticated, service_role;
-- The run capability and the reviewer's identity are deliberately absent from table reads.
-- Callers must select these named columns: SELECT * includes a prohibited column.
grant select (id, owner_id, topic, task_type, fee_iqd, status, payment_reference,
  admin_note, approved_at, created_at, updated_at, attempt_count, started_at, result, result_status)
on public.research_orders to authenticated;
create policy "Owners and MFA administrators read research orders"
on public.research_orders for select to authenticated
using (owner_id = (select auth.uid()) or (select private.can_read_signup_notifications()));
comment on column public.research_orders.payment_reference is
  'Optional transfer reference only. Never store card numbers, account credentials or payment secrets.';
comment on column public.research_orders.run_token is
  'Private per-attempt capability returned only by the checked owner claim RPC; never table-readable by clients.';
comment on column public.research_orders.result is
  'Bounded owner-submitted report, not proof of payment, provider authenticity or independent verification. Worker normally submits aggregates and research text, never raw input files.';
comment on column public.research_orders.result_status is
  'Execution outcome reported by the owner-authorized caller; carries no financial authorization.';

create table private.research_runs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.research_orders(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_token uuid not null unique,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  created_at timestamptz not null default statement_timestamp(),
  unique (order_id, attempt_number)
);
create index research_runs_owner_created_idx on private.research_runs (owner_id, created_at);
create index research_runs_created_idx on private.research_runs (created_at);
alter table private.research_runs enable row level security;
revoke all on private.research_runs from public, anon, authenticated, service_role;
comment on table private.research_runs is
  'Private append-only attempt audit used for serialized daily quotas. No client policy or table grant.';

-- Auth metadata roles never authorize these operations. A live, confirmed,
-- nonanonymous account is required in addition to a signed-in caller identity.
create function private.research_actor()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'false'
     or not exists (select 1 from auth.users u where u.id = actor
       and not coalesce(u.is_anonymous, false)
       and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then
    raise exception 'A confirmed nonanonymous account is required' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function private.research_actor() from public, anon, authenticated, service_role;
grant execute on function private.research_actor() to authenticated;

create function private.create_research_order(p_topic text, p_task_type text, p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor uuid := private.research_actor(); new_id uuid; clean_topic text := btrim(p_topic);
begin
  if clean_topic is null or char_length(clean_topic) not between 1 and 2000
     or p_task_type is null or p_task_type not in ('combined','data','maps','study')
     or (p_payment_reference is not null and char_length(p_payment_reference) > 120) then
    raise exception 'Invalid research order input' using errcode = '22023';
  end if;
  -- Serialize pending-count checks for this owner, including simultaneous requests.
  perform pg_catalog.pg_advisory_xact_lock(72026, pg_catalog.hashtext(actor::text));
  if (select count(*) from public.research_orders where owner_id = actor and status = 'waiting_payment') >= 10 then
    raise exception 'Pending research order limit reached' using errcode = '55000';
  end if;
  insert into public.research_orders (owner_id, topic, task_type, fee_iqd, payment_reference)
  values (actor, clean_topic, p_task_type, 25000, nullif(btrim(p_payment_reference), '')) returning id into new_id;
  return jsonb_build_object('id', new_id, 'status', 'waiting_payment', 'fee_iqd', 25000);
end;
$$;
revoke all on function private.create_research_order(text,text,text) from public, anon, authenticated, service_role;
grant execute on function private.create_research_order(text,text,text) to authenticated;
create function public.create_research_order(p_topic text, p_task_type text, p_payment_reference text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_research_order(p_topic,p_task_type,p_payment_reference); $$;
revoke all on function public.create_research_order(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.create_research_order(text,text,text) to authenticated;

create function private.review_research_order(p_order_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor uuid := private.research_actor(); target public.research_orders%rowtype; new_status text;
begin
  if not coalesce(private.can_read_signup_notifications(), false) then
    raise exception 'MFA platform administrator approval is required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','reject')
     or (p_note is not null and char_length(p_note) > 1000) then
    raise exception 'Invalid research review input' using errcode = '22023';
  end if;
  select * into target from public.research_orders where id = p_order_id for update;
  if not found then raise exception 'Research order unavailable' using errcode = '42501'; end if;
  if target.status <> 'waiting_payment' then
    raise exception 'Research order has already been reviewed' using errcode = '55000';
  end if;
  new_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  update public.research_orders set
    status = new_status, fee_iqd = 25000, admin_note = nullif(btrim(p_note), ''),
    approved_by = case when p_decision = 'approve' then actor else null end,
    approved_at = case when p_decision = 'approve' then statement_timestamp() else null end,
    updated_at = statement_timestamp()
  where id = target.id;
  return jsonb_build_object('id', target.id, 'status', new_status, 'fee_iqd', 25000);
end;
$$;
revoke all on function private.review_research_order(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function private.review_research_order(uuid,text,text) to authenticated;
create function public.review_research_order(p_order_id uuid, p_decision text, p_note text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.review_research_order(p_order_id,p_decision,p_note); $$;
revoke all on function public.review_research_order(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.review_research_order(uuid,text,text) to authenticated;

create function private.claim_research_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor uuid := private.research_actor(); target public.research_orders%rowtype;
  next_token uuid; next_attempt smallint; day_start timestamptz; claim_time timestamptz;
begin
  -- One lock serializes both global and owner quotas. Lock acquisition always
  -- precedes the order row lock, so claims across owners cannot overrun a cap.
  perform pg_catalog.pg_advisory_xact_lock(72025,25000);
  select * into target from public.research_orders where id = p_order_id and owner_id = actor for update;
  if not found then raise exception 'Research order unavailable' using errcode = '42501'; end if;
  -- Use wall time after waiting for locks, so a delayed claim gets a full lease
  -- and is counted in the UTC day in which it actually starts.
  claim_time := clock_timestamp();
  if target.approved_at is null or target.approved_by is null or target.fee_iqd <> 25000 then
    raise exception 'Manual payment approval is required' using errcode = '42501';
  end if;
  if target.status not in ('approved','failed','needs_review','running') then
    raise exception 'Research order is not claimable' using errcode = '55000';
  end if;
  if target.status = 'running' and target.started_at > claim_time - interval '180 seconds' then
    raise exception 'Research order already has an active run' using errcode = '55000';
  end if;
  if target.attempt_count >= 3 then
    raise exception 'Research order attempt limit reached' using errcode = '55000';
  end if;
  day_start := date_trunc('day', claim_time at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from private.research_runs where owner_id = actor and created_at >= day_start) >= 5 then
    raise exception 'Owner daily research limit reached' using errcode = '54000';
  end if;
  if (select count(*) from private.research_runs where created_at >= day_start) >= 30 then
    raise exception 'Global daily research limit reached' using errcode = '54000';
  end if;
  next_token := gen_random_uuid(); next_attempt := target.attempt_count + 1;
  insert into private.research_runs (order_id,owner_id,run_token,attempt_number,created_at)
  values (target.id,actor,next_token,next_attempt,claim_time);
  update public.research_orders set status = 'running', run_token = next_token,
    attempt_count = next_attempt, started_at = claim_time, updated_at = claim_time,
    result = null, result_status = null where id = target.id;
  return jsonb_build_object('id',target.id,'run_token',next_token,'topic',target.topic,
    'task_type',target.task_type,'attempt_count',next_attempt);
end;
$$;
revoke all on function private.claim_research_order(uuid) from public, anon, authenticated, service_role;
grant execute on function private.claim_research_order(uuid) to authenticated;
create function public.claim_research_order(p_order_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_research_order(p_order_id); $$;
revoke all on function public.claim_research_order(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_research_order(uuid) to authenticated;

create function private.finish_research_order(p_order_id uuid, p_run_token uuid, p_status text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor uuid := private.research_actor(); target public.research_orders%rowtype;
  result_keys text[] := array['schema_version','created_at','task_type','summary','methodology',
    'interpretation','limitations','next_steps','analysis','maps','references','provider','notes'];
begin
  select * into target from public.research_orders where id = p_order_id and owner_id = actor for update;
  if not found then raise exception 'Research order unavailable' using errcode = '42501'; end if;
  if target.status <> 'running' or target.run_token is distinct from p_run_token
     or p_run_token is null or target.approved_at is null or target.approved_by is null then
    raise exception 'A matching approved active run is required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('completed','needs_review','failed')
     or p_result is null or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_result::text) > 262144 then
    raise exception 'Invalid or oversized research result' using errcode = '22023';
  end if;
  -- This envelope prevents attaching arbitrary top-level file payloads. It does
  -- not authenticate report content: owners possess their own run capability.
  if not (p_result ?& result_keys) or p_result - result_keys <> '{}'::jsonb
     or p_result->'schema_version' <> '1'::jsonb
     or p_result->>'task_type' is distinct from target.task_type
     or jsonb_typeof(p_result->'created_at') <> 'string'
     or jsonb_typeof(p_result->'summary') <> 'string'
     or jsonb_typeof(p_result->'methodology') <> 'array'
     or jsonb_typeof(p_result->'interpretation') <> 'array'
     or jsonb_typeof(p_result->'limitations') <> 'array'
     or jsonb_typeof(p_result->'next_steps') <> 'array'
     or jsonb_typeof(p_result->'references') <> 'array'
     or jsonb_typeof(p_result->'notes') <> 'array'
     or jsonb_typeof(p_result->'provider') <> 'object'
     or jsonb_typeof(p_result->'analysis') not in ('object','null')
     or jsonb_typeof(p_result->'maps') not in ('object','null') then
    raise exception 'Invalid research result envelope' using errcode = '22023';
  end if;
  update public.research_orders set status = p_status, result = p_result,
    result_status = p_status, run_token = null, updated_at = statement_timestamp()
  where id = target.id;
  return jsonb_build_object('id',target.id,'status',p_status,'result_status',p_status);
end;
$$;
revoke all on function private.finish_research_order(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.finish_research_order(uuid,uuid,text,jsonb) to authenticated;
create function public.finish_research_order(p_order_id uuid, p_run_token uuid, p_status text, p_result jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.finish_research_order(p_order_id,p_run_token,p_status,p_result); $$;
revoke all on function public.finish_research_order(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finish_research_order(uuid,uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
