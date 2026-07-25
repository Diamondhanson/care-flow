-- =============================================================================
-- Stage 5 top-up: real post-discharge follow-up tasks (replaces the pretend
-- "SMS sent" console stubs). Apply to an EXISTING database (a full re-run of
-- schema.sql includes all of this and is equivalent):
--
--   supabase db execute --file supabase/snippets/stage-5-follow-up-tasks.sql
--   -- or: psql "$DB" -f supabase/snippets/stage-5-follow-up-tasks.sql
-- =============================================================================

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
  using (is_staff() and hospital_id = current_hospital_id());

drop policy if exists "clinical write follow ups" on follow_up_tasks;
create policy "clinical write follow ups" on follow_up_tasks
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'follow_up_tasks'
     ) then
    alter publication supabase_realtime add table follow_up_tasks;
  end if;
end $$;
