# CareFlow — AI Clinical Assist: Build Spec

**Audience:** Claude Code (implementation agent) working inside the `care-flow` monorepo.
**Goal:** Add an AI *decision‑support* layer to CareFlow with three features — **Moment 1** (suggest assessment + plan + tests after the subjective/ROS), **Moment 2** (suggest diagnosis + medications + admit/discharge after results), and **Ask CareFlow** (a read‑only research assistant over one patient or a cohort). Wire everything end‑to‑end so it runs against a free Google Gemini key for testing.

> **The one rule that governs everything:** the AI never writes to the medical record. It produces **drafts** the doctor accepts, edits, or dismisses. What gets saved is always the doctor's approved value, written through the app's existing, validated write paths. The doctor is in charge of every step; the AI is a suggestive guide.

> **Rev 2 (2026‑08, after code audit):** sessions are localStorage‑only → route handlers use **bearer‑token auth**; the app is offline‑first → the **context bundle is assembled on‑device** (freshest data) and the server validates/redacts it; clinical writes go through **client‑side services + the outbox** (no server actions exist); cohort questions use **structured filters only** (no raw SQL); AI features are **online‑only** with graceful offline states; plus a performance plan (§13).

---

## 0. Repo context (already true — do not rebuild)

- Monorepo: `pnpm` + `turbo`. Web app at `apps/web` (Next.js App Router, React, Tailwind v4, shadcn).
- DB: Postgres via Supabase. Schema in `packages/db/schema.sql`; migrations in `packages/db/migrations/` (naming like `2026-07-<topic>.sql`). **Row‑Level Security is on every table, scoped by `hospital_id`.**
- Shared types + validation: `packages/shared` (`types/healthcare.ts`, `validation/schemas.ts` using **zod**). Enum parity is enforced by `packages/shared/types/enum-parity.test.ts`.
- i18n: `apps/web/i18n/en.ts` and `fr.ts`. **Key parity is enforced by `i18n/parity.test.ts` — every key added to one must be added to the other.**
- Existing clinical tables the AI reads: `patients`, `patient_history`, `allergies`, `visits`, `consultations` (`subjective`, `examination`, `assessment`, `plan`, `ros_summary`), `ros_responses`, `treatment_records` (vitals), `orders`, `results`, `diagnoses`, `prescriptions`, `medication_administrations`, `admissions` (with `is_medical_cleared` / `is_financial_cleared` / `is_pharmacy_ready`), `clinical_terms`.
- Existing write UIs to reuse (find their server actions / service functions — **reuse, do not duplicate**): diagnostics (`app/(app)/diagnostics`), medications (`app/(app)/medications`), care‑plans, the patient drawer (`components/live-board/patient-drawer.tsx`), intake, reports.
- Infra already present: `audit_log`, `usage_events`, Supabase Edge Functions (see `supabase/functions/send-push`), server actions in `app/actions`.
- Brand (added recently): CSS tokens `--cf-accent` `#17c7d6`, `--cf-accent-bright` `#3ddbe8`, `--cf-accent-deep` `#0fb0c0` (Tailwind: `text-cf-accent` etc.); components in `components/brand/careflow-logo.tsx` (`CareFlowMark`). Brand-guide rule: this is a *signature* accent, never a clinical-meaning color — use it sparingly for the AI header/identity, and use the `--status-*` tokens for flags/severity.

**Verified repo facts (2026‑08 code audit) — build against these, not assumptions:**
1. **Supabase sessions live in browser localStorage, not cookies** (`app/actions/auth.ts` says so explicitly). The server cannot read the session by itself, and no `lib/supabase/server.ts` or `app/api/` exists yet. Route handlers therefore authenticate with a **bearer token**: the client sends its Supabase access token in the `Authorization` header, and the handler builds a Supabase client bound to that token — so RLS still applies to every server-side query.
2. **There are no server actions for clinical writes** (`app/actions/` holds only auth/OTP). CareFlow is **offline-first**: every mutation goes through the client-side service layer into a durable outbox (`services/syncQueue.ts`) that drains to Supabase when online. The AI "Accept" buttons call those **existing client-side service functions** — never new write paths, never raw SQL.
3. The patient drawer receives (or can derive) the current `visit_id` and `patient_id`.
4. The tenancy expression used by every RLS policy is `hospital_id = (select current_hospital_id())` — reuse it verbatim for `ai_suggestions`.

---

## 1. Architecture at a glance

```
Doctor (browser, patient drawer)          AI is ONLINE-ONLY; the rest of the app stays offline-first
      │  device offline → AI buttons disabled ("continue manually"); online → enabled
      │  clicks "Suggest next steps" / "Review results" / opens "Ask CareFlow"
      ▼
Client (apps/web/lib/ai/client-context.ts)
      │  1. assemble Patient Context Bundle from the ON-DEVICE store — the freshest data;
      │     the doctor's just-typed notes may still be in the outbox, unsynced
      │  2. POST bundle to /api/ai/* with the Supabase access token (Authorization: Bearer …)
      ▼
Next.js Route Handler  (apps/web/app/api/ai/*)        ← server-side GATEKEEPER, holds GEMINI_API_KEY
      │  1. verify the bearer token → RLS-bound Supabase client for this caller
      │  2. confirm the visit/patient belongs to the caller's hospital (RLS-scoped check)
      │  3. zod-validate the bundle + redact direct identifiers (lib/ai/redact.ts)
      │  4. call provider (lib/ai/provider.ts → Gemini adapter), request STRUCTURED JSON
      │  5. validate model JSON with zod (packages/shared)
      │  6. run deterministic safety checks (allergy/interaction)
      │  7. respond/stream FIRST; log to ai_suggestions + usage_events after
      ▼
Streamed structured suggestions → AI Assist panel (draft cards: Accept / Edit / Dismiss)
      │  Accept → calls the EXISTING client-side service write (validated → outbox → sync)
      ▼
audit_log records what was suggested and what the doctor did
```

Why this shape: the browser holds the freshest record (offline-first outbox), so the **client assembles the context**; the **server stays the gatekeeper** — it holds the API key, verifies tenant scope through RLS, redacts identifiers, runs safety checks, and logs. The client never talks to Gemini directly, and the AI never pretends to work offline — the model is a cloud service, so the UI says so honestly instead of erroring. Route Handlers (not Edge Functions) because they live in the same Next app, stream easily to React, and keep one deploy. (Edge Functions remain fine for background jobs like `send-push`.)

---

## 2. Non‑negotiable safety & trust rules (implement all)

1. **No silent writes.** AI output is never persisted to clinical tables directly. Only an explicit doctor "Accept" (which may include edits) triggers a write, through existing validated actions.
2. **Show the reasoning and the sources.** Every suggestion includes a short `rationale` and a `sources` list naming the data it used (e.g. `["allergies", "ros:cardiac.chest_pain", "result:FBC"]`). Render source chips.
3. **Express uncertainty.** The model must return a `confidence` (`low|moderate|high`) per suggestion and is instructed to say when data is insufficient rather than guess.
4. **Suggestive language only.** UI copy and model tone: "Consider…", "You may want to…". Never "The diagnosis is…". A persistent disclaimer sits on every AI panel (i18n key `ai.disclaimer`).
5. **Deterministic allergy check.** Independently of the model, cross‑check every suggested drug against the patient's `allergies` rows and raise a hard `safetyFlag` the doctor must see before accepting.
6. **Full audit.** Write every suggestion event and every doctor decision (accepted / edited / dismissed, with the final value) to `ai_suggestions` and `audit_log`.
7. **Read‑minimal / privacy.** Send the model only the clinical data it needs. Strip direct identifiers (full name, phone, email, national ID) via `redact.ts`; refer to the patient by initials + `patient.id`. Never send data across hospitals (see §12).
8. **Feature flag.** Everything gates behind `AI_FEATURES_ENABLED`. Off by default in envs that haven't set a key.
9. **Fail safe.** If the model errors, times out, or returns invalid JSON, show "AI unavailable — continue manually." Never block the doctor's normal workflow.
10. **Online-only, offline-graceful.** AI features require an active connection (the model is remote — it can never work offline). Reuse the sync layer's connectivity signal; when offline, disable the AI buttons with a calm note (`ai.offline`) — never a broken spinner. Clinical work continues untouched offline, and buttons re-enable automatically when the connection returns.

---

## 3. Data model changes

Create migration `packages/db/migrations/2026-08-ai-suggestions.sql` **and** fold the same DDL into `packages/db/schema.sql` (keep them consistent — that's the repo convention).

```sql
-- ============================================================================
-- AI decision-support: suggestion + decision audit trail.
-- Every AI interaction is recorded here (never trusted, always logged). This is
-- both the compliance record and the future quality-evaluation dataset.
-- ============================================================================

do $$ begin
  create type ai_feature as enum ('plan', 'results', 'ask_patient', 'ask_cohort');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_decision as enum ('shown', 'accepted', 'edited', 'dismissed');
exception when duplicate_object then null; end $$;

create table if not exists ai_suggestions (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  visit_id       uuid references visits(id) on delete set null,     -- null for cohort asks
  patient_id     uuid references patients(id) on delete set null,
  requested_by_id uuid references staff(id) on delete set null,
  feature        ai_feature not null,
  model          text not null,                 -- e.g. 'gemini-2.5-flash'
  -- The exact (redacted) context and the raw model output, for audit + evals.
  context_json   jsonb,                          -- redacted context bundle sent to model
  request_text   text,                           -- for ask_* : the doctor's question
  response_json  jsonb,                          -- validated structured suggestions
  raw_response   text,                           -- unparsed model text (debug)
  safety_flags   jsonb not null default '[]'::jsonb,
  decision       ai_decision not null default 'shown',
  accepted_json  jsonb,                          -- what the doctor actually accepted/edited
  prompt_tokens  integer,
  output_tokens  integer,
  latency_ms     integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_ai_suggestions_visit on ai_suggestions(visit_id);
create index if not exists idx_ai_suggestions_hospital_feature on ai_suggestions(hospital_id, feature);

alter table ai_suggestions enable row level security;

-- RLS: same pattern as the rest of the schema — a staff member sees only their
-- hospital's rows. Copy the exact USING/ WITH CHECK expression the other
-- clinical tables use (hospital_id = the caller's hospital via the standard helper).
create policy ai_suggestions_tenant_isolation on ai_suggestions
  using (hospital_id = <STANDARD_HOSPITAL_ID_EXPR>)
  with check (hospital_id = <STANDARD_HOSPITAL_ID_EXPR>);
```

> Replace `<STANDARD_HOSPITAL_ID_EXPR>` with the exact expression the other tables use (find it in `schema.sql` — likely a `current_hospital_id()` function or a subselect on `staff`). Reuse it verbatim so isolation is identical.

**Metering:** reuse the existing `usage_events` table. Insert one row per AI call with a kind like `ai_<feature>` plus token counts, so per‑hospital AI cost is visible in reports later. Match `usage_events`' existing column shape.

---

## 4. Shared types & zod schemas

Add `packages/shared/types/ai.ts` and export from the package index. Use zod (the repo's validation lib) so route handlers can validate model output and the UI gets types for free.

```ts
import { z } from "zod";

export const Confidence = z.enum(["low", "moderate", "high"]);

// ---- Context bundle (device → server → model). Needs a zod schema too — the
// server must validate what the client sends (see §6). Assembled on-device in
// lib/ai/client-context.ts; validated/redacted server-side.
export interface PatientContext {
  patient: { id: string; initials: string; ageYears: number | null; sex: string | null };
  history: { summary: string | null; items: string[] };          // patient_history
  allergies: { substance: string; reaction: string | null; severity: string | null }[];
  visit: { id: string; type: string; stage: string; chiefComplaint: string | null };
  subjective: string | null;                                     // consultations.subjective
  examination: string | null;
  ros: { system: string; question: string; answer: string }[];   // ros_responses (labels)
  vitals: Partial<{ spo2: number; pulse: number; bpSystolic: number; bpDiastolic: number;
                    temperatureC: number; weightKg: number; gcs: number; recordedAt: string }>;
  orders: { id: string; type: string; description: string; status: string }[];
  results: { orderDescription: string; value: string | null; referenceRange: string | null;
             isAbnormal: boolean; summary: string | null }[];
  existingDiagnoses: { description: string; icd10: string | null; isPrimary: boolean }[];
  currentMedications: { drug: string; dose: string | null; frequency: string | null }[];
}

// ---- Moment 1 output: assessment + differential + plan + tests
export const PlanSuggestion = z.object({
  assessment: z.object({ text: z.string(), confidence: Confidence, rationale: z.string(),
    sources: z.array(z.string()) }),
  differential: z.array(z.object({ condition: z.string(), icd10: z.string().nullable(),
    likelihood: Confidence, rationale: z.string() })).max(6),
  plan: z.object({ text: z.string(), confidence: Confidence, rationale: z.string(),
    sources: z.array(z.string()) }),
  suggestedTests: z.array(z.object({ orderType: z.string(), description: z.string(),
    reason: z.string() })).max(8),
  insufficientData: z.boolean(),
  notes: z.string().optional(),
});
export type PlanSuggestion = z.infer<typeof PlanSuggestion>;

// ---- Moment 2 output: diagnosis + meds + disposition
export const ResultsSuggestion = z.object({
  diagnoses: z.array(z.object({ description: z.string(), icd10: z.string().nullable(),
    isPrimary: z.boolean(), confidence: Confidence, rationale: z.string(),
    sources: z.array(z.string()) })).max(6),
  medications: z.array(z.object({ drugName: z.string(), dose: z.string().nullable(),
    route: z.string().nullable(), frequency: z.string().nullable(), duration: z.string().nullable(),
    instructions: z.string().nullable(), reason: z.string(), confidence: Confidence })).max(8),
  disposition: z.object({ recommendation: z.enum(["admit", "discharge", "observe"]),
    confidence: Confidence, rationale: z.string(), suggestedWard: z.string().nullable() }),
  safetyFlags: z.array(z.object({ severity: z.enum(["info", "warning", "critical"]),
    message: z.string() })),
  insufficientData: z.boolean(),
});
export type ResultsSuggestion = z.infer<typeof ResultsSuggestion>;

// ---- Ask CareFlow output
export const AskAnswer = z.object({
  answer: z.string(),
  usedSources: z.array(z.string()),
  followUps: z.array(z.string()).max(4).optional(),
  // cohort mode only: the (already-executed, read-only) query summary + rows are attached server-side
});
export type AskAnswer = z.infer<typeof AskAnswer>;
```

---

## 5. AI provider layer (swappable, Gemini default)

Create `apps/web/lib/ai/provider.ts`. One interface, one env‑selected implementation, so the team can move Gemini → Claude/GPT/Gemini‑3 by changing env only.

```ts
// Env:
//   AI_PROVIDER=gemini              (default; future: 'anthropic' | 'openai')
//   AI_MODEL=gemini-2.5-flash       (confirm current free model name in AI Studio)
//   GEMINI_API_KEY=...              (server-only; never NEXT_PUBLIC_*)
//   AI_FEATURES_ENABLED=true

export interface AiCall {
  system: string;
  user: string;
  jsonSchema?: object;         // provider-native structured output when supported
  images?: { mimeType: string; data: string }[]; // base64, for result scans/PDFs (Moment 2)
  temperature?: number;        // default 0.2 (clinical → low)
}
export interface AiResult { text: string; promptTokens?: number; outputTokens?: number; }

export interface AiProvider {
  complete(call: AiCall): Promise<AiResult>;
  stream?(call: AiCall): AsyncIterable<string>;
}

export function getProvider(): AiProvider { /* switch on AI_PROVIDER */ }
```

**Gemini adapter** (`lib/ai/gemini.ts`): use the official `@google/generative-ai` SDK (add to `apps/web` deps) **or** a plain `fetch` to `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=...` (no dependency). Prefer the SDK. Request JSON via `responseMimeType: "application/json"` and `responseSchema` where supported; otherwise instruct JSON in the prompt and validate with zod. Set `temperature: 0.2`. Support inline image parts for Moment 2 (Gemini reads images/PDFs — used for uploaded result attachments).

**Mock provider** (`lib/ai/mock.ts`): returns canned valid JSON for each feature. Selected when `AI_PROVIDER=mock`. Used by tests and offline dev so nothing hits the network.

---

## 6. Context bundle: assembled ON-DEVICE, validated + redacted on the server

**Client side — `apps/web/lib/ai/client-context.ts`** → `buildPatientContext(visitId): PatientContext`.

- Build the bundle from the **on-device store** (the same client service layer the UI already reads from): visit + patient demographics, `patient_history`, `allergies`, latest consultation (subjective/examination), ROS answers (labels), most recent vitals, orders, results (with `is_abnormal`, `reference_range`), diagnoses, active prescriptions.
- **Why on-device:** the doctor clicks "Suggest next steps" seconds after typing the subjective/ROS — that data may still be sitting in the outbox, unsynced. The device is the source of freshest truth; a server-side read could be stale.
- Compute `initials` and `ageYears` locally; **never put full name, phone, email, or national ID in the bundle.**
- Keep it compact (most recent + relevant, not every historical row). Cap arrays (e.g. last 20 ROS answers, last 10 results).
- Pre-assemble in the background when the patient drawer opens, so a click only waits on the model (§13).

**Server side — `apps/web/lib/ai/context.ts`** → `validateAndScope(supabase, bundle)`:

- zod-parse the incoming bundle (shape + caps enforced), then **verify via the bearer-token RLS client that `visit_id`/`patient_id` exist in the caller's hospital** — a caller can only get AI output for records their hospital owns. Put the cross-hospital isolation comment here (§12).

`apps/web/lib/ai/redact.ts` → `redactContext(ctx)`: server-side belt-and-braces — strip/assert absence of `full_name`, phone, email, national ID before the bundle goes to the model or into `ai_suggestions.context_json`.

`apps/web/lib/ai/attachments.ts` (Moment 2): for each `results.attachment_path` in the bundle, the server fetches the object from the `lab-results` storage bucket (signed, server-side — the path is RLS/tenant-scoped), downscales large images where feasible, base64‑encodes, and passes it as an image part **only if** it's an image/PDF under the size cap. Skip otherwise.

---

## 7. Prompt templates

Put in `apps/web/lib/ai/prompts.ts`. Keep the system prompt identical across features; vary the task block.

**System prompt (all features):**
```
You are a clinical decision-support assistant inside CareFlow, a hospital
operations system. You assist a licensed clinician who makes every final
decision. You are suggestive, never authoritative.

Rules:
- You do NOT diagnose or prescribe on your own. You propose options for the
  clinician to accept, edit, or reject.
- Use ONLY the patient data provided. Never invent findings, results, or history.
- If the data is insufficient for a safe suggestion, say so and set
  insufficientData=true. Do not guess.
- For every suggestion give a short rationale and list the data fields you used
  (the "sources").
- Give a confidence level (low/moderate/high) and prefer caution.
- Always consider the patient's allergies and current medications before
  suggesting any drug.
- Reply ONLY with JSON that matches the provided schema. No prose outside JSON.
- Use the clinician's interface language where free text is shown to them:
  respond in {{LOCALE}} ('en' or 'fr').
```

**Moment 1 task block:** "Based on the context, propose an assessment, a short ranked differential, a plan, and recommended tests. …" + serialized `PatientContext` + the `PlanSuggestion` schema.

**Moment 2 task block:** "The test results are now available (including any attached images). Propose diagnosis(es), medication options (checked against allergies and current meds), and an admit/observe/discharge recommendation tied to the clearance gates. Raise safetyFlags for any interaction or contraindication. …" + context + results + images + `ResultsSuggestion` schema.

**Ask CareFlow task block (patient mode):** "Answer the clinician's question using only this patient's record. Cite which parts you used. If asked for something not in the data, say it isn't recorded." **(cohort mode):** see §11.

---

## 8. API endpoints (Route Handlers)

All under `apps/web/app/api/ai/`. Each handler: verify the **bearer token** (`Authorization` header → RLS-bound Supabase client), check `AI_FEATURES_ENABLED` + role, zod-validate the client-supplied context, redact, call provider, validate output, run safety checks, **respond, then log** (fire-and-forget the `ai_suggestions`/`usage_events` inserts with error logging, so bookkeeping never delays the doctor). Confirm exact Route Handler conventions (file layout, runtime export, streaming) against this repo's pinned Next.js docs in `node_modules/next/dist/docs` before writing them — this Next version has breaking changes. Prefer streaming for the two suggestion endpoints (progressive render; simplest v1: full validated object, add streaming immediately after).

### `POST /api/ai/suggest/plan`  (Moment 1)
- Body: `{ visitId: string, locale: "en"|"fr", context: PatientContext }` — the bundle built on-device (§6)
- Auth: signed‑in clinician (doctor/nurse per role rules). Returns 403 otherwise.
- Response: `PlanSuggestion` + `{ suggestionId }` (the `ai_suggestions.id`, so the UI can PATCH decisions).

### `POST /api/ai/suggest/results`  (Moment 2)
- Body: `{ visitId: string, locale, context: PatientContext }` — the bundle built on-device (§6)
- Requires at least one `results` row for the visit; else 409 `{ error: "no_results_yet" }`.
- Response: `ResultsSuggestion` + `{ suggestionId }`. Merge server‑side deterministic allergy flags into `safetyFlags` before returning.

### `POST /api/ai/ask`  (Ask CareFlow)
- Body: `{ mode: "patient"|"cohort", question: string, patientId?: string, locale, context?: PatientContext }` — patient mode sends the on-device bundle; cohort mode sends no bundle (the server queries, §11)
- `patient` mode: any clinician who can see that patient. `cohort` mode: role‑gated (doctor/admin only).
- Response: `AskAnswer` (+ for cohort: `{ table: {columns, rows} }` from the safe query, and `queryPreview` — a human-readable description of the filter that ran).

### `PATCH /api/ai/suggestions/:id`  (record the decision)
- Body: `{ decision: "accepted"|"edited"|"dismissed", acceptedJson?: any }`
- Updates `ai_suggestions.decision` + `accepted_json`, writes an `audit_log` entry. Called by the UI when the doctor acts. **This endpoint does not write clinical rows** — the UI calls the existing clinical write actions separately, then reports the decision here.

---

## 9. Deterministic safety checks

`apps/web/lib/ai/safety.ts`:
- `checkAllergies(medications, allergies)` → flags any suggested drug whose name/class matches an allergy substance. Start with case‑insensitive substring + a small synonym map (e.g. "penicillin" ↔ "amoxicillin", extendable). Return `critical` flags.
- (Optional v2) `checkInteractions()` — stub now, structured so a drug‑interaction dataset/API can plug in later.
- These run on the server after the model responds and are **merged into `safetyFlags`**; the UI renders `critical` flags as a blocking banner on the medication card (doctor must acknowledge to accept).

---

## 10. Frontend — AI Assist panel (Moments 1 & 2)

New: `apps/web/components/ai/ai-assist-panel.tsx`, mounted inside `components/live-board/patient-drawer.tsx` as a collapsible section (opened by the doctor, never auto‑opened). Use brand accents: header uses `<CareFlowMark className="size-4" />` and `text-brand`/`bg-brand` for the AI accent; keep it visually calm.

**Behaviour:**
- **Online-only:** buttons disable when the device is offline, with `ai.offline` as the note/tooltip; they re-enable automatically when the connection returns (reuse the sync layer's connectivity signal).
- **Pre-assemble on open:** when the drawer opens (and AI is enabled + online), build the context bundle in the background so a click only pays for the model call.
- **Cache per visit:** keep the last suggestion; if the bundle is unchanged on re-click (hash it), re-show instantly instead of re-calling.
- **Theming:** every AI surface is built from the semantic theme tokens and must look right in light AND dark mode (repo rule, non-negotiable).
- Two buttons depending on visit state: **"Suggest next steps"** (enabled once subjective/ROS exist) and **"Review results"** (enabled once ≥1 result exists).
- On click → call the endpoint → render **draft cards**:
  - *Assessment* and *Plan*: editable `textarea` prefilled with the suggestion; **Accept** writes via the existing client-side consultation update service (outbox-queued like every other write); **Edit** just lets them change the text first; **Dismiss** discards.
  - *Differential*: read‑only list (informational; not written anywhere).
  - *Suggested tests*: each row has **Add** → calls the existing client-side create-order service (map `orderType` to their `order_type` enum; if unmapped, let the doctor pick).
  - *Diagnoses* (Moment 2): **Add** → existing client-side create-diagnosis service (map to `diagnoses`, respect `is_primary`).
  - *Medications* (Moment 2): editable dose/route/frequency/duration; **critical allergy flags render as a red blocking banner**; **Prescribe** → existing client-side create-prescription service.
  - *Disposition* (Moment 2): shows admit/observe/discharge + rationale; **Admit** deep‑links to / triggers the existing admission flow (does not auto‑admit).
- Every card shows `confidence`, `rationale`, and source chips.
- A persistent footer disclaimer (`ai.disclaimer`).
- After any Accept/Edit/Dismiss, call `PATCH /api/ai/suggestions/:id` with the decision + final value.
- Loading, empty (`insufficientData`), and error states all handled; errors never block manual work.

---

## 11. Frontend — "Ask CareFlow" (read‑only research)

- **Launcher:** add an "Ask CareFlow" button in the app‑shell top bar (`components/layout/app-shell.tsx`), using `CareFlowMark` + `text-brand`. Also add a route `apps/web/app/(app)/ask/page.tsx`.
- **Two modes** (tabs): *This patient* (requires an active patient/visit context — pass `patientId`) and *Across patients* (cohort; doctor/admin only).
- **Patient mode:** chat box → `POST /api/ai/ask {mode:"patient"}` → renders the answer + source chips + suggested follow‑ups. Read‑only.
- **Cohort mode — safe query path (important):** do **not** let the model touch the database directly, and do **not** let it write SQL. Instead:
  1. The model receives the question + a **whitelisted schema description** (table/column names it may use, all already `hospital_id`‑scoped) and returns a **structured filter object only** (table, columns, filters, order, limit; count aggregation). No SQL — supabase‑js can't execute raw SQL strings anyway, and a dynamic‑SQL RPC is an attack surface we refuse to build.
  2. The server **validates** the object against the whitelist (tables, columns, operators, hard row `LIMIT`) and builds the query with the **supabase‑js query builder** through the bearer‑token RLS client. Reject anything outside the whitelist. The column whitelist **excludes direct identifiers** (names, phone, email, national ID) because result rows are fed back to the model.
  3. RLS re‑enforces the tenant boundary even if validation missed something (defence in depth).
  4. Feed the **rows** back to the model to write a plain‑English summary, and show the table + `queryPreview` (a human‑readable description of the filter that ran) to the user.
- Everything logged to `ai_suggestions` (`feature = ask_patient | ask_cohort`).

---

## 12. Cross‑hospital data: **isolated per hospital** (decision)

Do **not** pool patient data across hospitals. All context queries and all cohort queries are `hospital_id`‑scoped and RLS‑enforced; the model gets its intelligence from its own training, not from other tenants' data. Do not fine‑tune on raw patient records. (If system‑wide learning is ever wanted, that's a separate, opt‑in, de‑identified, aggregate‑only project with regulatory sign‑off — out of scope here.) Add a code comment to this effect in `context.ts` so the boundary is explicit.

---

## 13. Performance — make it feel instant

Target: the doctor sees the first words of a suggestion within ~1–2 s; the full card set within ~3–8 s (Flash model); Moment 2 with attachments may take longer. Tactics, in priority order:

1. **Stream the answer.** Render text as it arrives instead of spinner-then-everything. Biggest perceived-speed win; same total latency.
2. **Pre-assemble context.** Build the on-device bundle in the background when the drawer opens; the click then only pays for the model call.
3. **Small in, small out.** Enforce the §6 caps; cap output via schema max-items; keep `temperature: 0.2` and instruct terse rationales (1–2 sentences).
4. **Shrink images.** Downscale/compress result attachments before base64‑ing them into the prompt — the dominant Moment 2 cost.
5. **Cache the last suggestion per visit.** If the bundle hash is unchanged, re-show the previous result instantly instead of re-calling.
6. **Log after responding.** `ai_suggestions`/`usage_events` inserts happen after the response is sent (fire-and-forget with error logging).
7. **Stay on Flash.** The fast model tier is the right speed/quality trade for structured decision-support drafts; don't move to a slower tier without measuring.

---

## 14. i18n (add to BOTH en.ts and fr.ts — parity test enforced)

Add an `ai` namespace. English values below; provide natural French for each (the repo already has professional FR).

```
ai.assist                     "AI Assist"
ai.suggestNextSteps           "Suggest next steps"
ai.reviewResults              "Review results"
ai.assessment                 "Suggested assessment"
ai.differential               "Possible conditions to consider"
ai.plan                       "Suggested plan"
ai.tests                      "Suggested tests"
ai.diagnoses                  "Suggested diagnoses"
ai.medications                "Suggested medications"
ai.disposition                "Admission recommendation"
ai.accept                     "Accept"
ai.edit                       "Edit"
ai.dismiss                    "Dismiss"
ai.add                        "Add"
ai.prescribe                  "Prescribe"
ai.why                        "Why"
ai.sources                    "Based on"
ai.confidence.low             "Low confidence"
ai.confidence.moderate        "Moderate confidence"
ai.confidence.high            "High confidence"
ai.insufficientData           "Not enough information yet to suggest this safely."
ai.allergyWarning             "Conflicts with a recorded allergy — review before prescribing."
ai.unavailable                "AI is unavailable right now — you can continue manually."
ai.offline                    "AI needs an internet connection — you can keep working manually."
ai.disclaimer                 "AI suggestions are decision support only. The clinician is responsible for all decisions."
ai.ask.title                  "Ask CareFlow"
ai.ask.patientTab             "This patient"
ai.ask.cohortTab              "Across patients"
ai.ask.placeholder            "Ask about this patient or a group of patients…"
ai.ask.readOnlyNote           "Read-only — Ask CareFlow never changes records."
```

---

## 15. Config, env, metering, flags

- Add to `apps/web/.env.local` (and document in `.env.example` if present):
  ```
  AI_FEATURES_ENABLED=true
  AI_PROVIDER=gemini
  AI_MODEL=gemini-flash-latest
  GEMINI_API_KEY=paste-key-here
  ```
- If the app validates env (e.g. a `lib/env.ts` with zod), add these there (server‑only; **never** `NEXT_PUBLIC_`).
- Metering: every AI call inserts a `usage_events` row (`kind: "ai_plan"|"ai_results"|"ai_ask"`, `model`, token counts) matching that table's columns.
- Add `AI_FEATURES_ENABLED` checks so the buttons/route don't render when off.
- **Service worker:** exclude `/api/ai/*` from PWA caching (network-only) — a cached AI response is worse than none, and caching breaks streaming.
- Route Handler specifics (file layout, runtime export, streaming API) must be checked against the pinned Next.js docs in `node_modules/next/dist/docs` — this repo's Next version has breaking changes.

---

## 16. Testing plan

- **Unit (vitest, repo standard):**
  - `client-context.test.ts` — the on-device assembler builds the expected bundle from fixture rows (caps enforced); `redact.test.ts` — server redaction strips name/phone/email/national ID.
  - `ai-schemas.test.ts` — zod accepts good model JSON, rejects malformed.
  - `safety.test.ts` — allergy check flags a penicillin‑class drug for a penicillin‑allergic patient.
  - `cohort-guard.test.ts` — the filter validator rejects un‑whitelisted tables/columns/operators, identifier columns, missing/oversized limits, and anything that isn't a plain read.
  - Use `AI_PROVIDER=mock` so no network.
- **i18n:** `parity.test.ts` must pass (all `ai.*` keys in both files).
- **Type/lint:** `pnpm -C apps/web typecheck` and `pnpm -C apps/web lint` clean; enum parity test passes.
- **Manual QA checklist (with a real Gemini key):**
  1. Open a visit with subjective + ROS → "Suggest next steps" → cards appear with rationale + sources.
  2. Edit the assessment, Accept → the consultation updates; `ai_suggestions.decision='edited'` recorded.
  3. Add a suggested test → an `orders` row appears in diagnostics.
  4. Enter a result → "Review results" → diagnosis/meds/disposition appear.
  5. Add an allergy that conflicts with a suggested drug → red blocking flag shows.
  6. Ask CareFlow (patient) → sensible summary; (cohort, as admin) → table + plain‑English summary; verify a second hospital's data never appears.
  7. Turn `AI_FEATURES_ENABLED=false` → all AI UI disappears; app works normally.
  8. Go offline (DevTools → Network → Offline) → AI buttons disable with the offline note; the rest of the app keeps working; back online → buttons re-enable.

---

## 17. Build order (do it in these phases; keep each green)

1. **Schema:** migration + `schema.sql` + RLS + `ai_suggestions`. Run migration locally. **Apply it to the hosted DB before any deploy that uses it** (Phase 21 lesson: otherwise synced writes queue-fail).
2. **Shared types:** `types/ai.ts` + zod, export from package index.
3. **Provider + mock:** `provider.ts`, `gemini.ts`, `mock.ts`, env wiring, feature flag.
4. **On-device context builder + server validation/redaction + prompts.**
5. **Endpoints:** `/suggest/plan`, `/suggest/results`, `/suggestions/:id`, then `/ask`.
6. **Safety checks** merged into results endpoint.
7. **UI Moment 1** in the patient drawer (assessment/plan/tests) end‑to‑end with real writes.
8. **UI Moment 2** (diagnosis/meds/disposition + allergy banner).
9. **Ask CareFlow** (patient mode, then cohort mode with the query guard).
10. **i18n**, **metering**, **tests**, **typecheck/lint/parity** all green.
11. Short `docs/AI-FEATURES.md` describing envs, endpoints, and the safety model.

**Definition of done:** all three features work against a real Gemini key; nothing writes to clinical tables without an explicit doctor action; every interaction is logged; tenant isolation holds; typecheck + lint + i18n parity + new unit tests pass; feature flag cleanly disables everything.

---

## 18. How to get a FREE Google Gemini API key and run the tests

Do this after the build is wired up.

**A. Get the key (2 minutes):**
1. Go to **https://aistudio.google.com** in a browser.
2. Sign in with a normal **Google account** (a personal Gmail is fine).
3. Accept the terms if prompted.
4. Click **"Get API key"** (left sidebar, or the "Get API key" button top‑right).
5. Click **"Create API key"**. If it asks for a Google Cloud project, choose **"Create a new project"** (any name) — it does this for you; no billing/credit card needed for the free tier.
6. Your key appears (a long string starting with `AIza…`). Click **Copy**. Keep it secret — treat it like a password.

**B. Put the key in the app:**
1. Open `apps/web/.env.local`.
2. Add (or fill in) these lines:
   ```
   AI_FEATURES_ENABLED=true
   AI_PROVIDER=gemini
   AI_MODEL=gemini-flash-latest
   GEMINI_API_KEY=your_copied_key_here
   ```
3. Save. (Verified 2026-08: AI Studio keys now start with `AQ.` — not the old `AIza` prefix — and `gemini-flash-latest` is the reliable free Flash alias; pinned older names like `gemini-2.5-flash` may be listed by the API yet 404 on generation for new free keys.)

**C. Run it:**
1. In the repo root: `pnpm install` (installs the Gemini SDK if it was added).
2. Start the app: `pnpm --filter web dev` (or `pnpm -C apps/web dev`).
3. Open the app, sign in, open a patient with a subjective + ROS filled in.
4. Open the **AI Assist** panel → **Suggest next steps**. You should see draft cards within a few seconds.
5. Enter a test result, then **Review results** for Moment 2.
6. Try **Ask CareFlow** from the top bar.

**D. Free‑tier notes:**
- The free tier has per‑minute and per‑day request limits — plenty for testing, but if you see a `429` / "rate limit" error, wait a minute and retry.
- The free tier may use prompts to improve Google's products. **For real patient data / production, switch to a paid tier (or a provider with a data‑privacy/no‑training guarantee) before going live.** For now (testing with demo/seed data), the free tier is fine.
- To watch usage/limits, return to AI Studio → your API key page.

**E. If something fails:**
- Cards don't load → check the browser network tab for the `/api/ai/...` call and the server logs; a `401/403` means session/role, a `429` means rate limit, invalid‑JSON means the model output didn't match the schema (the code should show `ai.unavailable`).
- Want to develop without a key → set `AI_PROVIDER=mock` to use canned suggestions.

---

## 19. Out of scope (note for later, don't build now)
- Cross‑hospital shared learning / fine‑tuning (see §12).
- Drug–drug interaction database (safety.ts leaves a stub).
- Voice capture of the subjective (could feed Moment 1 later).
- Formal regulatory/clinical validation — flag to the product owner that in many jurisdictions this kind of decision support can be a regulated medical device; get clinical + legal sign‑off before real clinical use.
