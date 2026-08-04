-- ============================================================================
-- AI decision-support: ai_suggestions audit trail  (Phase 22)
-- Hosted migration snippet. Idempotent: safe to re-run.
--
-- Adds the `ai_suggestions` table: every AI interaction (suggested plan,
-- suggested diagnosis/meds, Ask CareFlow question) is recorded here — never
-- trusted, always logged. This is both the compliance record and the future
-- quality-evaluation dataset. The AI never writes clinical tables; a doctor's
-- Accept flows through the existing client services + outbox. Verbatim
-- extract of the additions in packages/db/schema.sql (the single source of
-- truth). Spec: docs/CareFlow-AI-Build-Spec.md (Rev 2).
--
-- ⚠️ Deploy coupling: apply this to the hosted DB BEFORE deploying a build
-- that writes ai_suggestions — otherwise those inserts queue-fail against the
-- missing table (Phase 21 lesson).
-- ============================================================================

-- Which AI feature produced the suggestion.
do $$ begin
  create type ai_feature as enum ('plan', 'results', 'ask_patient', 'ask_cohort');
exception when duplicate_object then null; end $$;

-- What the clinician did with it. Every row starts as 'shown'.
do $$ begin
  create type ai_decision as enum ('shown', 'accepted', 'edited', 'dismissed');
exception when duplicate_object then null; end $$;

create table if not exists ai_suggestions (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  visit_id        uuid references visits(id) on delete set null,   -- null for cohort asks
  patient_id      uuid references patients(id) on delete set null,
  requested_by_id uuid references staff(id) on delete set null,
  feature         ai_feature not null,
  model           text not null,                  -- e.g. 'gemini-2.5-flash'
  -- The exact (redacted) context and the raw model output, for audit + evals.
  context_json    jsonb,                          -- redacted context bundle sent to the model
  request_text    text,                           -- for ask_*: the clinician's question
  response_json   jsonb,                          -- validated structured suggestions
  raw_response    text,                           -- unparsed model text (debug)
  safety_flags    jsonb not null default '[]'::jsonb,
  decision        ai_decision not null default 'shown',
  accepted_json   jsonb,                          -- what the doctor actually accepted/edited
  prompt_tokens   integer,
  output_tokens   integer,
  latency_ms      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Defense-in-depth caps (mirrors schema section 11): generous, but the DB
  -- itself refuses runaway payloads even if the app layer is bypassed.
  constraint chk_ai_suggestions_context_len  check (context_json  is null or length(context_json::text)  <= 200000),
  constraint chk_ai_suggestions_response_len check (response_json is null or length(response_json::text) <= 200000),
  constraint chk_ai_suggestions_raw_len      check (raw_response  is null or char_length(raw_response)   <= 200000),
  constraint chk_ai_suggestions_request_len  check (request_text  is null or char_length(request_text)   <= 4000)
);

create index if not exists idx_ai_suggestions_visit            on ai_suggestions(visit_id);
create index if not exists idx_ai_suggestions_hospital_feature on ai_suggestions(hospital_id, feature);

drop trigger if exists trg_ai_suggestions_updated_at on ai_suggestions;
create trigger trg_ai_suggestions_updated_at before update on ai_suggestions
  for each row execute function set_updated_at();

-- Suspension blocks new AI logging just like every other tenant write.
-- Guarded: the hosted DB predates the Stage 6 subscription gate (the
-- function exists in schema.sql but was never applied hosted — known
-- drift). Skip with a notice there; fresh DBs from schema.sql get the
-- unguarded version.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'enforce_active_subscription') then
    drop trigger if exists trg_ai_suggestions_subscription on ai_suggestions;
    create trigger trg_ai_suggestions_subscription
      before insert or update or delete on ai_suggestions
      for each row execute function enforce_active_subscription();
  else
    raise notice 'enforce_active_subscription() absent — skipping subscription gate trigger (hosted drift)';
  end if;
end $$;

-- Compliance: suggestion rows and decision updates land in audit_log too.
drop trigger if exists trg_ai_suggestions_audit on ai_suggestions;
create trigger trg_ai_suggestions_audit
  after insert or update or delete on ai_suggestions
  for each row execute function audit_trigger();

alter table ai_suggestions enable row level security;

-- Same tenancy pattern as every other clinical table: staff read their own
-- hospital's rows; clinicians insert/update (decision recording); nobody
-- deletes from the client — this is an append-mostly compliance record.
drop policy if exists "read for staff" on ai_suggestions;
create policy "read for staff" on ai_suggestions
  for select to authenticated
  using ((select is_staff()) and hospital_id = (select current_hospital_id()));

drop policy if exists "clinician insert ai suggestions" on ai_suggestions;
create policy "clinician insert ai suggestions" on ai_suggestions
  for insert to authenticated
  with check ((select current_staff_role()) in ('nurse','doctor','admin')
              and hospital_id = (select current_hospital_id()));

drop policy if exists "clinician update ai suggestions" on ai_suggestions;
create policy "clinician update ai suggestions" on ai_suggestions
  for update to authenticated
  using ((select current_staff_role()) in ('nurse','doctor','admin')
         and hospital_id = (select current_hospital_id()))
  with check ((select current_staff_role()) in ('nurse','doctor','admin')
              and hospital_id = (select current_hospital_id()));
