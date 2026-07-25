-- =============================================================================
-- Stage 2 top-up: learned clinical terms become a synced, per-hospital table.
-- Apply to an EXISTING database that already ran supabase/schema.sql before
-- Stage 2 (a full re-run of schema.sql includes all of this and is equivalent):
--
--   supabase db execute --file supabase/snippets/stage-2-clinical-terms.sql
--   -- or: psql "$DB" -f supabase/snippets/stage-2-clinical-terms.sql
-- =============================================================================

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
  using (is_staff() and hospital_id = current_hospital_id());

drop policy if exists "clinical write terms" on clinical_terms;
create policy "clinical write terms" on clinical_terms
  for all to authenticated
  using (current_staff_role() in ('doctor','nurse','pharmacist','lab_tech','admin')
         and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('doctor','nurse','pharmacist','lab_tech','admin')
              and hospital_id = current_hospital_id());
