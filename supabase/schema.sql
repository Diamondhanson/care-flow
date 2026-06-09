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
--   3. Helper functions (updated_at, audit, role + hospital lookup)
--   4. Tables (tenant -> reference data -> people -> clinical -> ops -> audit)
--   5. Indexes
--   6. Triggers (updated_at, audit, bed-occupancy sync)
--   7. Views (reporting helpers)
--   8. Storage buckets
--   9. Row-Level Security + policies
--
-- MULTI-TENANCY: each hospital is an isolated tenant. Every domain table carries
-- a `hospital_id` FK, every RLS policy ANDs in `hospital_id = current_hospital_id()`,
-- and storage paths are prefixed with the hospital id — so one hospital can never
-- read or write another's data.
-- =============================================================================


-- =============================================================================
-- 0. SESSION SETTINGS
-- =============================================================================
-- The tenancy helper functions (current_staff_id / current_hospital_id / …) are
-- `language sql` and are defined before the tables they read, so Postgres would
-- reject them at creation time when validating their bodies against not-yet-
-- existing relations. Disable body validation for this load; the references all
-- resolve once the whole script has run.
set check_function_bodies = off;

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

-- Nursing care-need category — Henderson's 14 components of basic care, named
-- practically. Drives the care-plan quick-pick and grouping.
do $$ begin
  create type care_need_category as enum (
    'breathing', 'nutrition', 'elimination', 'mobility_positioning',
    'sleep_rest', 'hygiene', 'temperature', 'dressing', 'safety',
    'communication_emotional', 'pain_comfort', 'spiritual',
    'wound_skin_care', 'other'
  );
exception when duplicate_object then null; end $$;

-- Care-plan item lifecycle — an active need vs. one that's been resolved (kept,
-- never deleted, so the plan's history stays intact).
do $$ begin
  create type care_plan_item_status as enum ('active', 'resolved');
exception when duplicate_object then null; end $$;

-- A hospital's account/billing state (multi-tenant SaaS). A non-active account is
-- access-restricted (the monetization gate); 'trial' is a time-limited full-access
-- state granted at signup.
do $$ begin
  create type subscription_status as enum ('trial', 'active', 'suspended');
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

-- ---- 3a-bis. Optimistic-concurrency version bump ---------------------------
-- Every UPDATE to a versioned row increments its version. Clients send the
-- base version they read; the conditional update in the sync layer guards on
-- it (.eq('version', base)), so a write targeting a stale version matches zero
-- rows and is surfaced as a conflict. We force the bump here (rather than
-- trusting the client payload) so the server is always the source of truth.
create or replace function bump_version()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
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

-- ---- 3b-bis. Resolve the hospital (tenant) of the currently logged-in user ---
-- The make-or-break of multi-tenancy: every RLS policy ANDs in
-- `hospital_id = current_hospital_id()` so Hospital A can never read or write
-- Hospital B's rows. Resolved from the user's own staff row.
create or replace function current_hospital_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select hospital_id from public.staff where user_id = auth.uid() limit 1;
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
  v_hospital_id uuid;
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

  -- Stamp the tenant on every audit row so the log itself is hospital-scoped.
  -- Read from the row's JSON (robust across tables); falls back to the logged-in
  -- user's hospital when the table has no hospital_id column (e.g. the hospitals
  -- table, where the record id *is* the tenant).
  v_hospital_id := nullif(coalesce(v_new->>'hospital_id', v_old->>'hospital_id'), '')::uuid;
  if v_hospital_id is null then
    v_hospital_id := current_hospital_id();
  end if;

  insert into public.audit_log
    (table_name, record_id, action, changed_by_user, changed_by_staff, hospital_id, old_data, new_data)
  values
    (tg_table_name, v_record_id, tg_op, auth.uid(), current_staff_id(), v_hospital_id, v_old, v_new);

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- ---- 3d. Patient ID (Cameroon booklet number) -----------------------------
-- The human-facing patient ID is the Cameroon-standard booklet number derived
-- from birth date + name initials + mother's-first-name initial, generated by
-- the application at registration. Format:
--   YYMMDD + name initials + ' - ' + mother's initial   e.g. "981120BHN - N"
-- Clashes get a numeric suffix ("…-2", "…-3"), checked per hospital (see the
-- composite unique on patients). The app supplies the value on insert; the
-- patient UUID remains the true internal key.


-- =============================================================================
-- 4. TABLES
-- =============================================================================

-- ---- 4a. Tenant / account (multi-tenant SaaS) ------------------------------
-- Each hospital is an isolated tenant. Every domain table below carries a
-- `hospital_id` FK back to this table, and every RLS policy filters on it, so
-- one hospital can never see another's data. This is the account entity where
-- subscription/monetization state lives, too.
create table if not exists hospitals (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  region              text,                       -- city / region, e.g. "Douala"
  contact_email       text,
  contact_phone       text,
  subscription_tier   text not null default 'standard',
  subscription_status subscription_status not null default 'trial',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---- 4b. Reference / structural data (the editable "floor map") -------------

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  name        text not null,             -- e.g. "Maternity", "Ophthalmology"
  code        text,                      -- short code, e.g. "MAT", "OPH"
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Codes and names are unique *within* a hospital, not globally.
  unique (hospital_id, code),
  unique (hospital_id, name)
);

-- A ward is a floor/unit that belongs to a department. Admins create these
-- manually; the number of beds is driven by the beds table below so occupancy
-- always reflects reality.
create table if not exists wards (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name          text not null,           -- e.g. "Maternity Ward A"
  floor_label   text,                    -- e.g. "2nd Floor", "Block C"
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (hospital_id, name)             -- ward names unique within a hospital
);

-- One row per physical bed. Admin adds/removes beds; status + the assigned
-- admission keep occupancy live. (current_admission_id is back-filled by a
-- trigger when a patient is assigned/discharged — see section 6.)
create table if not exists beds (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid not null references hospitals(id) on delete cascade,
  ward_id              uuid not null references wards(id) on delete cascade,
  label                text not null,    -- e.g. "Bed 12", "A-04"
  status               bed_status not null default 'free',
  current_admission_id uuid,             -- FK added after admissions exists
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Labels are unique per ward (so "Bed 1" can exist in every ward). A ward
  -- belongs to exactly one hospital, so this is already tenant-isolated.
  unique (ward_id, label)
);

-- ---- 4c. People -------------------------------------------------------------

-- Staff profiles. Each links to a Supabase auth user (created via Auth) so that
-- "logging in as a doctor" is real authentication, not a dropdown. A staff row
-- belongs to exactly one hospital; `current_hospital_id()` resolves the logged-in
-- user's tenant from here.
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  user_id       uuid unique references auth.users(id) on delete set null,
  full_name     text not null,
  role          staff_role not null,
  department_id uuid references departments(id) on delete set null,
  -- Login handle. The admin creates staff with a username (no email required)
  -- and assigns a password; the password itself lives in Supabase Auth
  -- (auth.users), linked via user_id. Unique within a hospital.
  username      text,
  email         text,
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Email unique within a hospital (the same person may work at two facilities);
  -- the auth-user link stays globally unique (one login = one staff row).
  unique (hospital_id, email),
  -- Username unique within a hospital (multiple NULLs allowed for legacy rows).
  unique (hospital_id, username)
);

create table if not exists patients (
  id                     uuid primary key default gen_random_uuid(),
  hospital_id            uuid not null references hospitals(id) on delete cascade,
  -- Cameroon booklet patient ID (e.g. "981120BHN - N"), supplied by the app at
  -- registration — the patient's stable human-facing reference across visits.
  -- Nullable: emergency-anonymous records carry no ID until reconciliation.
  -- (Unique allows multiple NULLs in Postgres, so unreconciled records coexist.)
  mrn                    text,
  full_name              text not null,
  date_of_birth          date,
  sex                    sex_type not null default 'unknown',
  phone                  text,
  address                text,
  national_id            text,           -- government national ID / NHIS, once known
  mother_first_name      text,           -- supplies the patient ID's trailing initial
  -- Emergency anonymous intake (unconscious / unidentified patient).
  is_emergency_anonymous boolean not null default false,
  anonymous_identifier   text,           -- e.g. "John Doe - Gamma - 20260531"
  -- True only once a clinician confirms no allergies; distinguishes "confirmed
  -- none" from an empty list that simply hasn't been asked yet.
  no_known_allergies     boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Patient ID and national ID are unique *within* a hospital: the same person
  -- may legitimately be a patient at more than one facility. The clash-suffix
  -- check in Phase 16.7 now scopes per hospital, which is more correct.
  unique (hospital_id, mrn),
  unique (hospital_id, national_id)
);

-- A patient-level safety record. Keyed to the patient (not a visit) because an
-- allergy persists across every encounter. Surfaced wherever a doctor prescribes.
create table if not exists allergies (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  substance    text not null,                 -- e.g. "Penicillin", "Peanuts"
  category     allergy_category not null default 'drug',
  severity     allergy_severity not null default 'moderate',
  reaction     text,                          -- e.g. "Anaphylaxis", "Rash"
  noted_by_id  uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---- 4d. The visit (record spine) ------------------------------------------

create table if not exists visits (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid not null references hospitals(id) on delete cascade,
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
  -- Emergency-severity acuity (1 = critical … 5 = non-urgent); null until triaged.
  triage_level        smallint check (triage_level is null or triage_level between 1 and 5),
  arrived_at          timestamptz not null default now(),
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---- 4e. Clinical record (hangs off a visit) -------------------------------

-- The doctor's consultation note: subjective/assessment/plan free text.
create table if not exists consultations (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
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
  hospital_id     uuid not null references hospitals(id) on delete cascade,
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
  hospital_id   uuid not null references hospitals(id) on delete cascade,
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
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  recorded_by_id  uuid references staff(id) on delete set null,
  summary         text,
  value           text,                 -- numeric/text result value
  reference_range text,
  -- Flagged out-of-range / clinically significant; drives review highlighting.
  is_abnormal     boolean not null default false,
  attachment_path text,                 -- storage object path, nullable
  recorded_at     timestamptz not null default now()
);

-- A prescription / medication order (the "structure of medication").
create table if not exists prescriptions (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null references hospitals(id) on delete cascade,
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
  hospital_id       uuid not null references hospitals(id) on delete cascade,
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
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  visit_id       uuid not null references visits(id) on delete cascade,
  recorded_by_id uuid references staff(id) on delete set null,
  spo2           numeric,
  pulse          numeric,
  bp_systolic    numeric,
  bp_diastolic   numeric,
  temperature_c  numeric,
  weight_kg      numeric,              -- body weight, kilograms; null when not measured
  gcs_score      integer check (gcs_score is null or gcs_score between 3 and 15),
  notes          text,
  recorded_at    timestamptz not null default now()
);

-- ---- 4f. Admission (inpatient only; links a visit to a bed) -----------------

create table if not exists admissions (
  id                  uuid primary key default gen_random_uuid(),
  hospital_id         uuid not null references hospitals(id) on delete cascade,
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

-- ---- 4g. Transfers (ward / bed / doctor moves as first-class events) --------
-- Append-only history of a patient moving during an admission. The admission
-- row always reflects the *current* placement; this table records each move so
-- bed history and attending-doctor changes are auditable. A null from/to pair
-- for a dimension means that dimension was unchanged by the move.
create table if not exists transfers (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null references hospitals(id) on delete cascade,
  admission_id      uuid not null references admissions(id) on delete cascade,
  patient_id        uuid not null references patients(id) on delete restrict,
  from_ward_id      uuid references wards(id) on delete set null,
  to_ward_id        uuid references wards(id) on delete set null,
  from_bed_id       uuid references beds(id) on delete set null,
  to_bed_id         uuid references beds(id) on delete set null,
  from_doctor_id    uuid references staff(id) on delete set null,
  to_doctor_id      uuid references staff(id) on delete set null,
  reason            text,
  transferred_by_id uuid references staff(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---- 4h. Nursing care plan (individualized inpatient care) ------------------
-- The non-medication care a nurse delivers during an admission: hygiene,
-- nutrition, positioning, comfort, etc. `care_plan_items` are the standing needs
-- (with a goal + how often), each open until explicitly resolved.
create table if not exists care_plan_items (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  admission_id  uuid not null references admissions(id) on delete cascade,
  patient_id    uuid not null references patients(id) on delete restrict,
  category      care_need_category not null,
  description   text not null,
  frequency     text,
  goal          text,
  status        care_plan_item_status not null default 'active',
  created_by_id uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The care log + shift handover: an append-only note recording care that was
-- delivered, or a handover message for the next nurse. Never overwritten
-- (mirrors transfers), so continuity survives a shift change. Optionally tied to
-- a specific care-plan item.
create table if not exists care_plan_entries (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null references hospitals(id) on delete cascade,
  admission_id       uuid not null references admissions(id) on delete cascade,
  care_plan_item_id  uuid references care_plan_items(id) on delete set null,
  note               text not null,
  is_handover        boolean not null default false,
  recorded_by_id     uuid references staff(id) on delete set null,
  recorded_at        timestamptz not null default now()
);

-- ---- 4i. Audit log ----------------------------------------------------------

create table if not exists audit_log (
  id               bigint generated always as identity primary key,
  table_name       text not null,
  record_id        text,
  action           text not null,        -- INSERT / UPDATE / DELETE
  changed_by_user  uuid,                 -- auth.users id
  changed_by_staff uuid,                 -- staff id (resolved)
  hospital_id      uuid,                 -- tenant the change belongs to (nullable)
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
create index if not exists idx_transfers_admission    on transfers(admission_id);
create index if not exists idx_transfers_patient      on transfers(patient_id);
create index if not exists idx_care_plan_items_admission   on care_plan_items(admission_id);
create index if not exists idx_care_plan_items_status       on care_plan_items(status);
create index if not exists idx_care_plan_entries_admission  on care_plan_entries(admission_id);
create index if not exists idx_care_plan_entries_item       on care_plan_entries(care_plan_item_id);
create index if not exists idx_allergies_patient      on allergies(patient_id);
create index if not exists idx_beds_ward              on beds(ward_id);
create index if not exists idx_beds_status            on beds(status);
create index if not exists idx_wards_department       on wards(department_id);
create index if not exists idx_staff_user            on staff(user_id);
create index if not exists idx_audit_table_record     on audit_log(table_name, record_id);
create index if not exists idx_audit_changed_at       on audit_log(changed_at);

-- ---- Tenant (hospital_id) indexes — every RLS policy filters on hospital_id, so
-- index it on each domain table for fast tenant-scoped scans.
create index if not exists idx_departments_hospital   on departments(hospital_id);
create index if not exists idx_wards_hospital          on wards(hospital_id);
create index if not exists idx_beds_hospital           on beds(hospital_id);
create index if not exists idx_staff_hospital          on staff(hospital_id);
create index if not exists idx_patients_hospital       on patients(hospital_id);
create index if not exists idx_allergies_hospital      on allergies(hospital_id);
create index if not exists idx_visits_hospital         on visits(hospital_id);
create index if not exists idx_consultations_hospital  on consultations(hospital_id);
create index if not exists idx_diagnoses_hospital      on diagnoses(hospital_id);
create index if not exists idx_orders_hospital         on orders(hospital_id);
create index if not exists idx_results_hospital        on results(hospital_id);
create index if not exists idx_prescriptions_hospital  on prescriptions(hospital_id);
create index if not exists idx_mar_hospital            on medication_administrations(hospital_id);
create index if not exists idx_treatment_hospital      on treatment_records(hospital_id);
create index if not exists idx_admissions_hospital     on admissions(hospital_id);
create index if not exists idx_transfers_hospital      on transfers(hospital_id);
create index if not exists idx_care_plan_items_hospital   on care_plan_items(hospital_id);
create index if not exists idx_care_plan_entries_hospital on care_plan_entries(hospital_id);
create index if not exists idx_audit_hospital          on audit_log(hospital_id);


-- =============================================================================
-- 6. TRIGGERS
-- =============================================================================

-- ---- 6a. updated_at maintenance on every table that has the column ----------
do $$
declare t text;
begin
  foreach t in array array[
    'hospitals','departments','wards','beds','staff','patients','visits',
    'consultations','orders','prescriptions','admissions','allergies',
    'care_plan_items'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on %I;', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on %I
         for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ---- 6a-bis. Optimistic-concurrency version column + bump trigger ----------
-- Same set of mutable tables that carry updated_at. Append-only tables
-- (results, diagnoses, medication_administrations, treatment_records,
-- transfers, care_plan_entries, audit_log) are never updated, so they need no
-- version. Adding the column is idempotent so re-applying schema.sql is safe.
do $$
declare t text;
begin
  foreach t in array array[
    'hospitals','departments','wards','beds','staff','patients','visits',
    'consultations','orders','prescriptions','admissions','allergies',
    'care_plan_items'
  ]
  loop
    execute format(
      'alter table %I add column if not exists version integer not null default 1;', t);
    execute format('drop trigger if exists trg_%I_version on %I;', t, t);
    execute format(
      'create trigger trg_%I_version before update on %I
         for each row execute function bump_version();', t, t);
  end loop;
end $$;

-- ---- 6b. Audit triggers on sensitive (clinical + structural) tables ---------
do $$
declare t text;
begin
  foreach t in array array[
    'patients','visits','consultations','diagnoses','orders','results',
    'prescriptions','medication_administrations','treatment_records',
    'admissions','transfers','beds','wards','departments','staff','allergies',
    'care_plan_items','care_plan_entries'
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
-- security_invoker = true makes the view run with the querying user's privileges,
-- so the underlying tables' tenant RLS applies and the view is hospital-scoped.
create or replace view ward_occupancy
with (security_invoker = true) as
select
  w.hospital_id                                    as hospital_id,
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
group by w.hospital_id, w.id, w.name, w.floor_label, d.name;

-- Admissions enriched for length-of-stay reporting.
create or replace view admission_report
with (security_invoker = true) as
select
  a.id,
  a.hospital_id                                          as hospital_id,
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

-- Per-tenant file isolation: every object path MUST be prefixed with the owning
-- hospital's id, e.g. "<hospital_id>/visit-123/result.pdf". The policies below
-- require the first path segment to equal the staff member's hospital, so files
-- can never leak across tenants — the storage equivalent of the table RLS.
drop policy if exists "staff read clinical files" on storage.objects;
create policy "staff read clinical files"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = current_hospital_id()::text
  );

drop policy if exists "staff write clinical files" on storage.objects;
create policy "staff write clinical files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = current_hospital_id()::text
  );

drop policy if exists "staff update clinical files" on storage.objects;
create policy "staff update clinical files"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('lab-results','patient-documents')
    and is_staff()
    and (storage.foldername(name))[1] = current_hospital_id()::text
  );


-- =============================================================================
-- 9. ROW-LEVEL SECURITY + POLICIES
-- =============================================================================
-- Model: any active staff member can READ the operational record. WRITES are
-- scoped by role. Admin can do everything. Adjust to your governance needs.
--
-- TENANT ISOLATION: every policy below ALSO requires
-- `hospital_id = current_hospital_id()` so a role check never leaks across
-- hospitals — a doctor at Hospital A can write doctor things, but only for
-- Hospital A's rows. The helpers current_staff_role()/current_hospital_id()
-- both resolve from the logged-in user's single staff row.
-- =============================================================================

-- Enable RLS on every table.
do $$
declare t text;
begin
  foreach t in array array[
    'hospitals',
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','transfers',
    'allergies','care_plan_items','care_plan_entries','audit_log'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ---- 9a₀. The hospitals (tenant) table itself ------------------------------
-- Staff may read only their own hospital's account row; an admin may update it
-- (e.g. contact details). Row creation happens at signup via a privileged
-- server context (Supabase Edge Function / service role) that bypasses RLS — so
-- there is deliberately no client INSERT policy here (Phase 17 onboarding).
drop policy if exists "staff read own hospital" on hospitals;
create policy "staff read own hospital" on hospitals
  for select to authenticated
  using (id = current_hospital_id());

drop policy if exists "admin update own hospital" on hospitals;
create policy "admin update own hospital" on hospitals
  for update to authenticated
  using (id = current_hospital_id() and current_staff_role() = 'admin')
  with check (id = current_hospital_id() and current_staff_role() = 'admin');

-- ---- 9a. Universal read for active staff ------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'departments','wards','beds','staff','patients','visits',
    'consultations','diagnoses','orders','results','prescriptions',
    'medication_administrations','treatment_records','admissions','transfers',
    'allergies','care_plan_items','care_plan_entries'
  ]
  loop
    execute format('drop policy if exists "read for staff" on %I;', t);
    execute format(
      'create policy "read for staff" on %I
         for select to authenticated
         using (is_staff() and hospital_id = current_hospital_id());', t);
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
         using (current_staff_role() = ''admin'' and hospital_id = current_hospital_id())
         with check (current_staff_role() = ''admin'' and hospital_id = current_hospital_id());', t);
  end loop;
end $$;

-- ---- 9c. Reception/admin: register patients & open visits -------------------
drop policy if exists "front desk write patients" on patients;
create policy "front desk write patients" on patients
  for all to authenticated
  using (current_staff_role() in ('receptionist','nurse','admin','doctor')
         and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('receptionist','nurse','admin','doctor')
              and hospital_id = current_hospital_id());

drop policy if exists "front desk write visits" on visits;
create policy "front desk write visits" on visits
  for all to authenticated
  using (current_staff_role() in ('receptionist','nurse','admin','doctor')
         and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('receptionist','nurse','admin','doctor')
              and hospital_id = current_hospital_id());

-- ---- 9d. Doctors: consultations, diagnoses, orders, prescriptions, admit ----
do $$
declare t text;
begin
  foreach t in array array['consultations','diagnoses','orders','prescriptions','admissions'] loop
    execute format('drop policy if exists "doctor write" on %I;', t);
    execute format(
      'create policy "doctor write" on %I
         for all to authenticated
         using (current_staff_role() in (''doctor'',''admin'') and hospital_id = current_hospital_id())
         with check (current_staff_role() in (''doctor'',''admin'') and hospital_id = current_hospital_id());', t);
  end loop;
end $$;

-- ---- 9e. Nurses: vitals + medication administration -------------------------
drop policy if exists "nurse write vitals" on treatment_records;
create policy "nurse write vitals" on treatment_records
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

drop policy if exists "nurse write mar" on medication_administrations;
create policy "nurse write mar" on medication_administrations
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- The nursing care plan is authored at the bedside by nurses (doctors/admin may
-- also write). Items can be updated (e.g. resolved); the log is append-only by
-- convention in the app, but the policy simply scopes writes to clinical roles.
drop policy if exists "nurse write care plan items" on care_plan_items;
create policy "nurse write care plan items" on care_plan_items
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

drop policy if exists "nurse write care plan entries" on care_plan_entries;
create policy "nurse write care plan entries" on care_plan_entries
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- Allergies are safety-critical and recorded at the point of care by either a
-- nurse (intake) or a doctor (consultation).
drop policy if exists "clinical write allergies" on allergies;
create policy "clinical write allergies" on allergies
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- Nurses may update admission stage/clearances (advance the board).
drop policy if exists "nurse update admissions" on admissions;
create policy "nurse update admissions" on admissions
  for update to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- Bed/ward/doctor moves are logged by the clinician making the move.
drop policy if exists "clinical write transfers" on transfers;
create policy "clinical write transfers" on transfers
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- ---- 9f. Lab techs: enter results ------------------------------------------
drop policy if exists "lab write results" on results;
create policy "lab write results" on results
  for all to authenticated
  using (current_staff_role() in ('lab_tech','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('lab_tech','doctor','admin') and hospital_id = current_hospital_id());

-- ---- 9g. Pharmacists: update prescription status ---------------------------
drop policy if exists "pharmacist update prescriptions" on prescriptions;
create policy "pharmacist update prescriptions" on prescriptions
  for update to authenticated
  using (current_staff_role() in ('pharmacist','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('pharmacist','doctor','admin') and hospital_id = current_hospital_id());

-- ---- 9h. Audit log: readable by admin only (and only their own hospital's),
--          never writable from the client ----------------------------------
drop policy if exists "admin read audit" on audit_log;
create policy "admin read audit" on audit_log
  for select to authenticated
  using (current_staff_role() = 'admin' and hospital_id = current_hospital_id());
-- (No INSERT/UPDATE/DELETE policy => clients cannot tamper with the audit log.
--  Rows are written only by the SECURITY DEFINER audit_trigger function.)

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
