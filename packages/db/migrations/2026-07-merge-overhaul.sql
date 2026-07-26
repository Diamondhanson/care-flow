-- ============================================================================
-- Merge M1 — Overhaul stages 2/4/5/6 folded into the mainline schema
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- Tops up an EXISTING hosted database (already at Phase 21 + notifications)
-- with everything the merged schema adds:
--   1. `clinical_terms`  — synced per-hospital learned term library (Stage 2)
--   2. `follow_up_tasks` — real post-discharge worklist (Stage 5)
--   3. Realtime publication for every mirrored domain table (Stage 4,
--      + patient_history / ros_responses from the Phase-21 line)
--   4. RLS hardening (Stage 6): JWT-claim-first helpers, is_hospital_active(),
--      and every policy re-created with its helper calls wrapped in scalar
--      subselects ("InitPlan" wrapping — evaluated once per query, not per row)
--   5. enforce_active_subscription() write-gate on all domain tables
--   6. prune_audit_log() retention helper (EXECUTE revoked from clients)
--
-- This is a verbatim extract of the additions in packages/db/schema.sql (the
-- single source of truth), with the loop-managed triggers/policies written out
-- for the new tables. Re-applying the full schema.sql also works if the hosted
-- project is otherwise up to date.
-- ============================================================================

-- ---- 1. Stage 6 helpers: JWT-claim-first + subscription gate ----------------
-- Prefer the JWT claim (stamped into app_metadata by the optional
-- custom-access-token hook) and fall back to the staff-row lookup, so the
-- functions work with or without the hook. Claims refresh with the token
-- (~1h); is_staff()'s live is_active check still gates deactivated accounts.

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

-- True while the caller's hospital is allowed to WRITE (trial or active).
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

-- ---- 2. Learned clinical terms (Stage 2) ------------------------------------

create table if not exists clinical_terms (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  term_key     text not null,
  category     text not null,
  custom_term  jsonb,
  usage_count  integer not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (hospital_id, term_key)
);

create index if not exists idx_clinical_terms_hospital on clinical_terms(hospital_id);

drop trigger if exists trg_clinical_terms_updated_at on clinical_terms;
create trigger trg_clinical_terms_updated_at before update on clinical_terms
  for each row execute function set_updated_at();

alter table clinical_terms enable row level security;

drop policy if exists "read for staff" on clinical_terms;
create policy "read for staff" on clinical_terms
  for select to authenticated
  using ((select is_staff()) and hospital_id = (select current_hospital_id()));

drop policy if exists "clinical write terms" on clinical_terms;
create policy "clinical write terms" on clinical_terms
  for all to authenticated
  using ((select current_staff_role()) in ('doctor','nurse','pharmacist','lab_tech','admin')
         and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('doctor','nurse','pharmacist','lab_tech','admin')
              and hospital_id = (select current_hospital_id()));

-- ---- 3. Post-discharge follow-up tasks (Stage 5) ----------------------------

create table if not exists follow_up_tasks (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  visit_id        uuid references visits(id) on delete set null,
  kind            text not null check (kind in ('call','tele_checkin','summary_delivery')),
  title           text not null,
  due_at          timestamptz not null,
  status          text not null default 'pending' check (status in ('pending','done','cancelled')),
  completed_at    timestamptz,
  completed_by_id uuid references staff(id) on delete set null,
  notes           text,
  created_by_id   uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_follow_up_hospital   on follow_up_tasks(hospital_id);
create index if not exists idx_follow_up_status_due on follow_up_tasks(status, due_at);
create index if not exists idx_follow_up_patient    on follow_up_tasks(patient_id);

drop trigger if exists trg_follow_up_tasks_updated_at on follow_up_tasks;
create trigger trg_follow_up_tasks_updated_at before update on follow_up_tasks
  for each row execute function set_updated_at();

alter table follow_up_tasks add column if not exists version integer not null default 1;
drop trigger if exists trg_follow_up_tasks_version on follow_up_tasks;
create trigger trg_follow_up_tasks_version before update on follow_up_tasks
  for each row execute function bump_version();

drop trigger if exists trg_follow_up_tasks_audit on follow_up_tasks;
create trigger trg_follow_up_tasks_audit
  after insert or update or delete on follow_up_tasks
  for each row execute function audit_trigger();

alter table follow_up_tasks enable row level security;

drop policy if exists "read for staff" on follow_up_tasks;
create policy "read for staff" on follow_up_tasks
  for select to authenticated
  using ((select is_staff()) and hospital_id = (select current_hospital_id()));

drop policy if exists "clinical write follow ups" on follow_up_tasks;
create policy "clinical write follow ups" on follow_up_tasks
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

-- ---- 4. Realtime publication (Stage 4) --------------------------------------
-- Stream row changes to signed-in clients so colleagues see each other's work
-- live. RLS still applies to delivered events. Idempotent: tables already in
-- the publication are skipped, and stacks without the publication are skipped.
-- (`notifications` already joined the publication in the notifications
-- migration; the existence check below skips it harmlessly.)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'hospitals','departments','wards','beds','staff','patients','visits',
      'consultations','diagnoses','orders','results','prescriptions',
      'medication_administrations','treatment_records','admissions','transfers',
      'allergies','care_plan_items','care_plan_entries','billable_items',
      'charges','clinical_terms','follow_up_tasks',
      'patient_history','ros_responses'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table %I;', t);
      end if;
    end loop;
  end if;
end $$;

-- ---- 5. Subscription write-gate (Stage 6) -----------------------------------
-- A suspended hospital keeps READ access but can no longer WRITE. One trigger
-- on every domain table (incl. notifications); deliberately NOT attached to
-- push_subscriptions / usage_events / platform_admins / audit_log. Service-role
-- contexts (auth.uid() is null) bypass it.

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
    'charges','clinical_terms','follow_up_tasks',
    'patient_history','ros_responses','notifications'
  ]
  loop
    execute format('drop trigger if exists trg_%I_subscription on %I;', t, t);
    execute format(
      'create trigger trg_%I_subscription
         before insert or update or delete on %I
         for each row execute function enforce_active_subscription();', t, t);
  end loop;
end $$;

-- ---- 6. Audit-log retention (Stage 6) ---------------------------------------
-- Schedule monthly with pg_cron on the hosted project:
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

-- ---- 7. Policy re-creation with InitPlan wrapping (Stage 6) -----------------
-- Policy TEXT only updates by re-creating the policy, so every pre-existing
-- policy is dropped and re-created here with its helper calls wrapped in
-- scalar subselects: `(select current_hospital_id())`,
-- `(select current_staff_role())`, `((select is_staff()) and ...)`. Postgres
-- then evaluates each helper once per query (InitPlan) instead of per row.
-- Verbatim from packages/db/schema.sql section 9.

-- 7a. The hospitals (tenant) table itself.
drop policy if exists "staff read own hospital" on hospitals;
create policy "staff read own hospital" on hospitals
  for select to authenticated
  using (id = (select current_hospital_id()));

drop policy if exists "admin update own hospital" on hospitals;
create policy "admin update own hospital" on hospitals
  for update to authenticated
  using (id = (select current_hospital_id()) and (select current_staff_role()) = 'admin')
  with check (id = (select current_hospital_id()) and (select current_staff_role()) = 'admin');

-- 7b. Universal read for active staff.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','transfers',
    'allergies','care_plan_items','care_plan_entries','billable_items','charges',
    'patient_history','ros_responses','clinical_terms','follow_up_tasks'
  ]
  loop
    execute format('drop policy if exists "read for staff" on %I;', t);
    execute format(
      'create policy "read for staff" on %I
         for select to authenticated
         using ((select is_staff()) and hospital_id = (select current_hospital_id()));', t);
  end loop;
end $$;

-- 7c. Admin: full write on structural + people tables.
do $$
declare t text;
begin
  foreach t in array array['departments','wards','beds','staff'] loop
    execute format('drop policy if exists "admin write" on %I;', t);
    execute format(
      'create policy "admin write" on %I
         for all to authenticated
         using ((select current_staff_role()) = ''admin'' and hospital_id = (select current_hospital_id()))
         with check ((select current_staff_role()) = ''admin'' and hospital_id = (select current_hospital_id()));', t);
  end loop;
end $$;

-- 7d. Reception/admin: register patients & open visits.
drop policy if exists "front desk write patients" on patients;
create policy "front desk write patients" on patients
  for all to authenticated
  using ((select current_staff_role()) in ('receptionist','nurse','admin','doctor')
         and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('receptionist','nurse','admin','doctor')
              and hospital_id = (select current_hospital_id()));

drop policy if exists "front desk write visits" on visits;
create policy "front desk write visits" on visits
  for all to authenticated
  using ((select current_staff_role()) in ('receptionist','nurse','admin','doctor')
         and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('receptionist','nurse','admin','doctor')
              and hospital_id = (select current_hospital_id()));

-- 7e. Doctors: consultations, diagnoses, orders, prescriptions, admissions.
do $$
declare t text;
begin
  foreach t in array array['consultations','diagnoses','orders','prescriptions','admissions'] loop
    execute format('drop policy if exists "doctor write" on %I;', t);
    execute format(
      'create policy "doctor write" on %I
         for all to authenticated
         using ((select current_staff_role()) in (''doctor'',''admin'') and hospital_id = (select current_hospital_id()))
         with check ((select current_staff_role()) in (''doctor'',''admin'') and hospital_id = (select current_hospital_id()));', t);
  end loop;
end $$;

-- 7f. Nurses: vitals, MAR, care plan, admission updates, transfers.
drop policy if exists "nurse write vitals" on treatment_records;
create policy "nurse write vitals" on treatment_records
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "nurse write mar" on medication_administrations;
create policy "nurse write mar" on medication_administrations
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "nurse write care plan items" on care_plan_items;
create policy "nurse write care plan items" on care_plan_items
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "nurse write care plan entries" on care_plan_entries;
create policy "nurse write care plan entries" on care_plan_entries
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "billing write items" on billable_items;
create policy "billing write items" on billable_items
  for all to authenticated
  using ((select current_staff_role()) in ('admin','receptionist') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('admin','receptionist') and hospital_id = (select current_hospital_id()));

drop policy if exists "billing write charges" on charges;
create policy "billing write charges" on charges
  for all to authenticated
  using ((select current_staff_role()) in ('admin','receptionist') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('admin','receptionist') and hospital_id = (select current_hospital_id()));

drop policy if exists "clinical write allergies" on allergies;
create policy "clinical write allergies" on allergies
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "clinical write patient history" on patient_history;
create policy "clinical write patient history" on patient_history
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "doctor write ros" on ros_responses;
create policy "doctor write ros" on ros_responses
  for all to authenticated
  using ((select current_staff_role()) in ('doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "nurse update admissions" on admissions;
create policy "nurse update admissions" on admissions
  for update to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

drop policy if exists "clinical write transfers" on transfers;
create policy "clinical write transfers" on transfers
  for all to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin') and hospital_id = (select current_hospital_id()));

-- 7g. Lab techs: enter results.
drop policy if exists "lab write results" on results;
create policy "lab write results" on results
  for all to authenticated
  using ((select current_staff_role()) in ('lab_tech','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('lab_tech','doctor','admin') and hospital_id = (select current_hospital_id()));

-- 7h. Pharmacists: update prescription status.
drop policy if exists "pharmacist update prescriptions" on prescriptions;
create policy "pharmacist update prescriptions" on prescriptions
  for update to authenticated
  using ((select current_staff_role()) in ('pharmacist','doctor','admin') and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('pharmacist','doctor','admin') and hospital_id = (select current_hospital_id()));

-- 7i. Audit log: admin-read-only.
drop policy if exists "admin read audit" on audit_log;
create policy "admin read audit" on audit_log
  for select to authenticated
  using ((select current_staff_role()) = 'admin' and hospital_id = (select current_hospital_id()));

-- 7j. Notifications + push subscriptions + usage telemetry.
drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications
  for select to authenticated
  using ((select is_staff()) and recipient_staff_id = (select current_staff_id()));

drop policy if exists "staff insert notifications" on notifications;
create policy "staff insert notifications" on notifications
  for insert to authenticated
  with check ((select is_staff()) and hospital_id = (select current_hospital_id()));

drop policy if exists "update own notifications" on notifications;
create policy "update own notifications" on notifications
  for update to authenticated
  using (recipient_staff_id = (select current_staff_id()))
  with check (recipient_staff_id = (select current_staff_id()));

drop policy if exists "delete own notifications" on notifications;
create policy "delete own notifications" on notifications
  for delete to authenticated
  using (recipient_staff_id = (select current_staff_id()));

drop policy if exists "manage own push subscriptions" on push_subscriptions;
create policy "manage own push subscriptions" on push_subscriptions
  for all to authenticated
  using ((select is_staff()) and staff_id = (select current_staff_id()))
  with check ((select is_staff()) and staff_id = (select current_staff_id()) and hospital_id = (select current_hospital_id()));

drop policy if exists "staff append own usage" on usage_events;
create policy "staff append own usage" on usage_events
  for insert to authenticated
  with check ((select is_staff()) and hospital_id = (select current_hospital_id()));

-- 7k. Storage: per-tenant file isolation (hospital-id path prefix).
drop policy if exists "staff read clinical files" on storage.objects;
create policy "staff read clinical files"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = (select current_hospital_id())::text
  );

drop policy if exists "staff write clinical files" on storage.objects;
create policy "staff write clinical files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = (select current_hospital_id())::text
  );

drop policy if exists "staff update clinical files" on storage.objects;
create policy "staff update clinical files"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = (select current_hospital_id())::text
  );

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
