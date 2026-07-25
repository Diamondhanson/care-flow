# CareFlow — Patient Demographics & Review of Systems

**Design document** · Author: architecture pass · Date: 2026-07-02 · Status: proposal for review (rev 2) · **Not yet implemented**

> **Rev 2.1 (2026-07-25):** file paths corrected to this repository's actual flat
> layout (`app/`, `components/`, `services/`, `types/`, `supabase/`) — earlier
> revisions cited a monorepo (`apps/web/…`, `packages/…`) that does not exist.
> Also note the storage layer has since moved to IndexedDB with a reactive
> cache and windowed sync (Stages 3–4); read `services/db/` before implementing.

> **Rev 2 change:** the Review of Systems is now modeled as a **structured question bank** — each system is a self-contained module holding every question that can be asked for it (symptoms **plus** relevant history and genetics), each answered by **selecting** a choice rather than typing, with free text only where a choice can't capture it. As the doctor selects answers, the system **compiles a patient report**. See Sections 4.4, 4.5, 8 and the new Section 9.

---

## 1. Purpose & scope

Add two clinical-intake structures that CareFlow is currently missing, in a way that is **complaint-driven** (surfaced by what the patient presents with) rather than a wall of static forms:

1. **Patient Demographic & Background Information** — the durable, patient-level context that shapes diagnostic risk: occupation, marital status, emergency contact, and full clinical history (past medical, past surgical, family/genetic, social, obstetric/gynae, medications, immunizations).
2. **Review of Systems (ROS)** — a structured, system-by-system **question bank**, captured per encounter. The presenting complaint auto-opens the relevant systems and their questions; the doctor answers by tapping choices, can add any other system at will, and drills down only as far as the case needs. The selected answers auto-compile into the patient's report.

The goal is to give the doctor enough structured signal to guide investigations and diagnosis, while making data entry **fast (select, don't type), optional, and progressive**. Nothing forces the doctor through questions the complaint doesn't warrant.

This document covers the design at the **data layer** (`schema.sql`, shared types, mock + Supabase data services) and the **UI/UX layer** (the doctor's clinical drawer). It is a proposal — Section 12 lists the decisions still open.

---

## 2. Current-state audit

A deep read of the codebase shows CareFlow is already **more than half-built** for this. The key findings:

### What exists

| Concern | Where | State |
|---|---|---|
| Basic demographics | `patients` (`schema.sql:421`) | name, DOB (or age-approximated DOB from intake), sex, phone, address, national_id, mother's name |
| Allergies | `allergies` table (`schema.sql:453`) | **Fully modeled, patient-level, persists across visits** — the ideal pattern to copy |
| Presenting complaint | `visits.chief_complaint`, `triage_notes`, `triage_level` (`schema.sql:479`) | Captured at intake |
| Consultation note | `consultations` (`schema.sql:492`) | Free-text SOAP: `subjective / examination / assessment / plan` |
| **Symptom vocabulary by body system** | `data/clinical-terms/subjective.json` | **301 symptom terms, each tagged with a `system`, bilingual EN/FR with lay-term synonyms, across 12 systems** |
| Clinical-term autocomplete | `components/clinical-terms/term-autocomplete.tsx`, `TermChips` in the drawer | Feeds free text into SOAP fields; already renders `term.system` as a secondary line |
| Doctor's workspace | `components/live-board/patient-drawer.tsx` | Role-aware collapsible sections; doctor's SOAP + diagnosis + orders live in the `doctor` section |

The 12 systems already seeded in `subjective.json`: **Cardiac, Respiratory, GI, GU, Neuro, ENT, Eyes, Skin, Musculoskeletal, Psych, Obstetric/Gynae, General.**

> **The single most important finding:** that tagged symptom vocabulary is the **seed of the ROS question bank.** Each `subjective` term (e.g. "Chest pain", tagged `Cardiac`) becomes a boolean question ("Chest pain?") in the Cardiac module. We are not inventing the bank from nothing — we are promoting an existing, bilingual, system-tagged vocabulary into structured questions and layering follow-up + history + genetics questions on top.

### What's missing

- **Demographics:** no occupation, marital status, or emergency contact.
- **Clinical background:** no past medical / past surgical / family / social / obstetric / medication / immunization history anywhere. Allergies are the only patient-level clinical record.
- **Structured ROS:** none. `subjective` is free text — nowhere to record **pertinent negatives** ("denies chest pain") or **qualified answers** (character, radiation, duration) as data.
- **A question bank:** no catalog of ROS questions, answer types, or options.
- **Complaint → system routing:** the `system` tag exists but is unused for driving what to review.
- **Auto-report:** nothing compiles structured answers into a readable summary.

### Architectural constraint

The app currently runs on `mockStorage` (`services/mockStorage.ts`, ~4,100 lines) with a **parallel** Supabase schema (`supabase/schema.sql`). Each data-model change touches four coordinated places:

1. `supabase/schema.sql` — Postgres DDL, enums, indexes, triggers, RLS.
2. `types/healthcare.ts` — TypeScript interfaces.
3. `services/mockStorage.ts` — the in-memory/localStorage implementation the UI reads today.
4. `services/supabaseData.ts` — the Supabase-backed implementation.

The new tables follow the **exact patterns already used for `allergies`** (patient-level) and `consultations`/`diagnoses` (visit-level), and the **question bank follows the existing `clinical_terms` seed-file pattern** — so almost nothing here is a new mechanism.

---

## 3. Design principles

1. **Select first, type only when necessary.** Every question that *can* be answered by a tap (yes/no, character, severity, duration, associated symptoms) is a selectable control. Free text is reserved for genuine "other, specify" cases.
2. **A system contains everything.** Each system module holds its *complete* question set — symptoms, their follow-ups, and the pertinent history/genetics for that system — so opening a system gives the doctor the whole relevant checklist in one place.
3. **Complaint-driven, doctor-overridable.** The chief complaint auto-opens the relevant system(s) and highlights their high-yield questions. The doctor can add **any** system, and skip anything. Empty is a valid state.
4. **Reuse the vocabulary and the file pattern.** The question bank is seeded from the existing `clinical_terms` `subjective` catalog and stored as bilingual JSON seed files, exactly like `clinical_terms` already is.
5. **Right home for each fact.** Background = **patient-level** (persists, pre-fills on return). ROS answers = **visit-level** (a snapshot of *this* encounter).
6. **Structured *and* readable.** Answers are stored as queryable rows **and** compiled live into a narrative report the doctor can read and that flows into the existing consultation note / printouts.
7. **Capture the negative.** "No / denies" is a first-class answer — pertinent negatives narrow a differential as much as positives.
8. **Match existing conventions exactly.** Same enum idiom, `hospital_id` tenancy, `updated_at`/`version`/audit triggers, RLS loops, bilingual i18n, theme tokens, `TermChips` interaction language.

---

## 4. Data model

There are three moving parts: (a) the **question bank** (reference data, seed files), (b) the **answers** the doctor records (visit-level table), and (c) the **background/demographics** (patient-level table + columns).

### 4.1 New enums

Following the established idempotent idiom (`schema.sql:112`):

```sql
-- Body system — the ROS axis. Mirrors the `system` values already used in the
-- clinical-term library, so a subjective term routes straight to its module.
do $$ begin
  create type body_system as enum (
    'general', 'cardiac', 'respiratory', 'gi', 'gu', 'neuro',
    'ent', 'eyes', 'skin', 'musculoskeletal', 'psych', 'obstetric_gynae'
  );
exception when duplicate_object then null; end $$;

-- How a question is answered. Drives which selectable control the UI renders
-- and how the answer value is stored/printed.
--   boolean       → Yes / No / (Unasked)         e.g. "Chest pain?"
--   single_select → one option                    e.g. character: crushing/sharp/dull
--   multi_select  → several options               e.g. associated: nausea, sweating
--   scale         → ordinal option                e.g. severity: none/mild/mod/severe
--   duration      → number + unit picker          e.g. "3 days"  (selected, not typed)
--   numeric       → number (+ optional unit)       e.g. gravida/para
--   date          → date picker                    e.g. LMP
--   text          → free text (last resort)        e.g. "other, specify"
do $$ begin
  create type ros_answer_type as enum (
    'boolean', 'single_select', 'multi_select', 'scale',
    'duration', 'numeric', 'date', 'text'
  );
exception when duplicate_object then null; end $$;

-- The kind of a bank question — lets one system module carry symptoms AND the
-- pertinent history/genetics for that system, visually grouped but co-located.
do $$ begin
  create type ros_question_kind as enum ('symptom', 'history', 'genetic');
exception when duplicate_object then null; end $$;

-- Background/history record type (patient-level table, one shared list).
do $$ begin
  create type patient_history_type as enum (
    'past_medical', 'past_surgical', 'family', 'social',
    'obstetric_gynae', 'medication', 'immunization'
  );
exception when duplicate_object then null; end $$;

-- Marital status — a demographic context signal.
do $$ begin
  create type marital_status as enum (
    'single', 'married', 'partnered', 'divorced', 'widowed', 'unknown'
  );
exception when duplicate_object then null; end $$;
```

### 4.2 The question bank — seed files (reference data, **no table in v1**)

The bank is **reference data**, not tenant data, so it lives as versioned bilingual JSON exactly like `clinical_terms` — one file per system in `data/ros/<system>.json`, loaded into memory by a loader mirroring `lib/clinical-terms/index.ts`. This means questions can be added/edited by editing a file and shipping, with **no migration** — the same workflow the team already uses for the term library.

**Shape of one question** (a small, self-describing questionnaire node):

```jsonc
{
  "key": "cardiac.chest_pain",           // stable id, snapshotted onto answers
  "system": "cardiac",
  "kind": "symptom",                      // symptom | history | genetic
  "prompt_en": "Chest pain?",
  "prompt_fr": "Douleur thoracique ?",
  "type": "boolean",
  "key_question": true,                   // high-yield → shown first / in quick review
  "sex": null,                            // gate: 'female' for obstetric, else null
  "report_phrase_en": "chest pain",       // used to compile the narrative (Section 9)
  "options": [],                          // for *_select / scale types (bilingual)
  "followups": [                          // asked only when the parent answer matches
    {
      "key": "cardiac.chest_pain.character",
      "prompt_en": "Character",
      "type": "single_select",
      "show_if": "yes",                   // reveal when parent = Yes
      "options": [
        { "value": "crushing", "label_en": "Crushing", "label_fr": "Écrasante" },
        { "value": "sharp",    "label_en": "Sharp",    "label_fr": "Aiguë" },
        { "value": "dull",     "label_en": "Dull",     "label_fr": "Sourde" },
        { "value": "burning",  "label_en": "Burning",  "label_fr": "Brûlante" }
      ]
    },
    {
      "key": "cardiac.chest_pain.radiation",
      "prompt_en": "Radiation",
      "type": "multi_select",
      "show_if": "yes",
      "options": [
        { "value": "left_arm", "label_en": "Left arm", "label_fr": "Bras gauche" },
        { "value": "jaw",      "label_en": "Jaw",      "label_fr": "Mâchoire" },
        { "value": "back",     "label_en": "Back",     "label_fr": "Dos" }
      ]
    },
    { "key": "cardiac.chest_pain.duration", "prompt_en": "Duration",
      "type": "duration", "show_if": "yes" }
  ]
}
```

And the same file carries the system's **history/genetics** questions, so the module is complete:

```jsonc
{ "key": "cardiac.fhx_early_cad", "system": "cardiac", "kind": "genetic",
  "prompt_en": "Family history of heart disease or early cardiac death?",
  "prompt_fr": "Antécédents familiaux de maladie cardiaque ou de mort subite précoce ?",
  "type": "boolean", "key_question": true,
  "report_phrase_en": "family history of premature coronary disease" }
```

**Seeding cost:** the 301 system-tagged `subjective` terms convert 1:1 into boolean symptom questions automatically (a one-time script). Follow-ups, history, and genetics questions are authored per system on top — a bounded, clinician-reviewable content task, and the single most valuable piece of work in the whole feature. It is *content*, not code, and can grow over time without schema change.

> A per-hospital override table (`ros_questions`) is intentionally **deferred** — see Section 12. v1 ships one curated bank for everyone; the seed-file design makes promoting to a DB-backed, customizable bank a later, additive step.

### 4.3 `patient_history` — clinical background (patient-level)

Modeled on `allergies`: keyed to the **patient**, persists across encounters, pre-fills next visit. One table carries all seven history types (the "single shared list distinguished by kind" approach already used for `care_plan_items.kind`).

```sql
create table if not exists patient_history (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  type         patient_history_type not null,
  description  text not null,          -- "Type 2 diabetes", "Appendectomy 2015",
                                        -- "Mother — breast cancer", "Smokes 10/day"
  detail       jsonb,                  -- type-specific structured fields (below)
  onset        text,                   -- coarse timing: "2015", "childhood", "since 2020"
  is_active    boolean,                -- past_medical: still active? null = n/a
  noted_by_id  uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

`detail` carries the few structured fields each type wants without a table per type — social → `{tobacco_pack_years, alcohol, drugs}`, obstetric → `{gravida, para, lmp}`, family → `{relation, condition}`. Documented in one `HISTORY_DETAIL_SHAPES` constant and validated by the existing `zod` layer.

> **Where genetics lives:** family/genetic risk is captured in **two complementary places** — durable family history in `patient_history` (`type = 'family'`, persists across visits), and encounter-specific genetic *questions* answered inside the relevant ROS module (`ros_question_kind = 'genetic'`, e.g. the cardiac module asks about family heart disease). The ROS genetic question can be pre-answered from existing `patient_history` so the doctor confirms rather than re-enters.

### 4.4 `ros_responses` — the answered questions (visit-level)

One row per **answered question** for an encounter. Because answer *types* vary, the value is stored as `jsonb` with a denormalized human-readable `answer_label` and `question_text` snapshot (same denormalization principle as `diagnoses.description` beside `icd10_code`) — so the report prints cleanly and catalog edits never rewrite history.

```sql
create table if not exists ros_responses (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  visit_id        uuid not null references visits(id) on delete cascade,
  consultation_id uuid references consultations(id) on delete set null,
  system          body_system not null,
  -- Stable key from the bank (e.g. "cardiac.chest_pain.character").
  question_key    text not null,
  kind            ros_question_kind not null default 'symptom',
  -- Snapshot of the prompt at answer time (history-safe, printable).
  question_text   text not null,
  answer_type     ros_answer_type not null,
  -- The raw answer, shape by type:
  --   boolean       → true | false
  --   single_select → "crushing"
  --   multi_select  → ["nausea","sweating"]
  --   scale         → "moderate"
  --   duration      → { "value": 3, "unit": "days" }
  --   numeric       → { "value": 2, "unit": "pregnancies" }
  --   date          → "2026-06-14"
  --   text          → "…"
  answer_value    jsonb not null,
  -- Denormalized, localized human-readable answer for the report/printout,
  -- e.g. "Yes", "Crushing", "Nausea, sweating", "3 days".
  answer_label    text not null,
  note            text,               -- optional free qualifier
  recorded_by_id  uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One answer per (visit, question): re-answering updates in place.
  unique (visit_id, question_key)
);
```

### 4.5 Complaint → system & question routing

No table needed. Two lightweight, code-level maps in `lib/ros`:

1. **Complaint → systems.** The chosen chief-complaint / subjective term already carries a `system`; that system auto-opens. A curated constant adds **secondary** systems worth reviewing for a differential (e.g. chest pain → cardiac **+ respiratory + GI**). Start with primary-only (free from existing data); add the curated map as a refinement.
2. **Within an open system,** `key_question: true` items surface first and are visually highlighted; the rest sit under "more questions". A question may optionally list `triggers` (complaint keys) that promote it for specific complaints.

### 4.6 Indexes, triggers & RLS registration

Both tables slot into the existing loops — add their names to each array; no new mechanisms.

```sql
create index if not exists idx_patient_history_patient  on patient_history(patient_id);
create index if not exists idx_patient_history_type     on patient_history(type);
create index if not exists idx_patient_history_hospital on patient_history(hospital_id);
create index if not exists idx_ros_responses_visit      on ros_responses(visit_id);
create index if not exists idx_ros_responses_system     on ros_responses(system);
create index if not exists idx_ros_responses_hospital   on ros_responses(hospital_id);
```

Add `'patient_history'` and `'ros_responses'` to: **6a** updated_at loop (`:837`), **6a-bis** version loop (`:858`), **6b** audit loop (`:877`), **RLS enable** loop (`:1060`), **9a** universal read loop (`:1093`). Write policies mirror `clinical write allergies` (`:1200`):

```sql
drop policy if exists "clinical write patient history" on patient_history;
create policy "clinical write patient history" on patient_history
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

drop policy if exists "doctor write ros" on ros_responses;
create policy "doctor write ros" on ros_responses
  for all to authenticated
  using (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id());
```

---

## 5. Shared type changes (`types/healthcare.ts`)

New unions + interfaces for both the **bank** (reference shape) and the **answers/history** (persisted shapes).

```ts
export type PatientHistoryId = string;
export type RosResponseId = string;

export type BodySystem =
  | "general" | "cardiac" | "respiratory" | "gi" | "gu" | "neuro"
  | "ent" | "eyes" | "skin" | "musculoskeletal" | "psych" | "obstetric_gynae";

export type RosAnswerType =
  | "boolean" | "single_select" | "multi_select" | "scale"
  | "duration" | "numeric" | "date" | "text";

export type RosQuestionKind = "symptom" | "history" | "genetic";

export type PatientHistoryType =
  | "past_medical" | "past_surgical" | "family" | "social"
  | "obstetric_gynae" | "medication" | "immunization";

export type MaritalStatus =
  | "single" | "married" | "partnered" | "divorced" | "widowed" | "unknown";

// ---- Question bank (reference data, from data/ros/<system>.json) ----
export interface RosOption { value: string; label_en: string; label_fr: string; }

export interface RosQuestion {
  key: string;
  system: BodySystem;
  kind: RosQuestionKind;
  prompt_en: string;
  prompt_fr: string;
  type: RosAnswerType;
  key_question?: boolean;
  sex?: Sex | null;
  report_phrase_en?: string;
  report_phrase_fr?: string;
  options?: RosOption[];
  triggers?: string[];
  followups?: RosQuestion[];   // one level; each with an optional `show_if`
  show_if?: string;
}

// ---- Persisted answer ----
export type RosAnswerValue =
  | boolean | string | string[]
  | { value: number; unit?: string };

export interface RosResponse {
  id: RosResponseId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  consultation_id: ConsultationId | null;
  system: BodySystem;
  question_key: string;
  kind: RosQuestionKind;
  question_text: string;
  answer_type: RosAnswerType;
  answer_value: RosAnswerValue;
  answer_label: string;
  note: string | null;
  recorded_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  version?: number;
}

// ---- Background (patient-level) ----
export interface PatientHistory {
  id: PatientHistoryId;
  hospital_id: HospitalId;
  patient_id: PatientId;
  type: PatientHistoryType;
  description: string;
  detail: Record<string, unknown> | null;
  onset: string | null;
  is_active: boolean | null;
  noted_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  version?: number;
}

// Added to Patient: occupation, marital_status, emergency_contact_name/phone
```

The `clinical_terms` `system` string (`"Cardiac"`, `"Obstetric/Gynae"`, …) maps to `BodySystem` via a small normalizer in `lib/ros` (lowercase, `/`→`_`).

---

## 6. Data-layer wiring

### Question-bank loader (`lib/ros`)
A loader mirroring `lib/clinical-terms/index.ts`: read `data/ros/*.json`, stamp `system` from filename, flatten follow-ups, expose `getSystemModule(system)`, `getQuestion(key)`, `systemsForComplaint(term)`. Pure reference data — no storage.

### `mockStorage.ts` (what the UI reads today)
Mirror the allergies/consultations plumbing:
- Add `patient_history: PatientHistory[]` and `ros_responses: RosResponse[]` to the `db` shape, the collection-key lists (`~:254`/`:307`), and the hydration guard (default `[]`, per `:232`).
- Readers: `getHistoryForPatient(patientId)`, `getRosResponsesForVisit(visitId)` — copy `getAllergiesForPatient` (`:1141`) / `getConsultationsForVisit` (`:1194`).
- Mutations: `upsertRosResponse` / `clearRosResponse` (unique on visit+question_key → update in place) and `addPatientHistory` / `updatePatientHistory` / `deletePatientHistory` — copy `addConsultation` (`:2383`) incl. `emitUsage`.
- Input types beside existing `Add*Input` (`:757`, `:809`).

### `supabaseData.ts`
Equivalent tenant-scoped reads/writes for both tables.

### Intake (`app/(app)/intake/page.tsx`)
Add demographic fields (occupation, marital status, emergency contact) and an optional background step. Keep intake fast; the doctor completes the rest in consult.

---

## 7. Reporting & diagnostic payoff

Because answers are structured, they immediately feed the reports layer (`app/(app)/reports`) and, more importantly, the doctor's live reasoning (Section 9). Structured ROS + diagnosis pairs also become a training signal for a later complaint→likely-test suggestion, with no schema change.

---

## 8. UI / UX design

All changes live in the doctor's clinical drawer (`components/live-board/patient-drawer.tsx`), beside the SOAP entry, using existing theme tokens and interaction language. Light + dark, per `AGENTS.md`.

### 8.1 Background panel (demographics + history)
A compact, collapsible **"Background"** block in the patient header:
- **At-a-glance strip:** age · sex · occupation · marital status (mono for metrics).
- **History grouped by type** (Past medical, Surgical, Family, Social, Obstetric/Gynae, Medications, Immunizations). Each item one tap to edit; `+ add` uses autocomplete where a vocabulary helps. Social/obstetric use light structured selectors written to `detail`.
- **Pre-filled and persistent** on return visits — review-and-update, not re-enter.

### 8.2 The Review of Systems block — a bank of selectable questions

Sits under the SOAP `subjective` field. Each **system is a module** (a collapsible card) holding its full question set. Answering is tapping — never typing unless a question is genuinely free-text.

```
┌ Review of Systems ─────────────────────────── compiled report ▸ ┐
│ Chief complaint: Chest pain        auto-opened: Cardiac, Resp.   │
│                                                                  │
│  ▾ CARDIAC                                        3 answered      │
│    Chest pain?          [ Yes ]  No   ·unasked                    │
│      └ Character        Crushing  Sharp  Dull  Burning           │
│      └ Radiates to      [Left arm] [Jaw]  Back      (multi)       │
│      └ Duration         [ 2 ][ hours ▾ ]                          │
│    Palpitations?         Yes  [ No ]                              │
│    Dyspnoea on exertion? Yes  [ No ]                              │
│    Syncope?              Yes   No   ·unasked                      │
│    ▸ more cardiac questions (6)                                   │
│    ── family / genetics ──                                       │
│    FHx early heart disease?  [ Yes ]  No   └ Relation: Father    │
│    [ mark remaining as No ]                                       │
│                                                                  │
│  ▾ RESPIRATORY (suggested)                        0 answered      │
│    Cough?   Yes  No     Shortness of breath?  Yes  No   …        │
│                                                                  │
│  ▸ Review other systems            [ + Add system ▾ ]            │
└──────────────────────────────────────────────────────────────────┘
```

**Answer controls (all tap-first):**

| Answer type | Control | Typing? |
|---|---|---|
| `boolean` | Yes / No segmented toggle (third state = unasked) | none |
| `single_select` / `scale` | option chips / segmented control | none |
| `multi_select` | multi-toggle chips | none |
| `duration` | number stepper + unit dropdown | tap/step only |
| `numeric` | stepper (+ unit) | minimal |
| `date` | date picker | none |
| `text` | inline text field — **only** where no option set fits | yes (by design) |

**Behaviours:**
- **Complaint-driven open:** the complaint's primary system auto-expands with `key_question`s visible; secondary systems show folded as "(suggested)"; all others behind "Review other systems".
- **Progressive depth:** follow-ups (`Character`, `Radiation`, `Duration`) appear **only** when the parent is answered Yes (`show_if`), so a "No" costs one tap and reveals nothing.
- **Add any system:** `+ Add system` lists all 12; picking one opens its full module. Nothing is locked.
- **"Mark remaining as No":** one tap sets the system's untouched key questions to No — how a negative review is actually charted, without dozens of taps.
- **Optional note** per answer for a qualifier the options don't cover.
- **Never forced:** an untouched ROS collapses to a one-line summary.

### 8.3 i18n
Every label bilingual (`i18n/fr.ts`). System names, symptom prompts, and options carry `_fr`; the seeded symptom prompts reuse `term_fr` from `clinical_terms` for free.

---

## 9. Auto-compiled patient report (the payoff)

As the doctor selects answers, the block **compiles a readable ROS narrative live**, per system, from the structured rows — this is the "gives the doctor more info to work with" piece.

- **Live summary** (the "compiled report ▸" drawer at the top of the block), regenerated on each answer, grouped by system, e.g.:
  > **Cardiac:** Reports crushing chest pain radiating to the left arm, 2 hours' duration, with associated sweating. Denies palpitations and exertional dyspnoea. **Family history of premature coronary disease (father).**
  > **Respiratory:** Denies cough and shortness of breath.

  Built by a pure `compileRosNarrative(responses, locale)` function using each question's `report_phrase` and `answer_label`, grouping positives, negatives, and history/genetics per system. No storage — derived from the rows.

- **On "Save consultation":** the structured `ros_responses` rows are written, **and** the compiled narrative is folded into the encounter so it shows up everywhere consultations already appear (board, printouts, reports). Two options — see Section 12 decision 1:
  - append the narrative into `consultations.subjective` (zero schema change), or
  - add a dedicated `consultations.ros_summary text` column (cleaner separation).

- **Pertinent negatives surface explicitly** in the narrative, which is exactly what sharpens a differential and guides which tests to order — closing the loop your nurse friend described.

---

## 10. Migration & rollout

Additive throughout — no destructive change, no backfill (existing patients simply have empty background/ROS until touched). Each phase independently shippable and reversible.

**Phase A — Data foundation.** Enums, `patients` columns, `patient_history` + `ros_responses` tables, register in all trigger/RLS loops. Apply `schema.sql`. Add shared types.

**Phase B — Question bank + loader.** Convert the 301 subjective terms into boolean questions (script); author follow-ups + history + genetics per system as reviewed content; build the `lib/ros` loader. *This is the content-heavy phase and the clinical core — worth doing carefully.*

**Phase C — Mock service parity.** Wire `mockStorage.ts` readers/mutations + input types + hydration guards; unit tests mirroring `mockStorage.test.ts`.

**Phase D — Background UI.** Demographic fields in intake + Background panel in the drawer. Ships value on its own.

**Phase E — ROS UI + auto-report.** The question-bank block with selectable controls, complaint→system routing, follow-up reveal, "mark remaining as No", `+ Add system`, and the live `compileRosNarrative`. Save writes rows + folds narrative into the consultation.

**Phase F — Supabase parity + refinements.** `supabaseData.ts` writes; curated secondary-system routing map; optional reporting surfaces.

---

## 11. Risks & mitigations

- **Doctor friction / over-charting.** Mitigated by select-first controls, complaint-driven folding, follow-ups that only appear on Yes, and "mark remaining as No". If it isn't faster than free text, it won't be used — this is the primary UX test.
- **Question-bank quality.** The bank *is* the feature; a weak bank makes weak reports. Author per-system with clinician review; the seed-file design lets it improve continuously without migrations.
- **Answer-shape sprawl in `answer_value` jsonb.** Constrained by `answer_type` + a `zod` validator per type in `lib/validation`; `answer_label` is always the printable source of truth.
- **Vocabulary/question drift.** `question_text` and `answer_label` are snapshotted onto each response (like `diagnoses.description`), so bank edits never rewrite past encounters.
- **localStorage migration.** New collections default to `[]` in the hydration guard (established pattern, `mockStorage.ts:232`).

---

## 12. Open decisions

1. **Where the compiled narrative is persisted** — append into `consultations.subjective` (zero schema change) vs a dedicated `consultations.ros_summary` column (cleaner). *(Recommendation: dedicated `ros_summary`.)*
2. **Bank customization** — ship one curated bank now (seed files), or build the per-hospital `ros_questions` override table in v1? *(Recommendation: seed files now; DB-backed override later, additive.)*
3. **Follow-up depth** — one level of follow-ups (parent → follow-up) in v1, or arbitrary nesting? *(Recommendation: one level; covers the vast majority and keeps the UI simple.)*
4. **Secondary-system routing** — primary-system auto-open only (free from existing data) in Phase E, curated complaint→multi-system map in Phase F. *(Recommendation as stated.)*
5. **Obstetric/Gynae gating** — surface by `sex = 'female'` by default (still addable), or always shown? *(Current assumption: gated by default via each question's `sex` field, always addable.)*
6. **Who captures background** — nurse at intake, doctor in consult, or both? *(Current assumption: both may write; all fields optional.)*

---

*Grounded in: `supabase/schema.sql`, `types/healthcare.ts`, `services/mockStorage.ts`, `components/live-board/patient-drawer.tsx`, `data/clinical-terms/subjective.json`, `lib/clinical-terms/index.ts`, `app/(app)/intake/page.tsx`.*
