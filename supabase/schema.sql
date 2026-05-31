-- =============================================================================
-- CareFlow — Supabase / PostgreSQL schema
-- =============================================================================
-- Copy-paste this entire file into the Supabase SQL Editor (or run via the CLI)
-- to provision every table, enum, index, trigger, audit log, storage bucket,
-- and Row-Level-Security policy the CareFlow hospital system needs.
--
-- Safe to re-run: it is written to be idempotent where practical (IF NOT EXISTS
-- / CREATE OR REPLACE / DROP POLICY IF EXISTS before CREATE POLICY).
--
-- Order of execution matters; do not reorder sections.
--   1. Extensions
--   2. Enumerated types
--   3. Helper functions (updated_at, audit, role lookup)
--   4. Tables (reference data -> people -> clinical -> ops -> audit)
--   5. Indexes
--   6. Triggers (updated_at, audit, bed-occupancy sync)
--   7. Views (reporting helpers)
--   8. Storage buckets
--   9. Row-Level Security + policies
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()


-- =============================================================================
-- 2. ENUMERATED TYPES
-- =============================================================================
do $$ begin
  create type staff_role as enum
    ('doctor', 'nurse', 'admin', 'lab_tech', 'pharmacist', 'receptionist');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sex_type as enum ('male', 'female', 'other', 'unknown');
exception when duplicate_object then null; end $$;

-- A "visit" is one trip the patient makes to the hospital. It is the spine of
-- the whole record: consultations, orders, prescriptions and (optionally) an
-- admission all hang off a visit.
do $$ begin
  create type visit_type as enum ('outpatient', 'inpatient', 'emergency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type visit_status as enum ('open', 'closed', 'cancelled');
exception when duplicate_object then null; end $$;

-- The care-journey stage (drives the live kanban board columns).
do $$ begin
  create type care_stage as enum
    ('registration', 'triage', 'consultation', 'diagnostics',
     'treatment', 'discharge_planning', 'discharged', 'followed_up');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_type as enum ('lab', 'imaging', 'procedure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum
    ('requested', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bed_status as enum
    ('free', 'occupied', 'reserved', 'cleaning', 'maintenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admission_status as enum ('active', 'discharged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prescription_status as enum ('active', 'completed', 'discontinued');
exception when duplicate_object then null; end $$;

-- Medication Administration Record status — what actually happened at the bedside.
do $$ begin
  create type mar_status as enum ('given', 'held', 'refused', 'missed');
exception when duplicate_object then null; end $$;

-- Allergy category — the kind of substance the patient reacts to.
do $$ begin
  create type allergy_category as enum ('drug', 'food', 'environmental', 'other');
exception when duplicate_object then null; end $$;

-- Allergy severity — clinical seriousness; 'life_threatening' = anaphylaxis.
do $$ begin
  create type allergy_severity as enum ('mild', 'moderate', 'severe', 'life_threatening');
exception when duplicate_object then null; end $$;


-- =============================================================================
-- 3. HELPER FUNCTIONS
-- =============================================================================

-- ---- 3a. Auto-maintain updated_at on any table that has the column ----------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---- 3b. Resolve the staff row / role of the currently logged-in user -------
-- staff.user_id is linked to Supabase auth.users(id). These helpers are used
-- throughout the RLS policies so a doctor sees doctor things, etc.
create or replace function current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.staff where user_id = auth.uid() limit 1;
$$;

create or replace function current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where user_id = auth.uid() limit 1;
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where user_id = auth.uid() and is_active = true
  );
$$;

-- ---- 3c. Generic audit trigger ---------------------------------------------
-- Writes a row to audit_log on every INSERT / UPDATE / DELETE of a table it is
-- attached to, capturing WHO (auth.uid + staff id) and WHEN, plus the before/
-- after snapshots. Attach only to sensitive tables (see section 6).
create or replace function audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_id text;
begin
  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old);
    v_new := null;
    v_record_id := (old).id::text;
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := (new).id::text;
  else -- INSERT
    v_old := null;
    v_new := to_jsonb(new);
    v_record_id := (new).id::text;
  end if;

  insert into public.audit_log
    (table_name, record_id, action, changed_by_user, changed_by_staff, old_data, new_data)
  values
    (tg_table_name, v_record_id, tg_op, auth.uid(), current_staff_id(), v_old, v_new);

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- ---- 3d. Auto-generated hospital number (MRN) ------------------------------
-- Every patient gets a permanent, human-readable hospital number on creation —
-- the digital equivalent of the patient-booklet number. Format:
--   CF-<year>-<6-digit running sequence>   e.g. "CF-2026-000123"
create sequence if not exists mrn_seq;

create or replace function generate_mrn()
returns text
language sql
volatile
as $$
  select 'CF-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('mrn_seq')::text, 6, '0');
$$;


-- =============================================================================
-- 4. TABLES
-- =============================================================================

-- ---- 4a. Reference / structural data (the editable "floor map") -------------

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,             -- e.g. "Maternity", "Ophthalmology"
  code        text unique,               -- short code, e.g. "MAT", "OPH"
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A ward is a floor/unit that belongs to a department. Admins create these
-- manually; the number of beds is driven by the beds table below so occupancy
-- always reflects reality.
create table if not exists wards (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references departments(id) on delete set null,
  name          text not null,           -- e.g. "Maternity Ward A"
  floor_label   text,                    -- e.g. "2nd Floor", "Block C"
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per physical bed. Admin adds/removes beds; status + the assigned
-- admission keep occupancy live. (current_admission_id is back-filled by a
-- trigger when a patient is assigned/discharged — see section 6.)
create table if not exists beds (
  id                   uuid primary key default gen_random_uuid(),
  ward_id              uuid not null references wards(id) on delete cascade,
  label                text not null,    -- e.g. "Bed 12", "A-04"
  status               bed_status not null default 'free',
  current_admission_id uuid,             -- FK added after admissions exists
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (ward_id, label)
);

-- ---- 4b. People -------------------------------------------------------------

-- Staff profiles. Each links to a Supabase auth user (created via Auth) so that
-- "logging in as a doctor" is real authentication, not a dropdown.
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users(id) on delete set null,
  full_name     text not null,
  role          staff_role not null,
  department_id uuid references departments(id) on delete set null,
  email         text unique,
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists patients (
  id                     uuid primary key default gen_random_uuid(),
  -- Permanent hospital number, auto-assigned (e.g. "CF-2026-000123"). This is
  -- the patient's stable reference across every visit — the digital booklet no.
  mrn                    text unique not null default generate_mrn(),
  full_name              text not null,
  date_of_birth          date,
  sex                    sex_type not null default 'unknown',
  phone                  text,
  address                text,
  national_id            text unique,    -- government national ID / NHIS, once known
  -- Emergency anonymous intake (unconscious / unidentified patient).
  is_emergency_anonymous boolean not null default false,
  anonymous_identifier   text,           -- e.g. "John Doe - Gamma - 20260531"
  -- True only once a clinician confirms no allergies; distinguishes "confirmed
  -- none" from an empty list that simply hasn't been asked yet.
  no_known_allergies     boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- A patient-level safety record. Keyed to the patient (not a visit) because an
-- allergy persists across every encounter. Surfaced wherever a doctor prescribes.
create table if not exists allergies (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients(id) on delete cascade,
  substance    text not null,                 -- e.g. "Penicillin", "Peanuts"
  category     allergy_category not null default 'drug',
  severity     allergy_severity not null default 'moderate',
  reaction     text,                          -- e.g. "Anaphylaxis", "Rash"
  noted_by_id  uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---- 4c. The visit (record spine) ------------------------------------------

create table if not exists visits (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references patients(id) on delete restrict,
  visit_type          visit_type not null default 'outpatient',
  status              visit_status not null default 'open',
  stage               care_stage not null default 'registration',
  department_id       uuid references departments(id) on delete set null,
  attending_doctor_id uuid references staff(id) on delete set null,
  -- Who did the nurse intake / registration.
  registered_by_id    uuid references staff(id) on delete set null,
  chief_complaint     text,
  triage_notes        text,             -- nurse's initial notes / observations
  arrived_at          timestamptz not null default now(),
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---- 4d. Clinical record (hangs off a visit) -------------------------------

-- The doctor's consultation note: subjective/assessment/plan free text.
create table if not exists consultations (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  doctor_id   uuid references staff(id) on delete set null,
  subjective  text,   -- what the patient reports
  examination text,   -- physical exam findings
  assessment  text,   -- the doctor's clinical assessment
  plan        text,   -- the plan: tests, meds, admit/discharge
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Structured diagnoses (ICD-10 where possible -> powers "top conditions" reports).
create table if not exists diagnoses (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references visits(id) on delete cascade,
  consultation_id uuid references consultations(id) on delete set null,
  diagnosed_by_id uuid references staff(id) on delete set null,
  icd10_code      text,
  description     text not null,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- A test the doctor recommends (lab / imaging / procedure).
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references visits(id) on delete cascade,
  ordered_by_id uuid references staff(id) on delete set null,
  order_type    order_type not null,
  description   text not null,          -- e.g. "Full Blood Count", "Chest X-ray"
  status        order_status not null default 'requested',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);

-- The result that closes the order loop. Files (scans, PDFs) go in the
-- 'lab-results' storage bucket; attachment_path stores the object path.
create table if not exists results (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  recorded_by_id  uuid references staff(id) on delete set null,
  summary         text,
  value           text,                 -- numeric/text result value
  reference_range text,
  attachment_path text,                 -- storage object path, nullable
  recorded_at     timestamptz not null default now()
);

-- A prescription / medication order (the "structure of medication").
create table if not exists prescriptions (
  id               uuid primary key default gen_random_uuid(),
  visit_id         uuid not null references visits(id) on delete cascade,
  prescribed_by_id uuid references staff(id) on delete set null,
  drug_name        text not null,
  dose             text,                -- e.g. "500 mg"
  route            text,                -- e.g. "oral", "IV"
  frequency        text,                -- e.g. "every 8 hours"
  duration         text,                -- e.g. "5 days"
  instructions     text,
  status           prescription_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Medication Administration Record: one row each time a nurse gives (or holds /
-- misses) a dose. This is how an on-call nurse knows what to administer next
-- without going back to the doctor, and the proof that care was delivered.
create table if not exists medication_administrations (
  id                uuid primary key default gen_random_uuid(),
  prescription_id   uuid not null references prescriptions(id) on delete cascade,
  administered_by_id uuid references staff(id) on delete set null,
  scheduled_for     timestamptz,
  administered_at    timestamptz,
  status            mar_status not null default 'given',
  notes             text,
  created_at        timestamptz not null default now()
);

-- Vitals / nursing checkpoints (SpO2, BP, pulse, temp, GCS).
create table if not exists treatment_records (
  id             uuid primary key default gen_random_uuid(),
  visit_id       uuid not null references visits(id) on delete cascade,
  recorded_by_id uuid references staff(id) on delete set null,
  spo2           numeric,
  pulse          numeric,
  bp_systolic    numeric,
  bp_diastolic   numeric,
  temperature_c  numeric,
  gcs_score      integer check (gcs_score is null or gcs_score between 3 and 15),
  notes          text,
  recorded_at    timestamptz not null default now()
);

-- ---- 4e. Admission (inpatient only; links a visit to a bed) -----------------

create table if not exists admissions (
  id                  uuid primary key default gen_random_uuid(),
  visit_id            uuid not null references visits(id) on delete cascade,
  patient_id          uuid not null references patients(id) on delete restrict,
  attending_doctor_id uuid references staff(id) on delete set null,
  ward_id             uuid references wards(id) on delete set null,
  bed_id              uuid references beds(id) on delete set null,
  status              admission_status not null default 'active',
  stage               care_stage not null default 'treatment',
  reason              text,
  -- Discharge clearance gates — all must be true before discharge.
  is_medical_cleared   boolean not null default false,
  is_financial_cleared boolean not null default false,
  is_pharmacy_ready    boolean not null default false,
  admitted_at         timestamptz not null default now(),
  discharged_at       timestamptz,
  updated_at          timestamptz not null default now()
);

-- Now that admissions exists, wire the bed -> admission back-reference.
do $$ begin
  alter table beds
    add constraint beds_current_admission_fk
    foreign key (current_admission_id) references admissions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---- 4f. Audit log ----------------------------------------------------------

create table if not exists audit_log (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  record_id        text,
  action           text not null,        -- INSERT / UPDATE / DELETE
  changed_by_user  uuid,                 -- auth.users id
  changed_by_staff uuid,                 -- staff id (resolved)
  changed_at       timestamptz not null default now(),
  old_data         jsonb,
  new_data         jsonb
);


-- =============================================================================
-- 5. INDEXES
-- =============================================================================
create index if not exists idx_visits_patient        on visits(patient_id);
create index if not exists idx_visits_status_stage    on visits(status, stage);
create index if not exists idx_visits_arrived_at      on visits(arrived_at);
create index if not exists idx_consultations_visit    on consultations(visit_id);
create index if not exists idx_diagnoses_visit        on diagnoses(visit_id);
create index if not exists idx_orders_visit           on orders(visit_id);
create index if not exists idx_orders_status          on orders(status);
create index if not exists idx_results_order          on results(order_id);
create index if not exists idx_prescriptions_visit    on prescriptions(visit_id);
create index if not exists idx_mar_prescription       on medication_administrations(prescription_id);
create index if not exists idx_treatment_visit        on treatment_records(visit_id);
create index if not exists idx_admissions_visit       on admissions(visit_id);
create index if not exists idx_admissions_status      on admissions(status);
create index if not exists idx_admissions_bed         on admissions(bed_id);
create index if not exists idx_allergies_patient      on allergies(patient_id);
create index if not exists idx_beds_ward              on beds(ward_id);
create index if not exists idx_beds_status            on beds(status);
create index if not exists idx_wards_department       on wards(department_id);
create index if not exists idx_staff_user            on staff(user_id);
create index if not exists idx_audit_table_record     on audit_log(table_name, record_id);
create index if not exists idx_audit_changed_at       on audit_log(changed_at);


-- =============================================================================
-- 6. TRIGGERS
-- =============================================================================

-- ---- 6a. updated_at maintenance on every table that has the column ----------
do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','orders','prescriptions','admissions','allergies'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on %I;', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on %I
         for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ---- 6b. Audit triggers on sensitive (clinical + structural) tables ---------
do $$
declare t text;
begin
  foreach t in array array[
    'patients','visits','consultations','diagnoses','orders','results',
    'prescriptions','medication_administrations','treatment_records',
    'admissions','beds','wards','departments','staff','allergies'
  ]
  loop
    execute format('drop trigger if exists trg_%I_audit on %I;', t, t);
    execute format(
      'create trigger trg_%I_audit
         after insert or update or delete on %I
         for each row execute function audit_trigger();', t, t);
  end loop;
end $$;

-- ---- 6c. Keep bed occupancy in sync with admissions ------------------------
-- When an admission is given a bed -> mark bed occupied + link it.
-- When the bed changes or the admission is discharged -> free the old bed.
create or replace function sync_bed_occupancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Free the previously-assigned bed if it changed or admission ended.
  if (tg_op = 'UPDATE') then
    if (old.bed_id is not null
        and (new.bed_id is distinct from old.bed_id
             or new.status = 'discharged')) then
      update beds
        set status = 'free', current_admission_id = null
        where id = old.bed_id;
    end if;
  end if;

  -- Occupy the new bed for an active admission.
  if (new.bed_id is not null and new.status = 'active') then
    update beds
      set status = 'occupied', current_admission_id = new.id
      where id = new.bed_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_admissions_bed_sync on admissions;
create trigger trg_admissions_bed_sync
  after insert or update on admissions
  for each row execute function sync_bed_occupancy();


-- =============================================================================
-- 7. VIEWS (reporting helpers)
-- =============================================================================

-- Live bed occupancy per ward (free vs occupied counts).
create or replace view ward_occupancy as
select
  w.id                                            as ward_id,
  w.name                                          as ward_name,
  w.floor_label,
  d.name                                          as department_name,
  count(b.id)                                      as total_beds,
  count(b.id) filter (where b.status = 'free')     as free_beds,
  count(b.id) filter (where b.status = 'occupied') as occupied_beds
from wards w
left join departments d on d.id = w.department_id
left join beds b        on b.ward_id = w.id
group by w.id, w.name, w.floor_label, d.name;

-- Admissions enriched for length-of-stay reporting.
create or replace view admission_report as
select
  a.id,
  p.full_name                                            as patient_name,
  a.admitted_at,
  a.discharged_at,
  a.status,
  w.name                                                 as ward_name,
  d.name                                                 as department_name,
  extract(epoch from (coalesce(a.discharged_at, now()) - a.admitted_at)) / 86400.0
                                                         as length_of_stay_days
from admissions a
join patients p     on p.id = a.patient_id
left join wards w   on w.id = a.ward_id
left join departments d on d.id = w.department_id;


-- =============================================================================
-- 8. STORAGE BUCKETS
-- =============================================================================
-- lab-results       : scanned/PDF lab + imaging results (private)
-- patient-documents : scanned booklets, consent forms, IDs (private)
insert into storage.buckets (id, name, public)
values ('lab-results', 'lab-results', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

-- Any authenticated staff member may read/write clinical files. Tighten later
-- if you need per-department isolation.
drop policy if exists "staff read clinical files" on storage.objects;
create policy "staff read clinical files"
  on storage.objects for select to authenticated
  using (bucket_id in ('lab-results','patient-documents') and is_staff());

drop policy if exists "staff write clinical files" on storage.objects;
create policy "staff write clinical files"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('lab-results','patient-documents') and is_staff());

drop policy if exists "staff update clinical files" on storage.objects;
create policy "staff update clinical files"
  on storage.objects for update to authenticated
  using (bucket_id in ('lab-results','patient-documents') and is_staff());


-- =============================================================================
-- 9. ROW-LEVEL SECURITY + POLICIES
-- =============================================================================
-- Model: any active staff member can READ the operational record. WRITES are
-- scoped by role. Admin can do everything. Adjust to your governance needs.
-- =============================================================================

-- Enable RLS on every table.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','allergies',
    'audit_log'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ---- 9a. Universal read for active staff ------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','allergies'
  ]
  loop
    execute format('drop policy if exists "read for staff" on %I;', t);
    execute format(
      'create policy "read for staff" on %I
         for select to authenticated using (is_staff());', t);
  end loop;
end $$;

-- ---- 9b. Admin: full write on structural + people tables --------------------
do $$
declare t text;
begin
  foreach t in array array['departments','wards','beds','staff'] loop
    execute format('drop policy if exists "admin write" on %I;', t);
    execute format(
      'create policy "admin write" on %I
         for all to authenticated
         using (current_staff_role() = ''admin'')
         with check (current_staff_role() = ''admin'');', t);
  end loop;
end $$;

-- ---- 9c. Reception/admin: register patients & open visits -------------------
drop policy if exists "front desk write patients" on patients;
create policy "front desk write patients" on patients
  for all to authenticated
  using (current_staff_role() in ('receptionist','nurse','admin','doctor'))
  with check (current_staff_role() in ('receptionist','nurse','admin','doctor'));

drop policy if exists "front desk write visits" on visits;
create policy "front desk write visits" on visits
  for all to authenticated
  using (current_staff_role() in ('receptionist','nurse','admin','doctor'))
  with check (current_staff_role() in ('receptionist','nurse','admin','doctor'));

-- ---- 9d. Doctors: consultations, diagnoses, orders, prescriptions, admit ----
do $$
declare t text;
begin
  foreach t in array array['consultations','diagnoses','orders','prescriptions','admissions'] loop
    execute format('drop policy if exists "doctor write" on %I;', t);
    execute format(
      'create policy "doctor write" on %I
         for all to authenticated
         using (current_staff_role() in (''doctor'',''admin''))
         with check (current_staff_role() in (''doctor'',''admin''));', t);
  end loop;
end $$;

-- ---- 9e. Nurses: vitals + medication administration -------------------------
drop policy if exists "nurse write vitals" on treatment_records;
create policy "nurse write vitals" on treatment_records
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin'))
  with check (current_staff_role() in ('nurse','doctor','admin'));

drop policy if exists "nurse write mar" on medication_administrations;
create policy "nurse write mar" on medication_administrations
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin'))
  with check (current_staff_role() in ('nurse','doctor','admin'));

-- Allergies are safety-critical and recorded at the point of care by either a
-- nurse (intake) or a doctor (consultation).
drop policy if exists "clinical write allergies" on allergies;
create policy "clinical write allergies" on allergies
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin'))
  with check (current_staff_role() in ('nurse','doctor','admin'));

-- Nurses may update admission stage/clearances (advance the board).
drop policy if exists "nurse update admissions" on admissions;
create policy "nurse update admissions" on admissions
  for update to authenticated
  using (current_staff_role() in ('nurse','doctor','admin'))
  with check (current_staff_role() in ('nurse','doctor','admin'));

-- ---- 9f. Lab techs: enter results ------------------------------------------
drop policy if exists "lab write results" on results;
create policy "lab write results" on results
  for all to authenticated
  using (current_staff_role() in ('lab_tech','doctor','admin'))
  with check (current_staff_role() in ('lab_tech','doctor','admin'));

-- ---- 9g. Pharmacists: update prescription status ---------------------------
drop policy if exists "pharmacist update prescriptions" on prescriptions;
create policy "pharmacist update prescriptions" on prescriptions
  for update to authenticated
  using (current_staff_role() in ('pharmacist','doctor','admin'))
  with check (current_staff_role() in ('pharmacist','doctor','admin'));

-- ---- 9h. Audit log: readable by admin only, never writable from the client --
drop policy if exists "admin read audit" on audit_log;
create policy "admin read audit" on audit_log
  for select to authenticated using (current_staff_role() = 'admin');
-- (No INSERT/UPDATE/DELETE policy => clients cannot tamper with the audit log.
--  Rows are written only by the SECURITY DEFINER audit_trigger function.)

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
