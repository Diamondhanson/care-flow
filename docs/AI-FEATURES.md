# CareFlow AI Clinical Assist (Phase 22)

Decision-support layer built per [CareFlow-AI-Build-Spec.md](./CareFlow-AI-Build-Spec.md) (Rev 2).
Three features: **Suggest next steps** (Moment 1) and **Review results**
(Moment 2) in the patient drawer's AI Assist panel, and **Ask CareFlow**
(`/ask`, launcher in the top bar).

**The one rule:** the AI never writes to the medical record. It produces
drafts; only an explicit doctor action writes — through the same client-side
services + offline outbox as manual entry, so auditing and sync behave
identically.

## How it works

- **Online-only.** The model is a cloud service; the AI buttons disable with
  a calm note when the device is offline. Everything else stays offline-first.
- **On-device context.** The browser assembles the patient bundle from the
  local store (freshest data — unsynced notes included), strips identifiers
  (initials + age only), and POSTs it to `/api/ai/*` with the Supabase access
  token as a bearer header (sessions are localStorage-only in this app).
- **Server is the gatekeeper.** The route handler rebuilds an RLS-bound
  client from the token, verifies the visit/patient belongs to the caller's
  hospital, zod-validates + redacts the bundle, calls the provider, validates
  the model's JSON, runs the deterministic allergy check, then logs.
- **Everything is logged** to `ai_suggestions` (context, raw + validated
  output, safety flags, latency, tokens) plus a `usage_events` metering row
  (`feature_used` / `ai_*`). Doctor decisions land via
  `PATCH /api/ai/suggestions/:id`. Note: logging is awaited *before* the
  response (spec §13 said log-after; serverless platforms don't guarantee
  post-response work, and the audit trail wins — it costs ~tens of ms).
- **Cohort mode never writes SQL.** The model returns a structured filter
  object; `lib/ai/cohort-guard.ts` validates it against the whitelist in
  `packages/shared/types/ai.ts` (no identifier columns) and builds the query
  with the supabase-js builder through the caller's RLS-bound client.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/ai/suggest/plan` | Moment 1: assessment + differential + plan + tests |
| `POST /api/ai/suggest/results` | Moment 2: diagnoses + medications + disposition (+ attachments, allergy flags) |
| `POST /api/ai/ask` | Ask CareFlow, `mode: "patient" \| "cohort"` |
| `PATCH /api/ai/suggestions/:id` | Record accepted / edited / dismissed |

Roles: plan/results/ask-patient → doctor, nurse, admin. Cohort → doctor, admin.

## Env (`apps/web/.env.local`)

```
AI_FEATURES_ENABLED=true              # server kill switch
NEXT_PUBLIC_AI_FEATURES_ENABLED=true  # client UI visibility (not a secret)
AI_PROVIDER=gemini                    # or "mock" (no key, canned answers)
AI_MODEL=gemini-flash-latest          # tracks Google's current free Flash model
GEMINI_API_KEY=AQ....                 # server-only; never NEXT_PUBLIC_*
                                      # (AI Studio keys start with "AQ." as of 2026;
                                      #  older docs saying "AIza" are outdated)
```

`AI_PROVIDER=mock` runs the entire pipeline (validation, safety, logging,
UI) with canned schema-valid responses — used by tests and offline dev.
Getting a free Gemini key: spec §18 has the click-by-click walkthrough.
Free tier may train on prompts — **demo data only; paid tier (or a
no-training provider) before real patient data.**

## Database

Migration: `packages/db/migrations/2026-08-ai-suggestions.sql` (also folded
into `schema.sql`, section 14). Adds `ai_feature` / `ai_decision` enums and
the `ai_suggestions` table with the standard tenancy RLS, audit trigger,
subscription gate.

> ⚠️ **Apply to the hosted DB before deploying** a build that contains this
> feature (`supabase db execute --file packages/db/migrations/2026-08-ai-suggestions.sql --linked`),
> otherwise server-side suggestion logging fails against the missing table.

## Safety model (short version)

1. Drafts only — explicit Accept/Add/Prescribe writes, via existing services.
2. Deterministic allergy check (`lib/ai/safety.ts`) runs server-side after
   the model; `critical` flags render as a blocking banner requiring an
   acknowledgement checkbox before Prescribe enables. The model cannot clear
   a recorded allergy.
3. Rationale + source chips + confidence on every suggestion; persistent
   disclaimer; `insufficientData` instead of guessing.
4. Identifiers never reach the model (client omits, server `redact.ts`
   re-strips and warns).
5. Tenant isolation everywhere: bearer-token RLS on reads, writes, storage
   downloads, and cohort queries. No cross-hospital pooling (spec §12).
6. Fail-safe: provider error / bad JSON (one retry) / rate limit → calm
   "AI unavailable" message; manual workflow never blocks.
7. `/api/*` bypasses the PWA service worker (sw.js `careflow-v4`) — AI
   responses are never cached.

## Tests

- `apps/web`: `lib/ai/*.test.ts` (redaction, allergy check, cohort guard,
  context builder) — run with `vitest run lib/ai`; i18n parity covers the
  new `ai.*` keys.
- `packages/shared`: `types/ai.test.ts` (schemas) + `enum-parity.test.ts`
  (new PG enums ↔ TS arrays).

## Out of scope for now (spec §19)

Streaming render, drug–drug interaction dataset (stub in `safety.ts`),
voice capture, cross-hospital learning, formal regulatory validation —
**flag before real clinical use: decision support may be a regulated
medical device in some jurisdictions.**
