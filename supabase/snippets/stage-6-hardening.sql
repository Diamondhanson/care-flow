-- =============================================================================
-- Stage 6 top-up: performance + subscription hardening.
--
--   supabase db execute --file supabase/snippets/stage-6-hardening.sql
--   -- or: psql "$DB" -f supabase/snippets/stage-6-hardening.sql
--
-- NOTE: the RLS policies themselves were also rewritten (InitPlan wrapping —
-- `(select current_hospital_id())` instead of a bare call, so Postgres
-- evaluates the helper once per query instead of potentially per row). Policy
-- text only updates by re-creating the policies: re-run the full
-- supabase/schema.sql (it is idempotent) to pick that up. This snippet applies
-- everything else: JWT-first helpers, the subscription write-gate, and the
-- audit-log retention function.
-- =============================================================================

-- JWT-first helpers: prefer the token claim (set by the optional custom
-- access-token hook), fall back to the staff-row lookup.
create or replace function current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'staff_role', '')::staff_role,
    (select role from public.staff where user_id = auth.uid() limit 1)
  );
$$;

create or replace function current_hospital_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'hospital_id', '')::uuid,
    (select hospital_id from public.staff where user_id = auth.uid() limit 1)
  );
$$;

create or replace function is_hospital_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select subscription_status in ('trial','active')
       from public.hospitals
      where id = (select current_hospital_id())),
    false
  );
$$;

-- Subscription write-gate: a suspended hospital keeps reads, loses writes.
create or replace function enforce_active_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if not is_hospital_active() then
    raise exception 'hospital subscription is suspended — writes are disabled'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','transfers',
    'allergies','care_plan_items','care_plan_entries','billable_items',
    'charges','clinical_terms','follow_up_tasks'
  ]
  loop
    execute format('drop trigger if exists trg_%I_subscription on %I;', t, t);
    execute format(
      'create trigger trg_%I_subscription
         before insert or update or delete on %I
         for each row execute function enforce_active_subscription();', t, t);
  end loop;
end $$;

-- Audit-log retention (schedule monthly with pg_cron on the hosted project):
--   select cron.schedule('prune-audit-log', '0 3 1 * *',
--                        $$select prune_audit_log(24)$$);
create or replace function prune_audit_log(retain_months integer default 24)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted bigint;
begin
  delete from audit_log
   where changed_at < now() - make_interval(months => greatest(retain_months, 1));
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function prune_audit_log(integer) from public, anon, authenticated;
