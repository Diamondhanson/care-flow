# CareFlow

A lightweight, high-signal **hospital operations platform** that tracks patients from admission through recovery follow-up. Instead of scattered files or cluttered enterprise grids, CareFlow mirrors the physical hospital floor as a **Live Status Board** — and now runs as a real, multi-hospital SaaS backed by Supabase.

> **Status:** Real backend live, offline-first hardened (Stages 1–8, July 2026).
> The app runs on **Supabase** (Postgres + Auth + Storage + Realtime, with
> row-level security for tenant isolation) using a **local-first sync layer**:
> the UI reads and writes an in-memory cache mirrored to **IndexedDB**, which
> hydrates a ~12-month working set from the database, streams colleagues'
> changes live, and syncs local edits back through a durable outbox with retry,
> conflict review, and a user-visible sync health panel.

## What it does

CareFlow is organized around the journey of a patient through a hospital:

- **Live Journey Board** (`/dashboard`) — a kanban (Boarding → Treatment → Discharge Planning → Followed Up) mapping the physical stages of care, with touch-friendly patient cards and status color accents.
- **Patient Intake** (`/intake`) — a boarding form with a prominent *Emergency Unconscious Intake* toggle that hides personal fields and auto-generates an anonymous tracking ID. Patient IDs follow the Cameroon format.
- **Clinical Encounter** — log vitals (SpO₂, BP, pulse, temp), GCS scores, and clinical notes; review treatment history; flip department clearance gates.
- **Orders & Results** (`/diagnostics`) — request labs/investigations and record results.
- **Prescriptions & Medication Administration** (`/medications`) — prescribe drugs and track administration (MAR).
- **Nursing Care Plans** (`/care-plans`) — structured inpatient care planning.
- **Ward / Bed Floor Map** (`/floor-map`) — an editable floor map with live bed occupancy.
- **Departments & Routing** (`/departments`) — route patients between departments.
- **Patient Billing** (`/billing`) — a price catalog plus automatic charge accrual as care events happen.
- **Reporting & Analytics** (`/reports`) — operational reports with export.
- **Post-discharge Follow-ups** (`/follow-ups`) — every discharge creates real follow-up tasks (recovery call, 7-day check-in) that nurses work and mark done.
- **Staff Directory** (`/staff`) — staff grouped by role; doctors show their currently-attending patients. Admins can create staff logins, edit/deactivate members, and reset passwords.
- **Profile Reconciliation** (`/reconciliation`) — merge an unidentified emergency record into a verified patient profile while preserving all clinical logs.
- **Discharge Verification** — a patient cannot reach "Followed Up" until all clearances pass *and* any anonymous emergency profile has been reconciled.

Plus, throughout: **French/English localization**, **light & dark mode** via semantic theme tokens, and **clinical-term autocomplete** libraries.

## Accounts & sign-in

There are two ways into the app:

- **Staff** sign in with a **username + password** (created by their hospital admin).
- **Hospital owners** create a new hospital by first **verifying their identity** — either **"Continue with Google"** or a **6-digit email code (OTP)** — and *then* filling in hospital details (`/signup` → `/onboarding`). Each verified owner gets exactly one hospital.

Every hospital's data is fully isolated from every other hospital's via Postgres row-level security (multi-tenancy).

## Architecture

```
[UI: Next.js + shadcn/ui]  ←— re-renders reactively (useCacheVersion)
        │  reads/writes instantly
        ▼
[In-memory cache + IndexedDB mirror (services/db/*)]
        │  windowed hydrate ▲   ▼ outbox w/ retry+conflicts   ▲ realtime stream
        ▼                   │                                  │
[Supabase: Postgres + Auth + Storage + Realtime + RLS]
```

- **Supabase is the source of truth; the device holds the working set.** On
  sign-in the app hydrates the RLS-scoped *working set* (all open work + the
  last ~12 months; older history loads on demand and stays cached). The UI
  reads/writes an in-memory cache mirrored row-by-row to IndexedDB — fully
  usable offline — while a durable outbox uploads changes with exponential
  retry, a dead-letter "needs attention" queue, and reviewable conflicts
  (notify + one-tap re-apply). Supabase Realtime streams colleagues' changes
  into every signed-in device within seconds.
- The data layer lives in `services/db/*` (barreled through
  `services/mockStorage.ts`), with `services/supabaseData.ts` (windowed reads),
  `services/syncQueue.ts` (outbox), `services/localDb.ts` (IndexedDB), and
  `lib/supabase/` (`client.ts` browser, `admin.ts` server-only service-role).
- The full database definition — tables, RLS policies, functions, realtime
  publication — is in **`supabase/schema.sql`** (idempotent; re-run it to
  upgrade). Incremental top-ups for live databases are in `supabase/snippets/`.
- Going to production? Follow **`docs/PRODUCTION-CUTOVER.md`** — the manual
  dashboard steps (Google OAuth, SMTP, hosted schema, cron) live there.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Supabase** (Postgres, Auth, Storage, RLS) via **`@supabase/supabase-js`**
- **Tailwind CSS v4** (CSS-variable theming via `@theme inline`)
- **shadcn/ui** (`base-nova` style, Base UI primitives), **lucide-react** icons, **next-themes** for light/dark
- Custom **EN/FR i18n** and **Vitest** for tests

## Getting Started

You'll need [the Supabase CLI](https://supabase.com/docs/guides/cli) and Docker running.

**1. Install dependencies**

```bash
npm install
```

**2. Start the local Supabase stack**

```bash
supabase start
```

**3. Load the schema and demo data** (the stack does not auto-apply these)

```bash
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$DB" -f supabase/schema.sql   # tables, RLS policies, functions
psql "$DB" -f supabase/seed.sql     # demo tenant: Douala General Hospital
```

**4. Create `.env.local`** — copy `.env.example` and fill in the keys printed
by `supabase status`:

```bash
cp .env.example .env.local
```

(Without these vars the app boots to a clear "not connected to a server"
notice instead of crashing.)

**5. Mint the demo staff logins**

```bash
set -a; source .env.local; set +a
npx tsx scripts/seed-auth.ts
```

**6. Run the app**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the demo account:

> **username:** `admin` · **password:** `CareFlow2026` (Douala General Hospital)

## Testing

```bash
npm test               # unit tests incl. schema↔types enum parity (Vitest, node)
npm run test:dom       # DOM/component tests (Vitest + Testing Library, jsdom)
npm run test:rls          # tenant-isolation / RLS integration suite
npm run test:onboarding   # verified-onboarding integration suite
npm run test:storage      # file storage integration suite
npm run test:concurrency  # optimistic-concurrency integration suite
```

The integration suites (`test:*`) run against a **local** Supabase only — they boot the stack if needed, apply `supabase/schema.sql`, and wrap each test in a transaction they roll back, so the database is left untouched. They never touch production.
