-- ============================================================================
-- Phase 21 — Patient Demographics & Review of Systems (ROS)
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- ⚠️ Apply this to the hosted Supabase project BEFORE deploying the Phase-21
-- app build: patient and consultation rows written by that build carry the new
-- columns below, and the outbox replays whole rows — against the old schema
-- every such write fails (PGRST204) and stays queued.
--
-- This is a verbatim extract of the Phase-21 additions in packages/db/schema.sql
-- (the single source of truth), with the loop-managed triggers/policies written
-- out explicitly for the two new tables. Re-applying the full schema.sql also
-- works if the hosted project is otherwise up to date.
-- ============================================================================

-- ---- 1. Enums ---------------------------------------------------------------

do $$ begin
  create type body_system as enum (
    'general', 'cardiac', 'respiratory', 'gi', 'gu', 'neuro',
    'ent', 'eyes', 'skin', 'musculoskeletal', 'psych', 'obstetric_gynae'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ros_answer_type as enum (
    'boolean', 'single_select', 'multi_select', 'scale',
    'duration', 'numeric', 'date', 'text'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ros_question_kind as enum ('symptom', 'history', 'genetic');
exception when duplicate_object then null; end $$;

do $$ begin
  create type patient_history_type as enum (
    'past_medical', 'past_surgical', 'family', 'social',
    'obstetric_gynae', 'medication', 'immunization'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type marital_status as enum (
    'single', 'married', 'partnered', 'divorced', 'widowed', 'unknown'
  );
exception when duplicate_object then null; end $$;

-- ---- 2. New columns ----------------------------------------------------------

alter table patients add column if not exists occupation              text;
alter table patients add column if not exists marital_status          marital_status not null default 'unknown';
alter table patients add column if not exists emergency_contact_name  text;
alter table patients add column if not exists emergency_contact_phone text;

alter table consultations add column if not exists ros_summary text;

-- ---- 3. Tables ----------------------------------------------------------------

create table if not exists patient_history (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  type         patient_history_type not null,
  description  text not null,
  detail       jsonb,
  onset        text,
  is_active    boolean,
  noted_by_id  uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists ros_responses (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  visit_id        uuid not null references visits(id) on delete cascade,
  consultation_id uuid references consultations(id) on delete set null,
  system          body_system not null,
  question_key    text not null,
  kind            ros_question_kind not null default 'symptom',
  question_text   text not null,
  answer_type     ros_answer_type not null,
  answer_value    jsonb not null,
  answer_label    text not null,
  note            text,
  recorded_by_id  uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (visit_id, question_key)
);

-- ---- 4. Indexes ----------------------------------------------------------------

create index if not exists idx_patient_history_patient  on patient_history(patient_id);
create index if not exists idx_patient_history_type     on patient_history(type);
create index if not exists idx_patient_history_hospital on patient_history(hospital_id);
create index if not exists idx_ros_responses_visit      on ros_responses(visit_id);
create index if not exists idx_ros_responses_system     on ros_responses(system);
create index if not exists idx_ros_responses_hospital   on ros_responses(hospital_id);

-- ---- 5. Triggers (updated_at · optimistic-concurrency version · audit) ---------
-- Explicit per-table versions of the schema.sql loops (6a, 6a-bis, 6b).

do $$
declare t text;
begin
  foreach t in array array['patient_history','ros_responses']
  loop
    execute format('drop trigger if exists trg_%I_updated_at on %I;', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on %I
         for each row execute function set_updated_at();', t, t);

    execute format(
      'alter table %I add column if not exists version integer not null default 1;', t);
    execute format('drop trigger if exists trg_%I_version on %I;', t, t);
    execute format(
      'create trigger trg_%I_version before update on %I
         for each row execute function bump_version();', t, t);

    execute format('drop trigger if exists trg_%I_audit on %I;', t, t);
    execute format(
      'create trigger trg_%I_audit
         after insert or update or delete on %I
         for each row execute function audit_trigger();', t, t);
  end loop;
end $$;

-- ---- 6. Row-Level Security ------------------------------------------------------

alter table patient_history enable row level security;
alter table ros_responses  enable row level security;

-- Universal read for active staff (mirror of schema.sql loop 9a).
drop policy if exists "read for staff" on patient_history;
create policy "read for staff" on patient_history
  for select to authenticated
  using (is_staff() and hospital_id = current_hospital_id());

drop policy if exists "read for staff" on ros_responses;
create policy "read for staff" on ros_responses
  for select to authenticated
  using (is_staff() and hospital_id = current_hospital_id());

-- Clinical background: recorded/updated by clinicians (nurse at intake, doctor
-- in consult).
drop policy if exists "clinical write patient history" on patient_history;
create policy "clinical write patient history" on patient_history
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- Review of Systems: authored by the doctor during the consultation.
drop policy if exists "doctor write ros" on ros_responses;
create policy "doctor write ros" on ros_responses
  for all to authenticated
  using (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id());
