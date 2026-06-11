# CareFlow

A lightweight, high-signal **hospital operations platform** that tracks patients from admission through recovery follow-up. Instead of scattered files or cluttered enterprise grids, CareFlow mirrors the physical hospital floor as a **Live Status Board** — and now runs as a real, multi-hospital SaaS backed by Supabase.

> **Status:** Real backend live. The app runs on **Supabase** (Postgres + Auth + Storage, with row-level security for tenant isolation) using a **local-first sync layer** — the UI reads and writes an in-browser cache that hydrates from, and syncs back to, the database.

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
- **Staff Directory** (`/staff`) — staff grouped by role; doctors show their currently-attending patients. Admins can create staff logins.
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
[UI: Next.js + shadcn/ui]
        │  reads/writes instantly
        ▼
[Local-first cache (services/mockStorage.ts)]
        │  hydrate on login ▲     ▼ sync queue (services/syncQueue.ts)
        ▼                    │
[Supabase: Postgres + Auth + Storage + RLS]
```

- **Supabase is the source of truth.** On sign-in, the app hydrates the current user's RLS-scoped rows into an in-browser cache; the UI reads/writes that cache for instant interactions, and a sync queue persists changes back to the database.
- The data + auth layers live in `services/` (`supabaseData.ts`, `supabaseAuth.ts`, `syncQueue.ts`) and `lib/supabase/` (`client.ts` for the browser, `admin.ts` for server-only service-role tasks).
- The full database definition — tables, RLS policies, and functions — is in **`supabase/schema.sql`**.

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

**4. Create `.env.local`** with the keys printed by `supabase status`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key — server-only, never exposed to the browser>
```

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
npm test               # unit + component tests (Vitest)
npm run test:rls          # tenant-isolation / RLS integration suite
npm run test:onboarding   # verified-onboarding integration suite
npm run test:storage      # file storage integration suite
npm run test:concurrency  # optimistic-concurrency integration suite
```

The integration suites (`test:*`) run against a **local** Supabase only — they boot the stack if needed, apply `supabase/schema.sql`, and wrap each test in a transaction they roll back, so the database is left untouched. They never touch production.
