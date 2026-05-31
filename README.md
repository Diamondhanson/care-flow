# care-flow

A lightweight, high-signal hospital operations dashboard that tracks patients from admission through recovery follow-up. Instead of scattered files or cluttered enterprise grids, CareFlow mirrors the physical hospital floor as a **Live Status Board**.

> Frontend-simulation phase: the UI runs entirely against a browser `localStorage` mock engine so it can be prototyped offline, then later swapped to a real backend without touching the UI.

## Features

- **Live Journey Board** — a 4-column kanban (Boarding → Treatment → Discharge Planning → Followed Up) mapping the physical stages of care, with touch-friendly patient cards and status color accents.
- **Patient Intake** — a boarding form with a prominent *Emergency Unconscious Intake* toggle that hides personal fields and auto-generates an anonymous tracking ID (e.g. `John Doe - Gamma - 20260531`).
- **Clinical Drawer** — tap any card to log vitals (SpO₂, BP, pulse, temp), GCS scores, and medication; review treatment history; and flip the three department clearance gates.
- **Discharge Verification** — a patient cannot reach "Followed Up" until all three clearances pass *and* any anonymous emergency profile has been reconciled. Successful discharge fires a simulated follow-up notification log.
- **Staff Directory** — staff grouped by role, with doctors showing their currently-attending active patients.
- **Profile Reconciliation** — an admin worklist that merges an unidentified emergency record into a verified patient profile while preserving all clinical logs.
- **Light & dark mode** throughout, driven by semantic theme tokens.

## Architecture

```
[UI (shadcn/ui + Base UI)] → [Data Service Layer (services/mockStorage.ts)] → [Browser localStorage]
```

All data mutation logic is isolated in `services/mockStorage.ts`, keeping UI components storage-agnostic. When moving to a production database, only the service layer is swapped (e.g. for `supabase-js`) — the UI contract is preserved. A reference `supabase/schema.sql` is included for that future migration.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Tailwind CSS v4** (CSS-variable theming via `@theme inline`)
- **shadcn/ui** (`base-nova` style, Base UI primitives)
- **lucide-react** icons, **next-themes** for light/dark

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The mock database auto-seeds 5 staff and 5 clinical profiles (including an unconscious anonymous ICU patient) on first load. Clearing `localStorage` re-seeds a pristine state.
