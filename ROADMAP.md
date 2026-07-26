# Project CareFlow — Roadmap

## 📝 Project Overview

**CareFlow is a hospital operations system and lightweight Electronic Medical Record (EMR).**
Its job is to digitalize *every operation that happens inside the hospital* and the *full
progression of each patient* — from the moment a nurse receives them, through the doctor's
consultation, recommended tests and their results, prescribed medication, the admit-or-not
decision, ward/bed assignment and bedside medication, all the way to discharge and follow-up —
so the hospital keeps an accurate, queryable, exportable record of everyone who came in and
exactly what happened to them.

> **Scope note — this is NOT a replacement for the patient booklet.** The booklet stays with the
> patient and serves *them*. CareFlow is the *hospital's own* operational database: it records and
> owns everything the hospital does, so administration can count patients, track admissions and
> discharges, see which beds are free, audit who did what, and pull weekly/monthly reports.

### The patient journey CareFlow digitalizes

```
Arrival → Nurse intake/triage (vitals, details) → Doctor consultation (notes + diagnosis)
   → Tests ordered → Results recorded → Decision:
        ├── OUTPATIENT: prescription given → patient leaves
        └── INPATIENT: admit → ward/bed assigned → medication administered + monitored
                       → clearances → discharge → follow-up
```

### Who uses it (role-based)

* **Reception / Admissions:** register patients (auto-assigned hospital number / MRN), open a
  visit, or trigger the Emergency Unconscious Protocol (anonymous tracking ID, e.g.
  `John Doe - Gamma - 20260531`).
* **Nurses:** take intake details and vitals ($SpO_2$, BP, pulse, temp, GCS), prepare the patient
  for the doctor, administer medication at the bedside (recorded in the MAR), and run mistake-free
  shift handovers — all from a record the doctor already updated, with no back-and-forth.
* **Doctors:** see the patient's prior info on arrival, document the consultation, record
  diagnoses, order tests, review results, prescribe medication, and decide admit/discharge — in
  two taps.
* **Lab / Pharmacy:** lab techs enter results that close the test loop; pharmacists track
  prescription fulfilment.
* **Administration / Leadership:** monitor multi-department bottlenecks and bed occupancy,
  reconcile anonymous emergency profiles, and export analytics and reports.

---

## 🏗️ Architecture Strategy

**Frontend-first, with a clean swap to a real backend.** The UI is decoupled from persistence via
a service layer so the same UI contract works against the local mock today and Supabase later.

```
[UI Components (shadcn/ui)] → [Service Layer (services/*)] → [ Phase A: localStorage mock ]
                                                            → [ Phase B: supabase-js + Postgres ]
```

**Two architectural decisions that shape everything below:**

1. **The Visit (encounter) is the spine of the record**, not the kanban stage. A patient has many
   visits over their lifetime; each visit owns its consultations, vitals, orders, results,
   prescriptions and (optionally) an admission. This is what makes history and reporting work.
2. **Two paths, not one — outpatient vs inpatient.** Many patients come, see a doctor, get
   medication and leave without ever being admitted. The model and the board must handle both, or
   admission/bed counts will be wrong.

⚠️ **Development directive for AI editors:** keep all data mutation logic inside the service layer.
UI components stay storage-agnostic. When moving to production, only the service implementation is
swapped for `supabase-js`; the UI contract is preserved.

### Scope decisions (locked)

* **Billing / payments:** *out of scope for now.* Keep only the existing financial-clearance
  toggle. A full billing module (invoices, payments, NHIS/insurance, receipts) is a future,
  optional phase — see "Future / parking lot".
* **Hospital number (MRN):** *auto-generated.* Every patient gets a permanent, human-readable
  number (`CF-2026-000123`) on registration. **Implemented in the Supabase schema.**
* **Row Level Security:** *full role-based RLS written now*, ready to enforce the moment Supabase
  Auth is wired up.

---

## ✅ Status legend

`[x]` done · `[~]` partially done · `[ ]` not started

---

## PHASE 1 — Environment, Typing & Baseline Layout ✅ COMPLETE

* [x] Next.js App Router + TypeScript + Tailwind v4 (running on **Next.js 16.2.6 + React 19 +
  Tailwind v4**, not Next 14 — see Update Logs).
* [x] `shadcn/ui` (base-nova / Base UI) installed and configured.
* [x] Core data models in `types/healthcare.ts` (`Staff`, `Patient`, `Admission`,
  `TreatmentRecord`).
* [x] Responsive `AppShell` with desktop sidebar + mobile Sheet drawer; light/dark theming via
  semantic tokens in `globals.css`.

## PHASE 2 — LocalStorage Mock Engine ✅ COMPLETE

* [x] `services/mockStorage.ts` — `localStorage`-backed engine (`careflow_db_v1`), SSR-safe,
  auto-seed, corrupt-state recovery, `resetDatabase()`.
* [x] Handlers: `getActiveAdmissions`, `createNewAdmission`, `addTreatmentLog`,
  `updateAdmissionStage`, `reconcileAnonymousProfile`, `updateAdmissionClearances`.
* [x] 5 staff + 5 clinical mock profiles seeded across all stages, incl. anonymous unconscious
  patient.

## PHASE 3 — Live Journey Board & Intake ✅ COMPLETE

* [x] 4-column kanban board (`boarding → treatment → discharge_planning → followed_up`).
* [x] Intake form with prominent Emergency Unconscious toggle + auto-generated tracking tag.
* [x] Touch-friendly patient cards (≥44px targets, status color bar, emergency badge).

## PHASE 4 — Clinical Overlays & Reconciliation ✅ COMPLETE

* [x] Slide-out `PatientDrawer` with clearance gates, vitals/GCS logging, treatment history.
* [x] Admin reconciliation panel (anonymous-only) merging emergency record into a verified
  profile without losing logs.

## PHASE 5 — Verification Gates & Simulation ✅ COMPLETE

* [x] `evaluateDischargeReadiness()` gate + clearance-blocked discharge.
* [x] Anonymous-record safety block on discharge.
* [x] Simulated post-discharge follow-up transmissions (console).

---

> **Phases 1–5 delivered the *flow* layer (the board). Phases 6+ add the *clinical record* — the
> actual medicine — and the operational + reporting layers that make this a real hospital system.**

---

## PHASE 6 — Domain Model Expansion (Visit-Centric Refactor) ✅ COMPLETE

**Goal:** re-center the data model on the Visit, and add the missing clinical entities. This is the
foundation everything else depends on.

* [x] Refactor `types/healthcare.ts` to add the entities below (relational, FK-linked):
  * [x] `Department` — Maternity, Ophthalmology, Internal Medicine, etc.
  * [x] `Visit` — patient_id, visit_type (`outpatient`/`inpatient`/`emergency`), status,
        department, attending doctor, registered_by, chief complaint, arrived/closed timestamps.
  * [x] `Consultation` — doctor's SOAP-style note (subjective / examination / assessment / plan).
  * [x] `Diagnosis` — ICD-10 code + description + primary flag (powers "top conditions" reports).
  * [x] `Order` — a recommended test (lab / imaging / procedure) with status.
  * [x] `Result` — closes the order loop; value, reference range, optional file attachment.
  * [x] `Prescription` — drug, dose, route, frequency, duration, instructions, status.
  * [x] `MedicationAdministration` (MAR) — one row per dose given/held/refused, by whom, when.
  * [x] `TreatmentRecord` — flat vitals (spo2/pulse/bp/temperature/gcs), keyed to the visit.
  * [x] `Ward` + `Bed` — the editable floor map (see Phase 11).
  * [x] Extend `Admission` — link to visit, ward, bed; keep clearance gates.
  * [x] Add `mrn` (hospital number) to `Patient`.
* [x] Extend `services/mockStorage.ts` with CRUD for every new entity, keeping all mutation logic
      in the service layer.
* [x] Re-seed mock data to include outpatient visits, consultations, orders+results, prescriptions
      and MAR entries — so the UI has realistic data to render.
* [x] **Verify:** unit-test the new pure helpers (discharge gate, MRN format, occupancy math).

## PHASE 7 — Departments & Patient Routing ✅ COMPLETE

**Goal:** every department (Maternity, Ophthalmology, …) uses the same system.

* [x] Department directory + admin management UI.
* [x] Route a visit to a department at registration; filter the board/queues by department.
* [x] Per-department views so each unit sees its own patients while admin sees everything.

## PHASE 8 — Clinical Encounter & Documentation ✅ COMPLETE

**Goal:** the doctor's actual work is captured in the record.

* [x] Doctor consultation view: prior patient info shown on open; SOAP note entry.
* [x] Structured diagnosis entry (ICD-10 lookup, primary/secondary).
* [x] Disposition decision: discharge-home / admit / observation / refer.
* [x] **Dev-only role switcher** (no auth): navbar control + `RoleProvider` to preview
  any staff member's role UI; the doctor console is gated to the doctor role. Removed
  wholesale when real auth lands (Phase 13).
* [ ] Patient timeline showing every consultation across visits — *deferred*; the
  drawer currently surfaces prior consultations/diagnoses for the open visit.

## PHASE 9 — Orders & Results Loop ✅ COMPLETE

**Goal:** "doctor recommends test → test done → result recorded → doctor decides."

* [x] Doctor orders tests (lab / imaging / procedure) from the consultation.
* [x] Lab/imaging queue; lab tech enters results (file attachment as mock metadata — real upload deferred to Phase 13 Supabase Storage).
* [x] Results surface back on the visit; abnormal-flag highlighting; doctor review.

## PHASE 10 — Prescriptions & Medication Administration (MAR) ✅ COMPLETE

**Goal:** the doctor writes the medication structure; nurses administer it without going back.

* [x] Prescription entry (drug, dose, route, frequency, duration, instructions) — in the doctor console with drug/route/frequency quick-picks and dose+route auto-fill for common drugs.
* [x] Nurse MAR view (`/medications`): due/overdue/upcoming doses across the active wards, sorted by urgency, with one-tap "given / held / refused" that stamps the time + acting author and re-schedules the next dose.
* [x] Shift-handover view summarizing outstanding meds per ward (overdue / due / clear) at the top of the MAR page.

## PHASE 11 — Editable Ward / Bed Floor Map & Occupancy ✅ COMPLETE

**Goal:** admin defines the hospital's physical layout; occupancy stays live.

* [x] Admin CRUD for **Wards** (name, **block**, floor, department) and the **Beds** inside each ward
      — the `/floor-map` page lets an admin create wards, pre-fill or append beds (auto-numbered
      "Bed N"), rename beds, set manual status (free / reserved / cleaning / maintenance), and
      remove empty beds. *(A ward's optional **block** field — `block` on `Ward`, threaded through
      `createWard`/`updateWard`, the `wards` schema, and FR/EN — lets a hospital group wards across
      multiple physical blocks/buildings.)*
* [x] Assigning an admitted patient to a bed marks it occupied; transfer/discharge frees the old
      bed and occupies the new one — `transferAdmission`/`assignBedToAdmission` in the service layer
      mirror the Supabase `sync_bed_occupancy` trigger.
* [x] Live floor-map view: wards grouped by floor, per-ward total / free / occupied tallies, and
      who occupies each bed; occupied beds can't be re-statused or removed. *(Sidebar tab renamed
      **"Beds" → "Floor Map"** / **"Plan des étages"** to reflect that it manages the hospital's
      physical structure, not just beds.)*
* [x] **Transfers** (flagged item #1) folded in: ward/bed/doctor moves are first-class append-only
      events. The inpatient patient drawer gains a "Placement & transfers" section — assign a bed to
      a bedless admission, move ward/bed/doctor with a reason, and read the transfer history.
* [ ] Backed by the `ward_occupancy` reporting view (deferred to Phase 13 with the Supabase cutover;
      the mock computes occupancy from `beds` directly).

### Update Log

* **MAR split by care setting** (Phase 10): the nurse MAR view (`/medications`) groups due/overdue/
  upcoming doses and supports one-tap given/held/refused.
* **Allergies as a standalone safety phase**: patient allergy records drive a drawer banner
  (no-known / unassessed / has-allergies) and a drug-allergy prescribing caution.
* **Transfers coupled into Phase 11**: because bed occupancy and ward/doctor transfers are the same
  underlying state change, transfers ship inside Phase 11 rather than as a separate phase — modeled
  as append-only `transfers` events with the admission row holding the current placement.
* **Ward blocks + "Floor Map" rename** (post-18.5 polish): wards gained an optional `block` field so a
  hospital can group them across multiple physical blocks/buildings (type → `createWard`/`updateWard`
  → `wards` schema → form → FR/EN, plus the live `block text` column on the hosted DB). The "Beds"
  sidebar tab was renamed **"Floor Map" / "Plan des étages"** to better describe the physical-structure
  management it does.
* **Shared rich `PhoneInput`** (post-18.5 polish): one reusable `components/ui/phone-input.tsx`
  (country select + dialing code + live libphonenumber formatting + country flags via
  `react-phone-number-input` + `country-flag-icons`) now backs the **onboarding, staff, and intake**
  forms, each with strict email + phone validation and inline errors.

## PHASE 12 — Reporting, Analytics & Export ✅ COMPLETE

**Goal:** the payoff — accurate counts and exportable records for the review board.

* [x] Dashboard (`/reports`): patients seen per period, admissions vs outpatient, current bed occupancy,
      average length of stay, top diagnoses, medications dispensed, per-department throughput — plus
      visit-type mix, care-stage funnel, drug/order/allergy/abnormal-result breakdowns, demographics,
      clinician workload and discharge-clearance bottlenecks.
* [x] Date-range filtering (7d / 30d / 90d / all-time presets + custom range).
* [x] **PDF export** (jsPDF + autotable) and **Excel export** (SheetJS, multi-sheet) of the full report.
* [x] Recharts visualizations (stacked-area trend, donuts, horizontal/vertical bars) on an 8-hue
      categorical palette; rich historical seed (~46 closed visits over 60 days) for dense charts.
* [ ] Backed by the `admission_report` view + new aggregate queries (deferred to Phase 13 cutover;
      aggregation currently runs client-side over the mock store).

> **UX phases (13–16) come BEFORE the backend.** These lower the learning curve for low-tech-literacy
> staff in the target market (small/medium hospitals in Douala) and make live demos easy to follow.
> All are **frontend + copy only** — none require Supabase. Work them one at a time; the backend
> cutover (Phase 17) stays the final phase.

## PHASE 13 — Localization (French/English) & Plain Language ✅ COMPLETE

**Goal:** the single highest-leverage adoption change for a francophone market — the UI speaks French,
and every label reads like a clinic worker talks, not like the database. An English-only, jargon-heavy
UI is a wall in front of every other feature, and a French demo lands completely differently.

* [x] Added a **homegrown** i18n layer (no new dependency) with an **FR/EN toggle** (Cameroon is
      bilingual). Persist the choice (localStorage now; user profile after Phase 17). **English is the
      default/SSR locale**; French is opt-in via the toggle (both fully translated).
* [x] Externalized **every** UI string — nav, page titles, buttons, form labels, empty states, errors —
      into `fr` / `en` dictionaries typed as `Messages` so `tsc` fails on any missing key. No
      hard-coded copy left in components (incl. the shared `ui/sheet` close label + dev role switcher).
* [x] Replaced data-model jargon with plain primary labels (technical term kept as muted secondary):
  * [x] "Patient Intake" → **Enregistrer un patient** / "Register a patient"
  * [x] "Diagnostics" → **Tests & résultats** / "Tests & results"
  * [x] "Reconciliation" → **Associer un patient d'urgence** / "Match emergency patient"
  * [x] "Floor Map" → **Plan des étages** / "Floor Map" *(was "Lits / Beds"; renamed post-18.5 — see Phase 11)*
  * [x] "MRN" → **Numéro d'hôpital** / "Hospital number" (MRN kept small/secondary)
  * [x] "Chief complaint" → **Motif de consultation**; "Disposition" → **Suite à donner**
  * [x] keep GCS / SpO₂ but add a plain hint on first use.
* [x] Localized dates/numbers and the navbar date to the active locale (`i18n/format.ts` over `Intl`).
* [x] **Verified:** switched to FR and walked reception → doctor → nurse flows with no English leaking
      through; `tsc`/tests green.

### Scope boundary
Clinical reference *values* stay canonical/untranslated — drug names (`Amoxicillin`), ICD-10 code
descriptions, preserved abbreviations (`GCS`, `SpO₂`, `IV`, `IM`), free-text chief complaints, and the
parseable `ROUTE_OPTIONS`/`FREQUENCY_OPTIONS`. Page `metadata` stays English (server-only, can't read
the client locale without cookies/middleware).

## PHASE 14 — Role-Based, Task-Focused Simplification ✅ COMPLETE

**Goal:** each user sees only what their job needs, in plain language — cutting perceived complexity
roughly in half without removing any capability.

**Today:** the nav is a flat 9-item menu and the `PatientDrawer` (~1,600 lines) shows almost every
section to everyone (only two small `isDoctor` gates), so a receptionist sees a doctor's workspace.
This builds on the existing `RoleProvider` / dev role switcher (no auth needed yet).

* [x] Drive `NAV_ITEMS` (`components/layout/app-shell.tsx`) off the acting role via a `ROLE_NAV`
      map (hydration-safe: the full menu renders until mount, then narrows). Menus shipped:
  * **Reception:** Board · Register · Beds · Match emergency
  * **Nurse:** Board · Medications · Beds
  * **Doctor:** Board · Tests & results · Medications
  * **Pharmacist:** Board · Medications · Tests & results · **Lab tech:** Board · Tests & results
  * **Admin:** everything (current full menu). Routes are hidden from nav, never blocked.
* [x] Restructured `PatientDrawer` into a **role-led primary action + a single collapsed "More"**
      expander. Each section carries a stable key; the acting role's lead sections render first and
      expanded (doctor → consult console + care stage; nurse → vitals + care stage; reception →
      reconcile + placement + care stage), the rest fold under "More options". Implemented with
      per-section flex `order` + a `hidden` toggle (no JSX moved); unmapped roles (admin/pharmacist/
      lab_tech) see every section. `careStage` is in every lead set so the drawer is never empty.
* [x] Led the Live Board with one obvious primary action — a prominent **Register a patient** CTA in
      the board header (the filter select is demoted beside it).
* [x] Surfaced **triage priority** (flagged item #3) — added a `TriageLevel` (1 critical … 5
      non-urgent) field on `Visit`, seeded clinically-sensible values (DB bumped to `careflow_db_v5`),
      a colored acuity badge on every board card, and a triage selector on the intake form. New
      `--triage-1..5` tokens defined in both light/dark blocks of `globals.css`.
* [x] **Verified:** as doctor/nurse/reception the menu + drawer show only that role's tasks (lead
      sections expanded, rest under "More"); admin reaches everything (full nav, all sections, no
      collapse). Triage badges render in FR & EN; `tsc` clean, 131 tests green, no hydration errors.

## PHASE 15 — "Find My Patient" Front Door ✅ COMPLETE

**Goal:** match how staff actually think — "find Mr. Mbella / patient 00123" — instead of navigating a
menu.

* [x] Add a **global patient search** (by name or hospital number / MRN) pinned to the top of every
      screen. *(`GlobalSearch` trigger lives in the app-shell header — present on every page — plus a
      ⌘K / Ctrl+K shortcut. Backed by `searchPatients()` matching name, MRN, national ID, phone, and
      the emergency anonymous identifier, ranked exact/prefix-first.)*
* [x] Make the booklet-number → hospital-number lookup obvious (the bridge between paper and digital).
      *(MRN **is** the hospital/booklet number; the input placeholder reads "Search by name or hospital
      number" / "Rechercher par nom ou numéro d'hôpital" and each result shows the `CF-YYYY-NNNNNN`
      number in mono.)*
* [x] Search results open straight into the patient/visit drawer. *(A result resolves to a visit via
      `getLatestVisitForPatient()` — open visit preferred, else most recent — and opens the existing
      `PatientDrawer`.)*
* [x] **Verify:** find a seeded patient by partial name and by MRN in ≤2 taps from any page. *(Verified
      in-browser EN + FR: "mensah" → Grace Mensah, "CF-2026-000002" → Samuel Idris; result opens the
      drawer; ⌘K works; FR strings + translated visit-type badge ("Hospitalisé") + no-results message
      all clean; no hydration warnings. 140 vitest tests pass, tsc clean.)*

## PHASE 16 — Comprehension, Guidance & Demo-Readiness ✅ COMPLETE

**Goal:** make the first five minutes teach themselves — for real onboarding and for live demos in
front of skeptical, low-tech-literacy staff. (Absorbs the frontend items of the former "Hardening"
phase: empty/loading states, accessibility, demo seed.)

* [x] **Legibility pass:** raise base font sizes + contrast (much metadata is 10–11px muted today);
      pair every icon-only control with a word; keep the existing color-bar / large-tap-target wins.
      *(Done 2026-06-02. Lifted `--muted-foreground` contrast in both light & dark blocks of
      `globals.css`; bumped the smallest board fonts — patient-card MRN/meta/reason, journey + stage
      column headers — up a step; icon-only navbar controls already carry `aria-label` + `title`.)*
* [x] **Guided tour** on first load (3–4 callouts: this is the board, tap a patient, register here,
      switch role/language). *(Done 2026-06-02. `components/onboarding/guided-tour.tsx` — a centered,
      mount-guarded, localStorage-dismissed 4-step overlay wired into `AppShell`; a "?" navbar button
      replays it any time via a window event. FR/EN `tour` namespace.)*
* [x] **"Next step" nudges** on board cards (e.g. a triage card shows "→ Send to doctor") so the
      workflow teaches itself. *(Done 2026-06-02. `nextStepLabel(stage, visitType)` in
      `live-board/stages.ts` returns the action that advances the visit — keyed off the next stage so
      it respects the outpatient short-circuit — rendered as an accented pill on each `PatientCard`.
      FR/EN `nextStep` namespace; 4 vitest cases added.)*
* [x] **Friendlier empty states** ("No patients waiting. Tap *Register a patient* to start.").
      *(Done 2026-06-02. Board columns now read "No patients waiting here" / "Aucun patient en attente
      ici"; the board header already carries the prominent Register CTA. The medications / diagnostics /
      reconciliation / floor-map pages already shipped guiding empty-state hints in Phase 12–14.)*
* [x] **Print a visit slip / patient summary** — bridges paper ↔ digital (staff tuck it into the
      existing booklet); a strong demo moment. *(Done 2026-06-02, pulled forward. A **Download patient
      report** button in the `PatientDrawer` header generates a comprehensive single-visit PDF —
      patient + visit identifiers, allergies, vitals, doctor's SOAP notes, diagnoses, tests + results,
      medications + doses given, admission + length of stay + transfers — fully FR/EN localized. See the
      Phase 16 (pulled forward) Update Log entry.)*
* [x] **Intake simplifications:** offer **approximate age** when DOB is unknown; plain-language
      confirmations for discharge/transfer (state the outcome) and sentence-style errors; reassuring
      offline messaging ("Saved. Will sync when internet returns.") on the existing PWA. *(The
      "Registering staff" dropdown drops out automatically once Phase 17 auth supplies the logged-in
      user.)* *(Done 2026-06-02. Intake DOB field gains an "Exact date unknown? Enter age instead"
      toggle that stores an approximate `YYYY-01-01` DOB; the `PatientDrawer` now shows plain-language
      transfer confirmations ("Moved to {placement}.", "Now under {doctor}.") and a discharge confirm
      step that states the outcome before closing the visit; `SyncStatus` is fully localized, with a
      reassuring offline line ("Saved on this device. Will sync when the internet returns."). Discharge
      blockers moved to i18n keys (`drawer.blocker*`) — a Phase-13 leak fix. FR/EN mirrored.)*
* [x] **Demo mode:** one-click reset to a clean, realistic sample hospital for repeatable demos.
      *(Done 2026-06-02. `components/demo/reset-demo.tsx` — a confirm-gated card on the Staff page that
      calls `resetDatabase()` (wipe + reseed + clear sync outbox) and hard-reloads to a known clean
      state. FR/EN `demo` namespace.)*
* [x] **Verify:** a first-time user, given no instructions, can register a patient and advance them
      through the board using only on-screen guidance. *(Verified 2026-06-02 in the browser: registered
      a patient via the board's Register CTA, followed the per-card "next step" nudges through triage →
      consultation → diagnostics → discharge using only on-screen guidance, hit the discharge confirm
      step, and completed the visit. Transfer confirmation, demo reset, and FR locale spot-checked.)*

## PHASE 16.5 — Demo-Readiness QA Pass ✅ COMPLETE

**Goal:** the last polish before the backend — confirm the role-led drawer actually feels simple to a
non-doctor, and that nothing breaks when the UI is rendered in French. Frontend + copy only.

### Drawer simplification — finish & confirm

The `PatientDrawer` was restructured (Phase 14) to lead with each role's primary action and fold the
rest under "More". Verify it lands in practice rather than just in markup:

* [x] Open a patient **as a nurse** and confirm the drawer opens to *Record vitals* + *Medications /
      care stage* with everything else collapsed — not a long scroll of doctor sections.
* [x] Repeat **as reception** (identity + reconcile/placement lead) and **as doctor** (consult console
      leads). Admin still sees every section expanded.
* [x] If any role still has to scroll past sections it doesn't use, tighten the lead-section set or the
      "More" boundary in `patient-drawer.tsx` until the first screen shows only that role's task.
      *(No change needed — `PRIMARY_BY_ROLE` lead sets already surface each role's task first; the
      Allergies safety banner is deliberately pinned first for every role.)*
* [x] Check the collapsed "More" expander is obvious and reachable with a large tap target on mobile.
      *(Full-width 44px-tall expander — good mobile target.)*
* [x] **Verify:** for each role, the *first thing visible* in the drawer is the action that role came
      to do; `tsc` clean, tests green.

### French browser pass (layout / overflow)

French text runs ~15–20% longer than English, so the risk is visual overflow, not missing strings.

* [x] Switch the UI to **FR** and walk every page (board, intake, diagnostics, medications,
      reconciliation, departments, floor map, reports, staff) at **desktop and mobile widths**.
* [x] Watch for: nav labels wrapping/truncating, button text overflowing, triage/emergency badges
      clipping, patient-card "next step" pills wrapping awkwardly, table headers on `/reports`, and the
      guided-tour overlay copy fitting its box. *(All clean. Two fixes made — see below.)*
* [x] Fix overflows with wrapping/min-width/`truncate` tweaks — don't shorten the French copy just to
      fit. *(1) Header facility title: added `truncate` so it can't spill onto the global search at
      tight widths. (2) Floor-map ward-card header: the tally chips + edit button now wrap below the
      ward name on narrow cards via a `@container` query — was squeezing the ward name to a single
      letter. This bug was locale-independent (worse in EN) but surfaced during the FR pass.)*
* [x] Add an **en/fr key-parity test** (assert both dictionaries expose the identical key set) so a
      missing French key fails CI instead of silently falling back to English in a demo.
      *(`i18n/parity.test.ts`, 3 tests.)*
* [x] **Housekeeping:** remove the `@rollup/rollup-linux-arm64-gnu` and
      `@oxc-parser/binding-linux-arm64-gnu` entries from `package.json` / the lockfile — they are
      Linux-arm64-specific binaries added only to run tests in a sandbox and should not be committed
      (they can break `npm install` on macOS / CI).
* [x] **Verify:** a full FR walkthrough at mobile + desktop with no clipped or overflowing UI; parity
      test green; `tsc` clean. *(153/153 tests pass; `tsc --noEmit` exit 0; floor-map clean at 390 /
      768 / 1280 in both locales.)*

## PHASE 16.6 — Nursing Care Plan (Inpatient) ✅ COMPLETE

**Goal:** give nurses a dedicated place to record the individualized, non-medication care an admitted
patient needs (bathing, feeding, positioning, temperature control, comfort, etc.) and a running,
shift-to-shift log — so when one nurse takes over from another, the required care and what's already
been done are visible without chasing anyone. Based on **Virginia Henderson's 14 components of basic
nursing care**. This fills a real gap flagged by a practicing nurse: the MAR tracks medication, but
nothing tracks the ADL/needs-based care that fills most of a nursing shift.

**Why its own page, not just a drawer tab:** the patient drawer already carries vitals, meds, doctor's
notes, orders, clearances and more — adding care plans there is too much. Nurses need to isolate *just*
nursing-care activity, so this gets a **dedicated page** (left-nav entry → master/detail), mirroring how
the `/medications` MAR page works.

**Scope:** patients with an active **admission** (inpatient). *(Open question: also include
observation / day-case patients receiving nursing care without a full admission? Default for now:
admitted only; can be extended with a flag later.)*

### Data model (mirror the existing patterns — append-only log, service-layer only)

* [x] `care_need_category` enum from Henderson's 14, named practically: `breathing`, `nutrition`,
      `elimination`, `mobility_positioning`, `sleep_rest`, `hygiene`, `temperature`, `dressing`,
      `safety`, `communication_emotional`, `pain_comfort`, `spiritual`, `wound_skin_care`, `other`.
* [x] `CarePlanItem` (the **plan** — what the patient needs): `admission_id`, `patient_id`,
      `category`, `description`, `frequency` (free text, e.g. "Every 2h"), optional `goal`,
      `status` (`active` / `resolved`), `created_by_id`, timestamps.
* [x] `CarePlanEntry` (the **log + handover** — append-only, never overwritten, like `transfers`):
      `admission_id` (and optional `care_plan_item_id`), `note`, `is_handover` flag, `recorded_by_id`,
      `recorded_at`.
* [x] Add all three to `types/healthcare.ts`, `services/mockStorage.ts` (CRUD + read queries:
      `getCarePlanItemsForAdmission`, `getCarePlanEntriesForAdmission`, `addCarePlanItem`,
      `resolveCarePlanItem`, `addCarePlanEntry`, `getAdmittedPatientsForCarePlan`), and
      `supabase/schema.sql` (tables + indexes + `updated_at`/audit triggers + nurse/doctor/admin RLS
      write, all-staff read).

### UI

* [x] New left-nav entry **"Nursing care plan"** (`/care-plans`), in the **nurse** role's menu
      (`ROLE_NAV` in `app-shell.tsx`); visible to doctor/admin too (read + write).
* [x] **Master/detail page:** left = list of currently admitted patients (name, bed/ward, a count of
      active care needs, and a **handover-waiting** signal when an unread handover note exists); right =
      the selected patient's care plan in three blocks — **What is required** (the plan items),
      **What has been done** (the care log, with handover notes visually highlighted), and actions to
      **Record care** and **Leave handover**.
* [x] A **ward filter** at the top so a nurse can narrow to her ward at shift change.
* [x] Low-friction input: category is a **quick-pick** (not free typing); record-care and handover are
      short forms. (Natural future home for the French voice-to-note AI.)
* [x] A compact **read-only** care-plan summary inside the patient drawer (for a doctor's glance), so
      the drawer references the record without becoming the working surface.
* [x] Fully localized (FR/EN) including the category labels.

### Seed sample data (so the panel is populated and demoable)

Seed against the existing admitted patients (bump the mock DB key). Concrete records:

* [x] **Samuel Idris — ICU-04 (post-op laparotomy).** Needs: Hygiene — "assist with bed bath, keep skin
      dry" (Daily); Mobility/positioning — "turn every 2h to prevent pressure sores" (Every 2h);
      Temperature — "tepid sponge and review if temp > 38.5°C" (As needed); Nutrition — "soft diet,
      assist feeding, encourage fluids" (Each meal). Log: Romero 12:05 "Turned to left side. Temp 37.8°C,
      settling." · Patel 14:20 "Bed bath given, skin intact. Ate half of lunch." · **Handover** Patel
      15:00 "Anxious about surgery tomorrow — needs reassurance. Watch temperature this evening."
* [x] **Aisha Bello — Ward B-11 (pneumonia, recovering).** Needs: Breathing — "sit upright, encourage
      deep breathing / chest physio" (Every 4h); Hygiene — "assist shower" (Daily); Mobility —
      "encourage short walks on the ward" (Twice daily). Log: Patel 13:10 "Walked to end of ward and
      back, tolerated well." · **Handover** "Chest clearer, coughing productively. Keep prompting deep
      breathing."
* [x] **Daniel Owusu — Ward A-03 (diabetic, stabilized).** Needs: Nutrition — "diabetic diet, monitor
      intake" (Each meal); Wound/skin care — "inspect feet daily for ulcers" (Daily). Log: Romero 11:30
      "Feet inspected, no ulcers. Ate full breakfast."
* [x] **John Doe · Gamma — ICU-02 (unconscious, head trauma, GCS improving).** Needs: Hygiene — "full
      bed bath + mouth care" (Daily); Positioning — "turn every 2h" (Every 2h); Elimination — "catheter
      care, monitor output" (Each shift); Eye care — "clean + protect eyes to prevent dryness" (Every
      4h); Safety — "cot sides up, neuro observations" (Each shift). Log: Patel 14:00 "Full bed bath and
      mouth care done. Repositioned. Output adequate." · **Handover** "GCS improving (7→9). Continue
      2-hourly turns and eye care. Family visited."

### Verify

* [x] Open `/care-plans` as a nurse: the four seeded patients appear in the list with their need counts,
      Idris shows a handover-waiting signal; clicking a patient shows required care + the care log with
      the handover note highlighted; recording care and leaving a handover append to the log and update
      the signal. Admin/doctor can read it; the drawer shows the read-only summary. FR + EN clean; `tsc`
      clean; unit tests for the new pure helpers green. *(Shipped: `/care-plans` master/detail page,
      `CarePlanItem`/`CarePlanEntry` model + service layer, drawer summary, nurse/doctor nav, seed data,
      FR/EN, Supabase schema; `tsc` clean; tests green.)*

## PHASE 16.7 — Cameroon Patient ID Format ✅ COMPLETE

**Goal:** replace the auto-generated MRN (`CF-YYYY-NNNNNN`) with a Cameroon-standard patient ID
derived from the patient's birth date, name initials, and mother's first-name initial — generated at
registration.

**Format:** `YYMMDD` + name initials + ` - ` + mother's initial
* `YY` = last 2 digits of birth year · `MM` = 2-digit birth month · `DD` = 2-digit birth day
* initials = first letter of each part of the patient's full name, uppercase
* ` - ` then the first letter of the mother's first name
* **Example:** Bambot Hanson Ngongmun, born 20/11/1998, mother Ndung → `981120BHN - N`

### Decisions (locked)
* **Replace MRN entirely.** This becomes the only patient ID shown everywhere (cards, search, intake
  success, drawer, reports, printouts). Remove the `CF-…` sequence + `generate_mrn()`.
  The patient **UUID stays the true internal key** — all FKs/joins reference the UUID, so swapping the
  human-facing ID never touches relationships.
* **Uniqueness = suffix on clash (interim).** If the generated ID already exists, append a counter
  (`981120BHN - N-2`, `-3`, …). Good enough for now; better collision-proofing comes later.
* **Mother's first name = optional field** at registration. If blank, generate without the
  ` - <initial>` part (e.g. `981120BHN`); it can be added later, which regenerates the suffix.

### Edge cases to handle
* **Unknown DOB / approximate age** (stored `YYYY-01-01`): the ID uses whatever DOB is recorded — may
  be approximate.
* **Emergency anonymous intake:** no DOB/name/mother → no Cameroon ID yet; generate it at
  reconciliation when real details are entered (same point the `anonymous_identifier` is resolved).
* **Accents/diacritics** in French/African names: normalize to A–Z before taking the initial.
* **Variable length:** initials = one letter per whitespace-separated name token, in stored order, so
  ID length varies with the number of names.

### Implementation
* [x] Add `mother_first_name` (nullable) to `Patient` in `types/healthcare.ts`, the intake form, and
      `supabase/schema.sql`.
* [x] Replace the MRN display field with the new ID. Recommend renaming `patients.mrn` →
      `patients.patient_code` for clarity (update all references), or keep the column name but change
      its meaning/format — either way, drop the `CF-…` default and generate app-side.
* [x] Pure helper in the service layer: `generatePatientId(dob, fullName, motherFirstName)` →
      base ID, plus clash-suffix logic against existing IDs. Generate at patient creation
      (`createNewVisit`) and (re)generate at `reconcileAnonymousProfile`.
* [x] `supabase/schema.sql`: drop the `mrn_seq` / `generate_mrn()` default; the app supplies the ID on
      insert (or a `plpgsql` function mirrors the helper). Keep a `unique` index on the ID.
* [x] Intake form: add the optional "Mother's first name" field; show the generated patient ID on the
      success screen instead of the MRN.
* [x] Update every display of the old MRN: patient cards, drawer header, **global search** (match on
      the new ID + name + phone), reports, and the printed visit slip.
* [x] i18n: relabel "Hospital number / Numéro d'hôpital" → "Patient ID / Identifiant patient"; add
      FR/EN labels for the mother's-name field.
* [x] Unit tests: the worked example → `981120BHN - N`; accent stripping; missing mother → no ` - x`;
      approximate DOB; clash → suffix.

### Seed regeneration (so existing patients carry valid IDs)
Recompute each seeded patient's ID in the new format and add a plausible mother's first name:
* [x] Grace Mensah, 1989-03-14, mother Akosua → `890314GM - A`
* [x] Samuel Idris, 1972-11-02, mother Fatima → `721102SI - F`
* [x] Aisha Bello, 1995-07-21, mother Hauwa → `950721AB - H`
* [x] Daniel Owusu, 1960-01-09, mother Abena → `600109DO - A`
* [x] John Doe · Gamma (anonymous) → no ID until reconciled

### Verify
* [x] Registering a patient generates the correct ID (with and without a mother's name); the worked
      example and edge-case unit tests pass; a forced clash appends `-2`; anonymous intake gets its ID
      at reconciliation; the ID shows on cards/search/drawer/intake in FR + EN; `tsc` clean, tests green.

> **Deviation from plan (locked):** kept the existing `patients.mrn` field/column name internally
> (no rename to `patient_code`) — only the UI labels became "Patient ID / Identifiant patient". The
> human-facing format changed; the field name and all FKs/joins are untouched. `mrn` is now nullable
> (anonymous patients carry no ID until reconciled). 183 tests pass.

## PHASE 16.8 — Reconciliation Redesign (Emergency → Identified) ✅ COMPLETE

**Goal:** the original reconciliation tab only offered "merge into an existing patient" via a dropdown,
which a nurse found confusing. Reframe it so the nurse picks an emergency record and fills in a **full
registration form** that gives the anonymous patient a real identity **in-place**.

* [x] New centered modal `Dialog` UI primitive (`components/ui/dialog.tsx`, base-ui), with light/dark
      tokens and exit animation.
* [x] `completeAnonymousProfile(anonymousId, details)` service fn: updates the anonymous patient record
      in-place (same UUID → all visits/FKs intact), flips `is_emergency_anonymous` off, clears
      `anonymous_identifier`, and mints the Cameroon patient ID.
* [x] `ReconcileDialog` (`components/reconciliation/reconcile-dialog.tsx`): a full registration form
      (name, sex, DOB / approx-age toggle, phone, national ID, mother's first name) **plus** an optional
      "already in the system?" search that links an existing patient to merge instead.
* [x] Reworked `/reconciliation` page: searchable emergency worklist; each card's single **Reconcile**
      action opens the dialog; dismissible success banner.
* [x] FR/EN strings for the new flow.

### Verify
* [x] Filling the form updates the emergency record in-place with a real name + generated patient ID
      (no duplicate created); the optional merge path reassigns visits to the linked patient and removes
      the anonymous record; FR + EN clean; `tsc` clean; 183 tests pass.

## PHASE 16.9 — Patient Billing & Expenditure Tracking ✅ DONE

**Goal:** let a hospital price every chargeable activity and **automatically accumulate a patient's
expenditure across their journey**, then generate, adjust, and print an itemized bill. Most charge lines
come from events CareFlow *already* records — billing is a price layer on top of the journey.

**Scope boundary:** this is **billing / invoicing only** — *not* payment processing, mobile-money
collection, or insurance/NHIS claims (those stay in the parking lot). The deliverable is: a price
catalog, automatic charge accrual, and a printable bill with discounts + manual items.

> **Deviations from the original spec (decided with the user at implementation time):**
> 1. **Live & free for everyone, not paid-tier-gated.** The "optional, off-by-default, paid tier" idea
>    was dropped — every hospital gets billing now so it can be tested. No subscription gate.
> 2. **Informational billing — it does NOT block discharge.** Settling a bill ticks the admission's
>    `is_financial_cleared` flag as a *convenience*, but **no new discharge-blocking logic was added**;
>    the discharge gate is unchanged. (Originally the spec had "unpaid bill blocks discharge".)
> 3. **Catalog pricing is decoupled via a semantic `ref_code`** (e.g. `bed_icu`, `lab_fbc`) that the
>    auto-charge resolvers match, rather than `department_id`/`ward_id` columns. Bed price is resolved by
>    ward *name* (ICU / Maternity / general). Each `charge` carries a `source_ref_id` for idempotent
>    reconciliation, and the manual/discount "reason" lives in the line `description`.

### Decisions (locked)
* **Drugs:** a small **common-drugs price list** for auto-charging + the ability to add any other drug
  price **manually**. Expandable to a full catalog later.
* **Time-based charges (bed/nursing):** **computed at billing time** from the admission length and ward
  transfers — no background scheduler.
* **Billing actors:** **admin + receptionist** (no new role). Every discount, manual line, and waiver is
  **audited** (who, when, reason) via the existing `audit_log`.
* **Bill scope:** **per visit / episode** (covers the current visit incl. its admission); past visits
  are viewable as history.
* **Currency:** integer **XAF** (the CFA franc has no decimal subunit) — store as integers, format as
  francs, never floats.

### Data model
* [x] `billable_items` (the **price catalog / fee schedule**): `category` enum (`consultation`, `lab_test`,
      `imaging`, `procedure`, `medication`, `bed_per_night`, `nursing_per_day`, `other`), `name`,
      `unit` enum (`per_item` / `per_night` / `per_day`), `unit_price` (int XAF), `ref_code` (semantic
      auto-charge key, e.g. `bed_icu`), `is_active`, timestamps. *(Used `ref_code` instead of
      `department_id`/`ward_id` columns — see deviation #3.)*
* [x] `charges` (the **bill ledger** — one row per line): `visit_id`,
      `billable_item_id` (nullable for manual/discount), `source_ref_id` (idempotency key → originating
      record/segment), `description`, `quantity`,
      `unit_price` **(snapshotted at creation — later price changes do NOT alter past bills)**,
      `amount`, `source` enum (`consultation`, `order`, `prescription`, `bed`, `nursing`, `procedure`,
      `manual`, `discount`), `status` (`pending`/`paid`/`waived`),
      `created_by_id`, timestamps. Discounts are negative-amount rows (reason in `description`).
* [x] Mirrored both into `supabase/schema.sql` with `updated_at`/version/audit/RLS wiring (admin +
      receptionist write), `hospital_id` on both. *(Schema applied to the live DB on 2026-06-09 via
      `psql supabase/schema.sql`; sample billing data seeded for all 51 demo visits — 18 catalog items +
      160 charges — via `scripts/seed-billing-live.ts`, computed with the same `computeAutoChargeLines` engine.)*

### Price catalog admin UI
* [x] A new admin page (`/billing/prices`) to manage `billable_items` grouped by category: consultation
      prices, the lab's test menu + prices, imaging, procedures, bed-per-night, nursing-per-day, drugs,
      misc — add/edit price, unit, ref-code, active toggle. (Built like the existing admin screens.)

### Automatic charge accrual (event → charge)
* [x] Consultation recorded → consultation fee (one line per consultation).
* [x] Each non-cancelled `order` (lab/imaging/procedure) → that item's price (cancelled orders skipped).
* [x] Each prescription → drug price from the common-drugs list (else `drug_other` fallback).
* [x] Admission (at billing time) → bed nights **per ward segment** using the `transfers` timestamps
      (e.g. 3 nights ICU + 2 nights general ward, each at its ward's rate) + nursing days × nursing rate.
* [x] Procedure → procedure price. `unit_price` snapshotted onto every charge; reconciliation is
      idempotent (keyed by `source` + `source_ref_id`) and preserves manual lines + discounts.

### Billing screen (`/billing`)
* [x] Admin/receptionist: search/select a visit → itemized bill grouped by category with running total →
      **apply discount** (amount + reason) → **add manual line items** (catalog or custom) → per-line
      status (paid/waive/remove) → final total → **export PDF** (reuses the visit-summary PDF machinery).
* [x] **Mark settled → flips `is_financial_cleared`** on the admission *as a convenience only* —
      **informational, does NOT block discharge** (deviation #2; the discharge gate is unchanged).
* [x] Fully FR/EN; all amounts formatted as XAF via `formatXaf`.

### Seed price catalog (so it demos with real numbers)
* [x] Consultation: General Medicine 5,000; Ophthalmology 7,000. Beds: ICU 20,000/night, Maternity
      10,000/night, General ward 6,000/night. Nursing care 3,000/day. Lab: FBC 3,000, Malaria RDT 1,500,
      Blood sugar 2,000. Imaging: Chest X-ray 12,000. Procedure: Delivery (Maternity) 50,000. Common
      drugs: Paracetamol 500, Amoxicillin 2,500, Artemether-Lumefantrine 3,500. **Plus sample charges
      seeded for every visit** (auto-derived from each visit's record; closed visits `paid`, open
      `pending`) so the screen has real data to view while testing.

### Verify
* [x] Pure-helper unit tests (catalog resolution, ward-segment/night math, auto-charge derivation, bill
      summary) — 14 tests; a full-journey billing leg (derive → manual line → discount → settle, asserting
      idempotent reconcile + XAF totals); the PDF exports itemized XAF totals; `tsc` clean, **234 unit
      tests green**, eslint clean, `next build` green (both `/billing` + `/billing/prices` routes build).

## PHASE 16.10 — Clinical Term Autocomplete & Library 🚧 (implementation done; seed lists + manual UI pass pending)

**Goal:** reduce clinical typing to near-zero. As a doctor types 3–4 letters in any clinical field, a
menu of common medical terms pops up; they select it, it drops in as an entry, and they add as many as
needed. Built for clinicians who type slowly, works offline, **usable from day one** via a large seed
library that **improves with use**. Side benefit: turns free text into consistent, reportable data.

**Categories (6):** `subjective`, `examination`, `assessment`, `plan`, `medication`, `investigations`.
> **NOTE:** `investigations` is **one combined category** for lab tests + imaging + procedures. Each
> investigation term carries an `order_type` (`lab` / `imaging` / `procedure`) so selecting it sets the
> right type on the created `Order` automatically.

### Architecture — two layers
* **Seed layer (static, bundled, offline):** one JSON file per category, each a flat array of term
  objects, shipped with the app. **Drop-in by design — to add more terms you just edit/paste into the
  file; the next build picks them up automatically with NO code change.**
* **Learned layer (grows over time):** a runtime store (localStorage in the mock → a `clinical_terms`
  table per hospital in Phase 17/18) holding (a) doctor-added custom terms from the free-text fallback,
  and (b) usage counts so frequently-picked terms rank higher. Merged with the seed at search time.

### Term schema (`ClinicalTerm`)
`category`, `term_en`, `term_fr`, `synonyms_en[]`, `synonyms_fr[]` (incl. lay terms),
`system` (for subjective/examination, else null), `icd10` (for assessment, else null),
`order_type` (`lab`/`imaging`/`procedure` for investigations, else null),
`dose` / `route` / `frequency` / `form` / `drug_class` (for medication, else null).

### Files the user pastes the generated terms into (Claude Code surfaces these)
* [x] `data/clinical-terms/subjective.json`
* [x] `data/clinical-terms/examination.json`
* [x] `data/clinical-terms/assessment.json`
* [x] `data/clinical-terms/plan.json`
* [x] `data/clinical-terms/medication.json`
* [x] `data/clinical-terms/investigations.json`
Each ships with **six** well-formed bilingual example entries (format template) so the build works and
the paste format is obvious before the real lists are dropped in.

### Implementation
* [x] Add the `ClinicalTerm` type and create the six JSON files above (six example entries each).
* [x] `lib/clinical-terms` loader (`index.ts`): **statically imports all six files** (so pasted entries
      are bundled on build, zero code change), stamps `category`, de-dupes, and exposes
      `searchTerms(category, query, locale, { limit })` — prefix + synonym + **accent-insensitive**
      matching, ranked match-strength → usage → recency → alphabetical, capped. Pure matching/ranking
      lives in `lib/clinical-terms/search.ts` (node-unit-testable).
* [x] Learned-layer service (`lib/clinical-terms/learned.ts`): custom terms + usage counts in
      localStorage now (SSR-guarded, **scoped per active hospital**); schema-ready for a `clinical_terms`
      table in Phase 17/18. Wraps the pure reducers in `search.ts`; increments the count on each select.
* [x] Reusable `TermAutocomplete` combobox + `TermChips` multi-add input
      (`components/clinical-terms/term-autocomplete.tsx`; keyboard nav, ~100 ms debounce, themed
      dropdown), applied to:
  * [x] Doctor console **subjective / examination / assessment / plan** → multi-add chips with a
        **free-text fallback** (unknown term still addable, saved to the learned layer); persisted into
        the existing `Consultation` fields as a newline-joined list (no data-model change).
  * [x] **Medication** prescribe form → autocomplete; selecting a drug auto-fills dose/route/frequency
        from the term.
  * [x] **Investigations** order form → autocomplete; selecting a term sets the description and
        `Order.order_type` from the term's `order_type`.
  * [x] **Assessment/diagnosis** form → autocomplete; selecting a term auto-fills the ICD-10 code.
* [x] Retired the ad-hoc `COMMON_DRUGS` / `COMMON_ORDERS` / `COMMON_ICD10` datalists in favour of the
      library (single source of truth); updated their unit tests.
* [x] Performance: debounce (~100 ms), cap rendered rows (default 8), accent-insensitive match. Seed
      stays in bundled files, not localStorage.
* [x] Localization: display each term in the active locale (FR/EN), but **search across both languages
      + synonyms** so partial/lay spellings still surface the right term.
* [ ] **Multi-tenant:** the learned/custom terms get a real `hospital_id` column in Phase 17 (today the
      localStorage key is already scoped per active hospital); the static seed is shared across tenants.

> **Clinical safety:** the AI-generated seed will contain occasional errors (especially drug doses and
> ICD-10 codes). A clinician should review the `medication` and `assessment` lists before real-patient
> use; for testing it's fine to start as-is and let the learned layer capture corrections.

### Verify
* [x] `tsc` clean; **258 unit tests green** (incl. 25 new pure search/rank/learned-reducer + loader
      tests in `lib/clinical-terms/*.test.ts`); eslint clean; `next build` green.
* [ ] Manual UI pass (in browser): typing 3–4 letters shows ranked matches; selecting adds a chip;
      multiple entries add cleanly; a free-text fallback saves a custom term that reappears next time
      and climbs the ranking with use; a medication selection auto-fills dose/route/frequency; an
      investigation selection sets the right `order_type`; a diagnosis selection fills the ICD-10 code;
      **pasting more entries into a JSON file + rebuilding surfaces them with no code change**; FR + EN
      clean in both light + dark.

## PHASE 17 — Multi-Tenant Foundation, Hospital Accounts & Onboarding ✅ COMPLETE

**Goal:** turn CareFlow into a SaaS where **each hospital is an isolated tenant/account.** A hospital
admin signs up from a public landing page, provisions their hospital (departments, wards, beds), and
creates staff logins to hand out. Built into the schema **before** the data cutover (Phase 18) so
tenant isolation is *designed in*, never retrofitted — cheap now (no live data), painful later.

**Tenancy model:** shared tables + a `hospital_id` discriminator + RLS (pooled multi-tenancy) — the
standard, cost-effective choice for small/medium hospitals. A dedicated database per hospital stays a
future premium option for any tenant demanding hard physical isolation.

### Tenant data model

* [x] **`hospitals` table** — the account/tenant entity: `id`, `name`, `region/location`, contact,
      `subscription_tier`, `subscription_status` (`trial` / `active` / `suspended`), `created_at`.
      This is also where monetization hooks live (a suspended/unpaid hospital is restricted).
* [x] **Add `hospital_id` (FK → hospitals) to every domain table:** `staff`, `patients`, `allergies`,
      `visits`, `consultations`, `diagnoses`, `orders`, `results`, `prescriptions`,
      `medication_administrations`, `treatment_records`, `admissions`, `transfers`, `departments`,
      `wards`, `beds`, `care_plan_items`, `care_plan_entries`, `billable_items`, `charges`, `audit_log`.
      (The patient **UUID** stays
      the internal key; `hospital_id` is an added dimension, not a replacement.)
* [x] **Per-tenant uniqueness:** make patient ID, bed labels, department/ward names unique **within a
      hospital** (composite `unique (hospital_id, …)`). The Cameroon patient-ID clash check + suffix
      (Phase 16.7) now scopes per hospital — more correct.

### Tenant isolation (the make-or-break — highest stakes)

> Holding *multiple* hospitals' patient records means one cross-tenant leak is catastrophic (privacy,
> trust, legal). This must be airtight and tested.

* [x] **`current_hospital_id()` RLS helper** — resolves the logged-in staff's hospital
      (`select hospital_id from staff where user_id = auth.uid()`), mirroring `current_staff_id()`.
* [x] **Add `hospital_id = current_hospital_id()` to EVERY RLS policy** — no table exempt. This is the
      line that guarantees Hospital A never sees Hospital B's data.
* [x] **Per-tenant storage:** prefix every object path with `hospital_id` and scope storage RLS by
      hospital, so files can't leak across tenants.
* [x] **Automated cross-tenant isolation tests:** a query/run as Hospital A's user returns **zero** of
      Hospital B's rows, across every table *and* storage bucket. *(Shipped: `tenancy.test.ts`,
      `rls.integration.test.ts`, `storage.integration.test.ts`, `onboarding.integration.test.ts`.)*

### Accounts, roles & onboarding

* [x] **Hospital signup:** creates the `hospitals` row **and** the founder's own `staff` row with role
      `admin`. Public `/signup` (`signUpHospital` against the mock today; the `auth.users` link is
      provisioned at the Phase 18 cutover).
* [x] **Admin provisioning:** the admin creates departments / wards / beds / staff, all scoped to their
      hospital (the admin UIs already exist — every create-mutator now stamps `hospital_id`).
* [x] **Admin-creates-staff logins:** implemented as a **Next server action** using the Supabase
      **admin (service_role) client** (`app/actions/auth.ts` → `auth.admin.createUser`), with the
      add-staff UI on `/staff`. Server-side, never exposed to the browser.
* [~] **Subscription gating:** the model + a `trial` status and trial banner shipped
      (`subscription_status`, app-shell trial badge); the full **suspended → restricted** enforcement
      and per-tier feature unlocks are still to finish.

### Public landing page

* [x] A **public, unauthenticated** marketing page (French-first) explaining the value with a
      "Create your hospital account" CTA → signup. Routes restructured into `(marketing)` (public `/`,
      `/signup`, `/login`) and `(app)` (the dashboard, now at `/dashboard` **behind a `RequireAuth`
      boundary**, framed by the AppShell with a sign-out/account menu).

### Verify

* [x] **(mock):** Two hospitals sign up independently; each admin's data is stamped to their hospital;
      a user logs in (pick hospital → staff) and sees **only their hospital's** patients/board; the
      landing → signup → login → sign-out flow works in FR + EN; `tsc` clean, **191 tests green**
      (incl. a tenancy isolation suite covering the board/queue reads). *Browser-verified both ways: a
      fresh tenant shows a 0-active board; the demo tenant shows its full caseload.*
* [x] **(live DB, Phase 18):** cross-tenant isolation + RLS + storage integration tests pass as real
      authenticated users under RLS (`rls.integration.test.ts`, `storage.integration.test.ts`).

## PHASE 18 — Backend Cutover: Supabase, Auth, RBAC, Audit & Compliance ✅ COMPLETE

**Goal:** swap the mock for the real, secure, multi-user backend. Shipped across commits
`Phase 18a` (auth), `Phase 18b` (local-first sync), and `safety+sync` (isolation tests, file storage,
optimistic concurrency).

* [x] Provision the database — **`supabase/schema.sql`** (all tables incl. `hospitals` + `hospital_id`,
      enums, indexes, triggers, Cameroon patient-ID handling, occupancy sync, storage buckets, and
      **tenant-scoped, role-based RLS**); demo tenant seeded (`scripts/seed-demo.ts` / `seed-auth.ts`).
* [x] **Real Supabase Auth + RBAC:** `lib/supabase/*` (client, admin, identity, storage),
      `services/supabaseAuth.ts`, `auth-provider` + `RequireAuth`; RLS enforces role + hospital. The dev
      role switcher is retired behind real auth.
* [x] **Audit trail enforced** via the `audit_trigger` + append-only, tenant-scoped `audit_log`.
* [x] **Real data layer:** `services/supabaseData.ts` replaces the mock behind the same UI contract,
      with **local-first sync** (the offline outbox drains to Supabase) and **optimistic-concurrency**
      handling for simultaneous edits (`concurrency.integration.test.ts`).
* [x] **File storage:** lab results / imaging / documents in private, **per-hospital** buckets
      (`lib/supabase/storage.ts`, `storage.integration.test.ts`).
* [~] **Compliance hardening:** RLS-behavior integration tests ✅ and concurrency ✅ are done; Supabase
      provides encryption at rest/in transit by default. The **formal data-privacy review, retention
      policy, and backup policy remain operational items** to finalize before a real production launch.

## PHASE 18.5 — Verified Tenant Onboarding (Email OTP + Google) ✅ COMPLETE (live online)

**Goal:** before a hospital is created, **verify the founding admin's identity.** They authenticate
first — via **Google sign-in** or **email OTP** (passwordless code) — and only *after* verification do
they enter the hospital details and create the tenant. Separates "the user" from "the hospital," the
standard SaaS pattern.

**Why:** today's signup mints the auth user + hospital together via the service-role admin API, so the
email isn't truly verified. Verifying first stops junk/bot/typo'd tenants, ties each account to a
recoverable real identity, and removes password friction (Google) with a passwordless fallback (OTP).

> **Scope boundary:** this is **only** for the founding admin / tenant creation. Regular staff
> (doctors/nurses) remain **admin-created username+password** logins from Phase 17 — unchanged.

### Flow
1. Public signup → "Continue with Google" **or** "Continue with email (get a code)".
2. Supabase Auth: `signInWithOAuth({ provider: 'google' })` or `signInWithOtp(email)` → user verifies →
   authenticated session with a confirmed email.
3. If the authenticated user **has no hospital yet** → route to the **"Create your hospital"** form
   (name, region, contact…).
4. On submit → a **`SECURITY DEFINER` RPC `create_hospital_and_admin(details)`** atomically creates the
   `hospitals` row + the founder `staff` row (role `admin`) linked to `auth.uid()` (the already-verified
   user) — no broad insert policy on `hospitals`/`staff` needed for unaffiliated users.
5. If the user **already owns a hospital** → route straight into the app.

### Implementation
* [x] Configure the **Google OAuth provider** in Supabase (Google Cloud OAuth client ID/secret +
      redirect URLs) — done for both local and the **hosted** project; Google sign-in confirmed live
      online (auth probe returns `302 → accounts.google.com`).
* [x] Replace the public `/signup` (auth-user-created-at-signup) with: client-side **OTP/OAuth**
      verification → then the **`create_hospital_and_admin` RPC** via
      `createHospitalForCurrentUser` (`services/supabaseAuth.ts`). The legacy service-role
      `provisionHospital` action is retained (integration-test helper), but is no longer the public path.
* [x] **Onboarding gate:** verified-but-no-hospital users resolve to `needsOnboarding` in the
      `AuthProvider` and land on `/onboarding`; `RequireAuth` routes them there (not to `/login`), so an
      abandoned signup resumes on next login.
* [x] UI: new `/signup` (Google + email-OTP via the shared `OwnerAuth` widget) + inline OTP-entry +
      `/onboarding` create-hospital form + `/auth/callback` OAuth return; `/login` also offers owner
      Google/OTP alongside staff username+password. Fully FR/EN.
* [x] Decided: **one hospital per owner** — enforced in the RPC (refuses if the caller already has a
      `staff` row) and in the app (an owner with a hospital is routed into the app).

### Manual steps remaining (owner) — DONE
* [x] **Apply the RPC** to the database: applied the standalone
      `supabase/snippets/phase-18_5-verified-onboarding.sql` to the **hosted** DB and verified live
      (`security_definer = t`; `EXECUTE` granted to postgres/authenticated/service_role only). Also
      applied to local earlier.
* [x] **Google Cloud:** OAuth 2.0 Client ID (Web) created; authorized redirect URI set to the hosted
      Supabase callback `https://ftudvptmhblydmrsmazw.supabase.co/auth/v1/callback` (local
      `http://127.0.0.1:54321/auth/v1/callback` kept).
* [x] **Supabase → Auth → Providers → Google:** client ID + secret pasted, enabled (hosted).
* [x] **Supabase → Auth → URL config:** app origin + `…/auth/callback` added to the redirect
      allow-list (hosted).
* [~] **Supabase → Auth → Email templates → Magic Link / OTP:** `{{ .Token }}` 6-digit template
      confirmed locally (Mailpit). Hosted relies on Supabase's built-in SMTP until a real provider
      (Resend) is configured — see the production checklist below.

### Notes / edge cases
* **Orphan users** (verified, no hospital) resume onboarding on next login — handle gracefully.
* The **Google login email** and the **hospital's contact email** can differ (Google = owner login;
  hospital keeps its own contact info).
* Email-OTP needs reliable email delivery (Supabase's built-in email or a configured provider).
  **Verification is limited to email OTP and Google only** — SMS/phone OTP is **out of scope** (an SMS
  provider adds cost and integration complexity); it can be revisited later if needed.

### Verify
* [x] A new owner can complete signup via **Google** *and* via **email OTP**; only after verification can
      they create a hospital; the hospital + admin `staff` row link to the verified auth user; an
      abandoned signup resumes at the create-hospital step; an existing owner is routed into the app;
      staff logins still work via admin creation; FR + EN; `tsc` clean, tests green. *(Verified online
      against the hosted project: Google sign-in live; the `create_hospital_and_admin` RPC creates the
      tenant + founder admin against the hosted DB.)*

### Local dev status (done)
* [x] RPC `create_hospital_and_admin` applied to the **local** DB and verified (SECURITY DEFINER,
      `EXECUTE` granted to `authenticated` only).
* [x] **Email OTP** working end-to-end locally (codes land in Mailpit at `http://127.0.0.1:54324`;
      `magic_link` template surfaces `{{ .Token }}`). Local `email_sent` rate limit raised to 60/hr.
* [x] **Google** enabled locally: creds in `.env.local`, `config.toml [auth.external.google] enabled = true`
      + `skip_nonce_check = true` (local-only), auth settings report `google: true`.
* [x] ~~App pointed at the **local** stack via the `.env.local` LOCAL block~~ → **now points at the
      hosted project** (`.env.local` HOSTED block active; the LOCAL block is commented `#LOCAL#` to flip
      back). This makes the app usable online with just `npm run dev` — no local Docker/Supabase needed.

### Production cutover checklist (Google + Supabase + host) — DO BEFORE LAUNCH
> `config.toml` only configures the **local** stack. Production is configured in the Supabase **dashboard**
> + **Google Console** + the **host env (Vercel)** — none of the local settings carry over.

**Database**
* [x] Apply `create_hospital_and_admin` (+ schema/RLS) to the **hosted** DB — applied & verified live;
      onboarding now works against the hosted project. *(Also applied the `wards.block` column to the
      hosted DB for the post-18.5 ward-block feature.)*

**Google Cloud Console**
* [x] Credentials → OAuth client → **Authorized redirect URIs**: hosted Supabase callback
      `https://ftudvptmhblydmrsmazw.supabase.co/auth/v1/callback` added (local URI kept).
* [x] **Authorized JavaScript origins**: app origin added.
* [ ] **OAuth consent screen → Publish App** (Testing → Production) so any Google user can sign in and the
      "unverified app" warning clears. Requires privacy policy URL, terms URL, authorized domain, logo.
      *(Still pending — works for test users today.)*

**Supabase dashboard (hosted project)**
* [x] Authentication → Providers → **Google**: enabled + Client ID/Secret pasted (no `skip_nonce_check`
      in prod). Confirmed live (`302 → accounts.google.com`).
* [x] Authentication → URL Configuration: **Site URL** + `…/auth/callback` added to the **Redirect
      URLs** allow-list.
* [~] Authentication → Email templates → **Magic Link**: ~~paste the `{{ .Token }}` template~~ — moot
      for OTP now: delivery is handled app-side via Resend (Phase 18.6), not Supabase's built-in email.
* [x] **Email provider wired — Resend** (Phase 18.6, no longer deferred): OTP is generated app-side
      (`admin.generateLink`) and delivered via Resend. For real multi-recipient delivery, still
      **verify a sending domain** in Resend + set `RESEND_FROM` (today's `onboarding@resend.dev` test
      sender only reaches the Resend account email). Hosted **OTP expiry set to 5 min**.

**Host env (Vercel)**
* [ ] Set prod env vars: `NEXT_PUBLIC_SUPABASE_URL=https://ftudvptmhblydmrsmazw.supabase.co` and
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=<hosted anon key>`. (No code change for the callback — the widget uses
      `${window.location.origin}/auth/callback`, which auto-resolves to the prod domain.)

**Optional but recommended**
* [ ] Supabase **custom auth domain** (e.g. `auth.<yourdomain>`): then the Google redirect URI becomes
      `https://auth.<yourdomain>/auth/v1/callback` and the consent screen shows your domain, not `supabase.co`.

## PHASE 18.6 — Security, Email & Reliability Hardening ✅ COMPLETE

**Goal:** a post-launch hardening pass — close input-validation gaps, deliver auth email through a real
provider, fix a local-first sync data-loss bug, and add the missing clinical edit affordances surfaced
in use. All shipped together after Phase 18.5.

* [x] **Resend email + verified-OTP delivery.** OTP login is now delivered by **Resend**, not Supabase's
      built-in email: client → server action (`app/actions/otp.ts`) → `admin.generateLink` mints the code
      without sending → `lib/email/resend.ts` delivers it (themed, header-injection-guarded) → client
      verifies (`verifyOtp`). Server-only keys in `.env.local`. The OTP screen gained a **5-minute
      countdown timer** and a **segmented one-cell-per-digit input** (`components/auth/otp-input.tsx`).
      *(OTP length is project-configurable; the input is length-flexible.)*
* [x] **Centralized runtime input validation (Zod).** New `lib/validation/` (`primitives`, `schemas`,
      `email`) — strict parsing at the **service-role server actions** + **auth/OTP** boundary (length
      caps, email/phone format, role enum, UUID, 6–8 digit OTP) and at the **core clinical mutators**
      (intake / results / MAR / vitals). Validation-only (never rewrites a value); a strict email
      validator + `assertNoHeaderInjection` (CR/LF/NUL guard) replace 3 weak inline regexes. Audit
      verdict: **no live SQLi**, **RLS complete on all 22 tables** — verify-and-documented, no rewrites.
* [x] **DB defense-in-depth.** Idempotent length/format + vitals-range `CHECK` constraints added to
      `supabase/schema.sql` (section 11). **Captured in schema only — NOT applied to the hosted DB**
      (apply via `test:rls` locally / a deliberate prod migration later).
* [x] **Local-first sync data-loss fix (vitals disappearing).** `hydrateFromSupabase` atomically
      replaced the cache and was re-triggered on *every* auth event (token refresh / tab refocus),
      clobbering un-synced local writes. Fixed three ways: **drain the outbox before hydrating**,
      **overlay still-pending outbox rows** on top of the server snapshot (`replaceDatabaseFromTables`),
      and **hydrate only on a genuine identity change** (not passive events; explicit logins/onboarding
      force it). Regression-tested.
* [x] **Vitals entry no longer silently lost.** Over-tight ranges + an uncaught throw discarded the whole
      entry; ranges loosened to plausible physiological extremes and the form now surfaces a
      field-specific error ("check GCS…") instead of dropping the observation.
* [x] **Delete for mistaken orders & medications.** `deleteOrder` / `deletePrescription` (cascade to
      results / MAR), exposed as a two-step in-place confirm (trash → "Delete?") on each card in the
      doctor console. RLS already permitted it.
* [x] **Patient register in Reports (Phase 12 extension).** A line-by-line hospital register
      (`components/reports/register*`) inside the Reports tab — toggle between **Analytics** and
      **Patient register**, modeled on the Cameroon MINSANTE register; filterable (period, status incl.
      "currently in hospital", type, department, sex, search) and exportable to **PDF / Excel / CSV**.
* [x] **Verify:** `tsc` clean; full unit suite green (incl. new validation, sync-overlay, delete and
      register tests); i18n parity green. Interactive flows confirmed via unit tests (the hosted auth
      wall blocks automated click-through).

## PHASE 19 — Platform Owner / Super-Admin Console (+ Monorepo) 🔜 NEXT

**Goal:** give *you* (the platform owner) a **cross-tenant** console to monitor how hospitals use the
app and to manage their accounts — a fundamentally different surface from the per-hospital admin, since
it reads *across* tenants. Now buildable because Phases 17–18 (multi-tenancy + real backend) are done.

> **Two principles drive the whole design:**
> 1. **Separate, privileged, isolated.** This is the highest-privilege surface in the system — it can
>    see every hospital and suspend accounts. It must be a separate app/subdomain with its own auth and
>    a `platform_admin` role, **never reachable from the hospital app**, reading cross-tenant data only
>    through a privileged **server-side path** (service_role via server actions/RPC) so tenant RLS is
>    never weakened.
> 2. **Telemetry, not PHI.** The owner runs on **aggregate usage metadata, not patient clinical
>    content** — both for privacy and because "we can't read your patients' records" is a trust
>    statement worth making to hospitals. Any "view as hospital" support tool is rare, consented, and
>    heavily audited.

### 🔒 Locked decisions (2026-06-20)

* **Package manager / build:** **pnpm workspaces + Turborepo** (strict, fast monorepo ergonomics;
  sidesteps the npm-lockfile EBADPLATFORM friction we've hit on macOS).
* **Telemetry transport:** a **dedicated lightweight emitter** in the hospital app (buffered,
  fire-and-forget), **separate from the clinical sync outbox**, so telemetry never bloats clinical sync.
* **Cross-tenant data path:** **service-role behind server-only code** (RSC / server actions) with a
  `requirePlatformAdmin()` guard on every call, returning **aggregates only** — tenant RLS is **never**
  weakened with `platform_admin` SELECT policies.

### 📦 Delivery sequence (each sub-phase independently shippable + verifiable)

* **19.0 — Monorepo migration** (pure refactor, no features): Turborepo + pnpm workspaces; move the
  current app to `apps/web` (keep its `@/*` alias internally); extract `packages/shared`
  (`types/healthcare.ts`, the `lib/validation/*` layer, Supabase generated types) and `packages/db`
  (`schema.sql` as the single source of truth); scaffold an empty `apps/owner-console`. Two Vercel
  projects / subdomains (`app.` + `admin.`). Done when both apps `build` and the full test suite is green.
* **19.1 — Telemetry groundwork:** `platform_admins` + append-only `usage_events` (metadata only) +
  `hospitals.{subscription_tier, trial_ends_at, feature_flags}`; **write-only RLS** from tenants (staff
  may INSERT their own hospital's events, **no SELECT** — only service_role reads). `services/telemetry.ts`
  emitter in `apps/web` (login, patient registered, visit opened, record counts, sync failures, feature use).
* **19.2 — Owner console MVP:** console auth (reuse `OwnerAuth`/Resend) **gated on `platform_admins`**;
  cross-tenant reads via the service-role server path; tenants list + basic activity + suspend/reactivate.
* **19.3 — Dashboard depth:** adoption (DAU/WAU/MAU, at-risk list), onboarding funnel, system/sync health,
  charts (reuse `recharts` + the export patterns). Add nightly rollup tables if raw aggregation gets slow.
* **19.4 — Management & monetization:** tier/trial/billing ops; **feature flags end-to-end** (console
  writes `hospitals.feature_flags`; the hospital app reads + gates modules — this also closes the Phase-17
  suspend→restrict gap by blocking suspended tenants in `RequireAuth`); support tools; broadcast banners;
  central seed-library publishing.
* **19.5 — Hardening:** audit-log every owner action; a consented, audited "view as"; rate limits;
  cross-tenant **isolation integration tests** (console can't leak PHI; hospital app can't reach console data).

### Monorepo transformation (first step)

* [ ] Convert the repo into a **monorepo** (npm/pnpm workspaces or Turborepo): `apps/web` (the current
      hospital app, moved as-is) + `apps/owner-console` (new) + `packages/shared`.
* [ ] Extract the shared contract into `packages/shared` — `types/healthcare.ts`, the Supabase
      generated types, and the `supabase/schema.sql` — so both apps consume **one source of truth**.
* [ ] Keep **separate deployments / subdomains**: `app.careflow…` (hospital app) and
      `admin.careflow…` (owner console), each with its own auth.

### Telemetry groundwork (start emitting now)

* [ ] Add a **usage/events layer** the hospital app writes to (logins, record-created counts, active
      users, feature usage, sync health) — **metadata only, no clinical content** — so the console has
      history to show on day one. A `platform_admins` table gates console access.

### What the owner sees (dashboard)

* [ ] **Tenants:** total hospitals, signups over time, status split (trial/active/suspended), region,
      churn; a searchable hospital list.
* [ ] **Adoption & engagement:** active hospitals (7/30-day), DAU/WAU/MAU, staff per hospital, depth
      (records/period as counts), which optional modules each hospital uses, stickiness, and an
      **at-risk list** (signed up but inactive).
* [ ] **Subscription & revenue:** MRR/ARR by tier, trial conversion, payments due/overdue, status
      changes (ties to the monetization plan).
* [ ] **System health:** error rates, app-version distribution, **offline-sync health** (pending/failed
      syncs — a great connectivity/bug signal), storage usage.
* [ ] **Onboarding funnel:** landing → signup → activated (first patient registered) → paying.

### What the owner can do (management)

* [ ] **Account lifecycle:** approve/create a hospital, **suspend/reactivate** (`subscription_status`),
      change tier, extend/end a trial, offboard with a data export.
* [ ] **Billing ops:** mark paid, set/comp tier, see payment status (manual mobile-money early on).
* [ ] **Feature flags:** toggle optional modules (billing, care plans, AI) per hospital or per tier;
      kill-switch a misbehaving feature. *(This also completes the suspend→restrict gating left open in
      Phase 17.)*
* [ ] **Support:** reset a hospital admin's password, resend invites, create the first admin for a
      hand-onboarded hospital, and a tightly-audited "view as".
* [ ] **Broadcast:** push maintenance / announcement banners to hospitals.
* [ ] **Central content:** publish updates to the shared seed libraries (clinical-term library,
      price-catalog templates) that all hospitals inherit.

### Verify

* [ ] Two hospitals' activity shows in aggregate (no clinical content); the owner can suspend a hospital
      and that hospital is then restricted; a feature flag toggles a module for one tenant; the console
      lives on a **separate deploy/subdomain with its own auth** and is unreachable from the hospital
      app; cross-tenant reads go through the privileged server path (tenant RLS untouched); `tsc` clean,
      tests green.

---

## PHASE 21 — Patient Demographics & Review of Systems (ROS) ✅ COMPLETE (2026-07-03; hosted schema apply pending)

> **Update log (2026-07-03):** shipped end-to-end on the mock engine + Supabase code path in six
> commits (21A–21F, branch `phase-21-demographics-ros`). 358 tests green, `tsc` clean, builds pass.
> Question bank: 301 auto-converted symptom questions + hand-authored follow-ups/history/genetics for
> all 12 systems (**clinical content needs clinician review** — isolated in commit 21B(2)). Two
> deviations from spec, both deliberate: no mock-DB storage-key bump (`normalizeDatabase` heals old
> blobs without wiping local data), and complaint→system routing gained a longest-contained-term
> fallback because real chief complaints are free text ("Acute chest pain"). Two hardening items
> pulled forward/added after live verification: hydration tolerates tables missing from the hosted
> schema (42P01/PGRST205 → warn + empty, instead of silently falling back to seed data), and
> `ros_responses` outbox upserts land on `(visit_id, question_key)` so concurrent offline answers
> converge. **⚠️ Deploy coupling:** apply `packages/db/migrations/2026-07-phase21-demographics-ros.sql`
> to hosted **before** deploying this app version — patient/consultation rows now carry new columns
> that the old hosted schema rejects (writes would queue, not land). Docker integration suites
> (`test:rls` etc.) extended but not run this session (no Docker); run before the hosted apply.

**Goal:** give the doctor a **complaint-driven Review of Systems** and a full **patient
demographic/clinical-background** record, so a consultation captures the same structured signal a
clinician gathers on paper — presenting complaint → the systems worth reviewing → the specific
questions for those systems (symptoms **plus** the relevant history and genetics) → a compiled
narrative that guides investigations and diagnosis. Flagged by a practicing nurse: CareFlow captures a
free-text SOAP note but has no structured ROS and no past-medical / family / social history, so the
doctor loses the reasoning trail that decides what to test for.

**Design principle — select, don't type.** Every question that *can* be answered by a tap is a
selectable control (Yes/No, option chips, multi-select, severity scale, duration stepper, date
picker). Free text is reserved only for genuine "other, specify" cases. Follow-up questions appear
only when the parent is answered positively, so a negative costs one tap and reveals nothing.

**Design principle — a system contains everything.** Each body system is a self-contained **module**
holding its complete question set (symptoms, their follow-ups, and the pertinent history/genetics for
that system). The chief complaint auto-opens the relevant module(s); the doctor can add **any** of the
12 systems at will and skip anything. As answers are selected, the block **compiles a readable patient
report** per system (positives, pertinent negatives, family history) that folds into the consultation
note.

**Why now / what it builds on:** `apps/web/data/clinical-terms/subjective.json` already holds **301
symptom terms, each tagged with a `system`, bilingual EN/FR** across the 12 systems (Cardiac,
Respiratory, GI, GU, Neuro, ENT, Eyes, Skin, Musculoskeletal, Psych, Obstetric/Gynae, General). That
tagged vocabulary is the **seed of the ROS question bank** — each term becomes a boolean question in
its module. The full design rationale lives in `DEMOGRAPHICS_ROS_DESIGN.md` (repo root); this phase is
the execution checklist.

**Scope:** the doctor's consultation surface (`components/live-board/patient-drawer.tsx`, doctor
section) for ROS; intake + drawer for demographics/background. Reuses every existing pattern —
`allergies` (patient-level table), `consultations`/`diagnoses` (visit-level), `clinical_terms` (seed
files), `TermChips` (autocomplete), the four-layer data change (schema → shared types → mockStorage →
supabaseData), offline `syncQueue`, optimistic-concurrency `version`, audit triggers, tenant RLS.

**Prerequisites:** none blocking. Mergeable after Phase 18 (Supabase cutover) is live; UI ships on the
`mockStorage` engine first, Supabase parity follows (sub-phase F).

### Decisions (locked)

* **ROS answers are stored structured** (one row per answered question), **not** free text — queryable
  for reports and future decision-support. Chosen over a JSONB blob on `consultations`.
* **Clinical background is full-scope** on day one: past medical, past surgical, family/genetic,
  social, obstetric/gynae, medication, immunization — one patient-level `patient_history` table
  distinguished by a `type` enum (mirrors `care_plan_items.kind`).
* **Background is patient-level** (persists across visits, pre-fills on return); **ROS answers are
  visit-level** (a snapshot of *this* encounter).
* **The question bank is reference data as bilingual seed files** (`data/ros/<system>.json`), loaded
  in-memory exactly like `clinical_terms` — so questions are added/edited by shipping a file, **no
  migration**. A per-hospital DB-backed override table is deferred (parking lot).
* **Denormalize for history-safety.** Each `ros_responses` row snapshots `question_text` and a
  localized `answer_label` (like `diagnoses.description` beside `icd10_code`), so editing the bank
  never rewrites past encounters.
* **The compiled ROS narrative gets its own `consultations.ros_summary` column** (cleaner than
  appending into `subjective`); the structured rows remain the source of truth, the summary is derived
  on save.
* **Follow-ups are one level deep** (parent → follow-up) in v1. Obstetric/Gynae questions are
  `sex`-gated by default but always addable.

### Data model — enums (`packages/db/schema.sql`, section 1, idempotent idiom)

* [x] Add the enums (place beside the existing `allergy_*` enums, `~schema.sql:112`):

```sql
-- Body system — the ROS axis. Mirrors the `system` values in the clinical-term
-- library (data/clinical-terms/subjective.json) so a subjective term routes to its module.
do $$ begin
  create type body_system as enum (
    'general','cardiac','respiratory','gi','gu','neuro',
    'ent','eyes','skin','musculoskeletal','psych','obstetric_gynae'
  );
exception when duplicate_object then null; end $$;

-- How a bank question is answered → which selectable control renders and how the value is stored.
-- boolean | single_select | multi_select | scale | duration | numeric | date | text
do $$ begin
  create type ros_answer_type as enum (
    'boolean','single_select','multi_select','scale','duration','numeric','date','text'
  );
exception when duplicate_object then null; end $$;

-- Question kind — lets one system module carry symptoms AND its pertinent history/genetics.
do $$ begin
  create type ros_question_kind as enum ('symptom','history','genetic');
exception when duplicate_object then null; end $$;

-- Patient background/history record type (one shared patient-level list).
do $$ begin
  create type patient_history_type as enum (
    'past_medical','past_surgical','family','social',
    'obstetric_gynae','medication','immunization'
  );
exception when duplicate_object then null; end $$;

-- Marital status — demographic context.
do $$ begin
  create type marital_status as enum (
    'single','married','partnered','divorced','widowed','unknown'
  );
exception when duplicate_object then null; end $$;
```

### Data model — demographic columns on `patients`

* [x] Additive, idempotent (safe to re-apply `schema.sql`):

```sql
alter table patients add column if not exists occupation              text;
alter table patients add column if not exists marital_status          marital_status not null default 'unknown';
alter table patients add column if not exists emergency_contact_name  text;
alter table patients add column if not exists emergency_contact_phone text;
```

*(Age needs no column — intake already derives a placeholder DOB from approximate age via
`approximateDob` in `intake/page.tsx`.)*

### Data model — `patient_history` (patient-level, modeled on `allergies`)

* [x] New table (place after `allergies`, `~schema.sql:464`):

```sql
-- Patient-level clinical background. Keyed to the patient (not a visit) because history
-- persists across encounters — pre-filled on every return visit (review-and-update, not re-enter).
-- `detail` (jsonb) carries type-specific structured fields without a table per type:
--   social  → {tobacco_pack_years, alcohol, drugs}
--   obstetric_gynae → {gravida, para, lmp}
--   family  → {relation, condition}
create table if not exists patient_history (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null references hospitals(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  type         patient_history_type not null,
  description  text not null,   -- "Type 2 diabetes", "Appendectomy 2015", "Mother — breast cancer"
  detail       jsonb,
  onset        text,            -- coarse: "2015", "childhood", "since 2020"
  is_active    boolean,         -- past_medical: still active? null = n/a
  noted_by_id  uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

### Data model — `ros_responses` (visit-level, one row per answered question)

* [x] New table (place after `diagnoses`, `~schema.sql:516`):

```sql
-- A single answered ROS question for one encounter. Rows exist only for questions the doctor
-- answered — absence = "not asked". `answer_value` (jsonb) holds any answer shape; `answer_label`
-- is the denormalized, localized, printable answer; `question_text` snapshots the prompt so bank
-- edits never rewrite history (same denormalization principle as diagnoses.description).
create table if not exists ros_responses (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  visit_id        uuid not null references visits(id) on delete cascade,
  consultation_id uuid references consultations(id) on delete set null,
  system          body_system not null,
  question_key    text not null,      -- stable bank id, e.g. "cardiac.chest_pain.character"
  kind            ros_question_kind not null default 'symptom',
  question_text   text not null,      -- snapshot of the prompt at answer time
  answer_type     ros_answer_type not null,
  -- answer_value by type: boolean→true|false · single_select→"crushing" · multi_select→["nausea"]
  --   scale→"moderate" · duration→{value,unit} · numeric→{value,unit} · date→"2026-06-14" · text→"…"
  answer_value    jsonb not null,
  answer_label    text not null,      -- localized human-readable answer for the report
  note            text,               -- optional free qualifier
  recorded_by_id  uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (visit_id, question_key)     -- re-answering updates in place
);
```

* [x] Add the compiled-narrative column to `consultations`:

```sql
alter table consultations add column if not exists ros_summary text;
```

### Data model — indexes, triggers, RLS (register in every existing loop — no new machinery)

* [x] Indexes (mirror `idx_allergies_*` / `idx_consultations_*`, `~schema.sql:796`+):

```sql
create index if not exists idx_patient_history_patient  on patient_history(patient_id);
create index if not exists idx_patient_history_type     on patient_history(type);
create index if not exists idx_patient_history_hospital on patient_history(hospital_id);
create index if not exists idx_ros_responses_visit      on ros_responses(visit_id);
create index if not exists idx_ros_responses_system     on ros_responses(system);
create index if not exists idx_ros_responses_hospital   on ros_responses(hospital_id);
```

* [x] Add `'patient_history'` and `'ros_responses'` to the string arrays in **each** loop:
  * `set_updated_at` trigger loop — **6a** (`~schema.sql:837`).
  * `bump_version` / `version` column loop — **6a-bis** (`~schema.sql:858`) → both get optimistic-concurrency `version`.
  * `audit_trigger` loop — **6b** (`~schema.sql:877`) → both are audited (insert/update/delete).
  * RLS `enable row level security` loop (`~schema.sql:1060`).
  * **9a** universal "read for staff" loop (`~schema.sql:1093`) → all active staff can read.
* [x] Write policies (mirror `clinical write allergies`, `~schema.sql:1200`; add after it):

```sql
-- History: recorded/updated by clinicians (nurse at intake, doctor in consult).
drop policy if exists "clinical write patient history" on patient_history;
create policy "clinical write patient history" on patient_history
  for all to authenticated
  using (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('nurse','doctor','admin') and hospital_id = current_hospital_id());

-- ROS: authored by the doctor during the consultation.
drop policy if exists "doctor write ros" on ros_responses;
create policy "doctor write ros" on ros_responses
  for all to authenticated
  using (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id())
  with check (current_staff_role() in ('doctor','admin') and hospital_id = current_hospital_id());
```

### Question bank — seed files + loader (`data/ros/`, `lib/ros/`)

* [x] One bilingual JSON file per system: `apps/web/data/ros/<system>.json` (12 files). Each entry is a
  self-describing question node; the same file carries the system's **symptom, history, and genetic**
  questions so the module is complete. Node shape:

```jsonc
{
  "key": "cardiac.chest_pain",          // stable id, snapshotted onto answers
  "system": "cardiac",
  "kind": "symptom",                     // symptom | history | genetic
  "prompt_en": "Chest pain?",
  "prompt_fr": "Douleur thoracique ?",
  "type": "boolean",
  "key_question": true,                  // high-yield → shown first / in quick review
  "sex": null,                           // 'female' to gate obstetric, else null
  "report_phrase_en": "chest pain",      // used to compile the narrative
  "report_phrase_fr": "douleur thoracique",
  "options": [],                         // for *_select / scale (bilingual: value,label_en,label_fr)
  "triggers": [],                        // optional complaint keys that promote this question
  "followups": [                         // one level; revealed by show_if on the parent answer
    { "key": "cardiac.chest_pain.character", "prompt_en": "Character", "prompt_fr": "Caractère",
      "type": "single_select", "show_if": "yes",
      "options": [
        { "value": "crushing", "label_en": "Crushing", "label_fr": "Écrasante" },
        { "value": "sharp",    "label_en": "Sharp",    "label_fr": "Aiguë" },
        { "value": "dull",     "label_en": "Dull",     "label_fr": "Sourde" },
        { "value": "burning",  "label_en": "Burning",  "label_fr": "Brûlante" } ] },
    { "key": "cardiac.chest_pain.radiation", "prompt_en": "Radiation", "prompt_fr": "Irradiation",
      "type": "multi_select", "show_if": "yes",
      "options": [
        { "value": "left_arm", "label_en": "Left arm", "label_fr": "Bras gauche" },
        { "value": "jaw",      "label_en": "Jaw",      "label_fr": "Mâchoire" },
        { "value": "back",     "label_en": "Back",     "label_fr": "Dos" } ] },
    { "key": "cardiac.chest_pain.duration", "prompt_en": "Duration", "prompt_fr": "Durée",
      "type": "duration", "show_if": "yes" }
  ]
}
```

  And a history/genetics node in the same file:

```jsonc
{ "key": "cardiac.fhx_early_cad", "system": "cardiac", "kind": "genetic",
  "prompt_en": "Family history of heart disease or early cardiac death?",
  "prompt_fr": "Antécédents familiaux de maladie cardiaque ou de mort subite précoce ?",
  "type": "boolean", "key_question": true,
  "report_phrase_en": "family history of premature coronary disease",
  "report_phrase_fr": "antécédents familiaux de coronaropathie précoce" }
```

* [x] **Seed-conversion script** (`scripts/ros-seed-from-subjective.ts`, one-off): read
  `data/clinical-terms/subjective.json`, and for each term emit a `boolean` symptom question
  `{ key: "<system>.<slug(term_en)>", prompt_en: "<term_en>?", prompt_fr: "<term_fr> ?", type:
  "boolean", kind: "symptom" }` into the matching `data/ros/<system>.json`. Gives all 12 modules a
  complete first-pass symptom set automatically (301 questions). Follow-ups + history + genetics are
  then authored per system (clinician-reviewed content — the clinical core of this phase).
* [x] **Loader** `apps/web/lib/ros/index.ts` (mirror `lib/clinical-terms/index.ts`): load all
  `data/ros/*.json`, stamp `system` from filename, validate with a `zod` schema, flatten follow-ups,
  expose `getSystemModule(system)`, `getQuestion(key)`, `getAllSystems()`. Unit tests in
  `lib/ros/index.test.ts`: every file parses, keys are unique, options present for `*_select`/`scale`,
  `sex` values valid.
* [x] **Routing map** `apps/web/lib/ros/routing.ts`: `systemForTerm(term)` (normalize the
  `clinical_terms` `system` string: lowercase, `/`→`_`, `"Obstetric/Gynae"`→`obstetric_gynae`) and a
  curated `SECONDARY_SYSTEMS: Partial<Record<string, BodySystem[]>>` (e.g. chest-pain complaint →
  `['respiratory','gi']`). v1 ships primary-system routing (free from existing tags); the curated
  secondary map is a Phase-F refinement.
* [x] **Narrative compiler** `apps/web/lib/ros/compile.ts`:
  `compileRosNarrative(responses: RosResponse[], locale): string` — pure, grouped by system, using each
  question's `report_phrase` + `answer_label`, separating positives / pertinent-negatives /
  history-genetics into readable prose. Unit-tested with a fixed response set → expected string (EN+FR).

### Shared types (`packages/shared/types/healthcare.ts`)

* [x] Add ID aliases `PatientHistoryId`, `RosResponseId`; unions `BodySystem`, `RosAnswerType`,
  `RosQuestionKind`, `PatientHistoryType`, `MaritalStatus`; the bank shapes `RosOption`, `RosQuestion`
  (recursive `followups?: RosQuestion[]`, `show_if?`); the answer union
  `RosAnswerValue = boolean | string | string[] | { value: number; unit?: string }`; and interfaces
  `PatientHistory`, `RosResponse` (fields 1:1 with the DDL, nullable server-managed `version?`). Add
  `occupation`, `marital_status`, `emergency_contact_name`, `emergency_contact_phone` to `Patient`;
  add `ros_summary: string | null` to `Consultation`. Also add barrel exports and mirror any changes
  into `packages/shared/types/healthcare.js` if that file is hand-maintained.

### Service layer — `apps/web/services/mockStorage.ts` (what the UI reads today)

* [x] Add `patient_history: PatientHistory[]` and `ros_responses: RosResponse[]` to the `db` shape, the
  collection-key lists (`~:254`/`:307`), and the **hydration guard** (default `[]` for old localStorage
  blobs, `~:232`) — bump the mock-DB storage version key.
* [x] Readers (copy `getAllergiesForPatient` `~:1141` / `getConsultationsForVisit` `~:1194`):
  `getHistoryForPatient(patientId)` (sorted, grouped by `type`), `getRosResponsesForVisit(visitId)`.
* [x] Mutations (copy `addConsultation` `~:2383`, incl. `emitUsage("record_created", …)`):
  `addPatientHistory`, `updatePatientHistory`, `deletePatientHistory`;
  `upsertRosResponse` (unique on `visit_id`+`question_key` → update in place), `clearRosResponse`;
  and on consultation save, compute `ros_summary` via `compileRosNarrative` and persist it on the
  `Consultation`. Input interfaces `AddPatientHistoryInput`, `UpsertRosInput` beside the existing
  `Add*Input` (`~:757`/`:809`).
* [x] Unit tests mirroring `mockStorage.test.ts`: upsert replaces (not duplicates) a re-answered
  question; clearing removes the row; history CRUD round-trips; `ros_summary` regenerates on save.

### Service layer — `apps/web/services/supabaseData.ts` + offline sync

* [x] Tenant-scoped Supabase reads/writes for `patient_history` and `ros_responses` (select filtered by
  RLS; upsert on the `(visit_id, question_key)` unique). Register both tables' writes with the offline
  **`syncQueue`** (`services/syncQueue.ts`) so ROS answered offline queues and replays, consistent with
  other clinical writes. Respect optimistic-concurrency `version` (retry/refresh on conflict, like
  existing mutations — see `concurrency.integration.test.ts`).

### Intake (`apps/web/app/(app)/intake/page.tsx`)

* [x] Add demographic fields — **Occupation** (text), **Marital status** (`Select`), **Emergency
  contact name/phone** (`Input` + `PhoneInput`, validated with `isValidPhoneNumber` as the existing
  phone is). All optional; keep intake fast.
* [x] Optional **Background** step (collapsible): quick add of past-medical / family / social history
  via the existing autocomplete pattern. Optional — the doctor can complete it in consult.

### UI — Background panel (`components/live-board/patient-drawer.tsx`)

* [x] A collapsible **"Background"** block in the drawer header area (above the SOAP note), using
  theme tokens (`bg-card`, `text-muted-foreground`, `border-border`) and `font-mono` for metrics:
  * At-a-glance strip: **age · sex · occupation · marital status**.
  * History grouped by `type` (Past medical, Surgical, Family, Social, Obstetric/Gynae, Medications,
    Immunizations); each item one tap to edit; `+ add` uses autocomplete; social/obstetric use light
    structured selectors written to `detail`.
  * **Pre-filled from `patient_history`** on return visits → review-and-update. Empty groups render a
    faint `+ add`. Fully FR/EN.

### UI — Review of Systems block (the core surface)

* [x] Render under the SOAP `subjective` field in the doctor section. Each **system = a collapsible
  card module**; answering is tapping. Answer controls by `answer_type`:

  | type | control | typing |
  |---|---|---|
  | `boolean` | Yes / No segmented toggle (3rd state = unasked) | none |
  | `single_select` / `scale` | option chips / segmented | none |
  | `multi_select` | multi-toggle chips | none |
  | `duration` | number stepper + unit dropdown | step only |
  | `numeric` | stepper (+ unit) | minimal |
  | `date` | date picker | none |
  | `text` | inline field — **only** where no option set fits | by design |

* [x] Behaviours:
  * **Complaint-driven open:** primary system (from `systemForTerm(chief complaint)`) auto-expands with
    `key_question`s visible; secondary systems show folded as "(suggested)"; the rest behind "Review
    other systems" — reuse the drawer's lead-vs-folded pattern (`SECTION_ORDER`/`PRIMARY_BY_ROLE`,
    `~patient-drawer.tsx:220`).
  * **Progressive depth:** follow-ups appear only when the parent answer matches `show_if`.
  * **`+ Add system`** dropdown lists all 12; picking one opens its full module. Nothing locked.
  * **"Mark remaining as No"** per system → one tap sets untouched `key_question`s to No (charts a
    negative review without dozens of taps).
  * Optional **note** per answer. Untouched ROS collapses to a one-line summary. Never forced.
  * Each tap calls `upsertRosResponse`; a live **"compiled report ▸"** drawer at the top of the block
    re-renders `compileRosNarrative(...)`.
* [x] **On "Save consultation":** persist the `ros_responses` rows, compute `ros_summary` via the
  compiler, store it on the `Consultation`, and surface it wherever consultations already appear
  (board, printouts, `/reports`). Show `ros_summary` read-only in past-consultation views.
* [x] New reusable component `components/ros/ros-review.tsx` (+ `ros-question.tsx`,
  `ros-answer-control.tsx`) so the block is testable in isolation.

### i18n (`apps/web/i18n/en.ts` + `fr.ts`, `locale-provider`)

* [x] All static labels bilingual (system names, section titles, control labels, "Mark remaining as
  No", "Add system", "Background", history-type labels, demographic field labels). Question prompts +
  options carry `_fr` in the seed files (reuse `term_fr` from `clinical_terms` for the auto-generated
  symptom prompts). The compiled narrative renders in the active locale via the compiler's `locale`
  arg. Guard any resolved-theme/locale reads against hydration mismatch (mount check) per `AGENTS.md`.

### Security (must-haves — verify each)

* [x] **Tenant isolation:** both new tables carry `hospital_id`; every RLS policy ANDs
  `hospital_id = current_hospital_id()`; both added to the RLS-enable + universal-read loops. Extend
  `rls.integration.test.ts` / `tenancy.test.ts` to prove a doctor in hospital A cannot read/write
  hospital B's `patient_history` or `ros_responses`.
* [x] **Role gating:** ROS writable only by `doctor`/`admin`; history by `nurse`/`doctor`/`admin`;
  read by all active staff (`is_staff()`). No client INSERT path bypasses RLS.
* [x] **Input validation:** validate `answer_value` **against its `answer_type`** with a `zod` schema
  per type in `packages/shared/validation` (boolean is bool; `single_select`/`scale` value ∈ options;
  `multi_select` ⊆ options; `duration`/`numeric` = `{value:number, unit:enum}`; `date` = ISO; `text`
  length-capped). Reject unknown `question_key`s not in the loaded bank. Constrain `detail` jsonb to
  the documented `HISTORY_DETAIL_SHAPES` per `patient_history.type`. This prevents malformed/injected
  jsonb even if a client is tampered with (second wall behind RLS).
* [x] **Audit + provenance:** both tables in the `audit_trigger` loop (who changed what, when);
  `recorded_by_id` / `noted_by_id` set server-side from the acting staff, never trusted from the
  client. All timestamps server-set (`now()`), never client clock.
* [x] **PII discipline:** family/social/genetic history is sensitive — never logged to
  `telemetry.ts`/`usage_events` beyond a bare `record_created` counter (no content, no patient
  identifiers), consistent with the existing "write-only counter, no PII" telemetry rule.

### Stability & performance

* [x] **Optimistic concurrency:** both tables get the `version` column + `bump_version` trigger; the
  ROS block refreshes-and-retries on a version conflict (two clinicians on one visit). Cover in
  `concurrency.integration.test.ts`.
* [x] **Offline-first:** ROS/history writes go through `syncQueue` (queue + replay), matching every
  other clinical write; the drawer stays usable offline. Cover in `syncQueue.test.ts` /
  `sync-hydrate.test.ts`.
* [x] **Hydration safety:** new mock collections default to `[]`; bump the mock-DB version key so old
  localStorage blobs migrate without crashing accessors (`~mockStorage.ts:232`).
* [x] **History-safe denormalization:** `question_text` + `answer_label` snapshots mean bank edits or
  a deleted question never corrupt a past encounter's report.
* [x] **Query cost:** the `(visit_id, question_key)` unique index and `idx_ros_responses_visit` keep
  per-visit reads and upserts O(log n); the bank is in-memory (no per-render DB hit). ROS narrative is
  compiled from already-loaded rows — no extra round-trip.
* [x] **Bundle:** 12 seed JSON files are static imports tree-shaken like `clinical_terms`; lazy-load a
  system module's follow-up options only when its card expands if payload grows.

### Seed sample data (so the drawer demos populated)

* [x] Give 2–3 seeded patients a realistic **background** (e.g. Daniel Owusu — past_medical "Type 2
  diabetes" active, family "Father — hypertension", social "Non-smoker, occasional alcohol").
* [x] Seed one open visit (e.g. Grace Mensah, chief complaint "Chest pain") with a partial **ROS**:
  Cardiac — chest pain = Yes (character crushing, radiates left arm, duration 2h), palpitations = No,
  FHx early CAD = Yes (father); Respiratory — cough = No, dyspnoea = No. Confirm the compiled
  `ros_summary` reads correctly in EN + FR.

### Verify (end-to-end)

* [x] Apply `packages/db/schema.sql` clean (idempotent re-run OK); enums, tables, indexes, triggers,
  RLS all present; `patient_history` + `ros_responses` appear in the updated_at/version/audit/RLS
  loops.
* [x] As a **doctor**: open a patient with chief complaint "Chest pain" → Cardiac (and suggested
  Respiratory) auto-expand; answering questions is all taps; follow-ups reveal only on Yes; "Mark
  remaining as No" charts negatives; "+ Add system" opens any module; the live compiled report updates
  per answer; Save persists rows + `ros_summary`, visible on the board/printout/reports.
* [x] **Background** panel shows/edits history, pre-fills on the next visit; demographics captured at
  intake and shown in the drawer.
* [x] **Security:** cross-tenant read/write blocked (RLS tests green); non-doctor cannot write ROS;
  malformed `answer_value` / unknown `question_key` / bad `detail` rejected by validation; audit rows
  written; `recorded_by_id` server-set.
* [x] **Stability:** offline answer queues + replays; version conflict handled; old localStorage blob
  hydrates without error; bank + loader unit tests, compiler tests, and service tests green.
* [x] `tsc` clean across the monorepo; FR + EN pass with no overflow; both light + dark mode correct.

### Delivery sequence (each sub-phase independently shippable + verifiable)

* [x] **A — Data foundation:** enums, `patients` columns, `patient_history` + `ros_responses` +
  `consultations.ros_summary`, loop registrations, RLS, indexes; shared types. Apply schema.
* [x] **B — Question bank + loader:** conversion script (301 symptom questions), authored
  follow-ups/history/genetics per system, `lib/ros` loader + routing + compiler, unit tests. *(Clinical
  content core — do carefully.)*
* [x] **C — Mock service parity:** `mockStorage` readers/mutations/inputs/hydration + tests.
* [x] **D — Background UI:** demographics at intake + Background panel in drawer (ships value alone).
* [x] **E — ROS UI + auto-report:** `ros-review` block with selectable controls, complaint routing,
  follow-up reveal, "Mark remaining as No", `+ Add system`, live `compileRosNarrative`; Save writes
  rows + `ros_summary`.
* [x] **F — Supabase parity + hardening:** `supabaseData` writes + `syncQueue` + concurrency; curated
  secondary-system routing map; RLS/tenancy/validation tests; reporting surfaces.

> **Reference:** full rationale, alternatives considered, and open decisions in
> `DEMOGRAPHICS_ROS_DESIGN.md` (repo root). Open decisions carried into execution: (1) narrative in
> `ros_summary` column [chosen] vs appended to `subjective`; (2) seed-file bank [chosen] vs per-hospital
> `ros_questions` table [parking lot]; (3) one-level follow-ups [chosen]; (4) primary routing in E,
> curated secondary map in F; (5) obstetric `sex`-gated-but-addable [chosen]; (6) background writable by
> nurse+doctor [chosen].

## 🅿️ Future / parking lot (out of current scope)

* **Payments & insurance** — actual payment processing (mobile money), NHIS/insurance claims, and
  formal receipts/accounting. The *billing/invoicing* half (price catalog, charge accrual, printable
  bill) is now promoted to **Phase 16.9**; collecting the money stays parked.
* **Patient-facing access** — a portal or QR on the booklet linking to the hospital record.
* **Inter-hospital referral exchange** — sharing a discharge summary with another facility.
* **Appointments / scheduling** for outpatient clinics.
* **Notifications** — real SMS/email follow-up (currently simulated to console).

---

## 🔎 Things you may have left out — flagged for your attention

These came up while mapping your description to the model. None block current work, but decide on
them before they become expensive to retrofit:

1. **Transfers between wards/doctors.** A patient often moves ICU → general ward, or changes
   attending doctor. Model this as a first-class event (it matters for bed history and audit), not
   by silently editing the admission. *Recommend a `transfers` table in a later phase.*
2. ~~**Allergies & current medications.** Safety-critical and expected on every chart. A doctor
   prescribing without seeing allergies is a real hazard.~~ ✅ **Done (2026-05-31).** Patient-level
   allergy record (persists across visits) with a `no_known_allergies` flag that distinguishes
   *confirmed none* from *not yet assessed*. Surfaced as an always-visible banner at the top of the
   patient drawer (severity-ranked, worst-first) and a drug-allergy caution inside the prescribing
   form. Deliberately a **visible warning the doctor reads**, not an auto-blocking interaction check.
   Current-medications view is covered by the existing prescriptions/MAR list.
3. ~~**Triage acuity / priority.** Who gets seen first? An emergency-severity level (e.g.
   1=critical … 5=non-urgent) on the visit makes the queue meaningful.~~ ✅ **Done (2026-06-02, Phase
   14.)** `TriageLevel` (1 critical … 5 non-urgent) on `Visit`, seeded per visit type, shown as a
   colored acuity badge on board cards and settable at intake.
4. **"Came only for medication / never admitted" path.** You mentioned this explicitly — it's the
   outpatient path in Phase 6/8. Make sure the board and reports count these separately from
   admissions, or your numbers will be wrong.
5. **Deceased outcome.** Not every visit ends in discharge or follow-up. The schema includes a
   `deceased` disposition; make sure the board and reports handle it respectfully and correctly.
6. **Consent & document capture.** You can scan the paper booklet / consent / ID into the
   `patient-documents` storage bucket so the hospital's digital record references the physical one.
7. **Concurrency / two staff editing the same patient.** With real multi-user backend, decide how
   to handle simultaneous edits (last-write-wins vs. optimistic locking). Audit trail mitigates but
   doesn't prevent it.
8. **Time zones & clock source.** All timestamps should be server-set (`now()` in Postgres),
   already the case in the schema — avoid trusting the client clock for clinical records.
9. **Data retention & backups.** Medical records carry legal retention requirements; plan backups
   and a retention policy (Phase 14).

---

## 📦 Deliverables in this repo

* `types/healthcare.ts` — current (Phase 1–5) data models; to be expanded in Phase 6.
* `services/mockStorage.ts` — localStorage mock engine (current persistence).
* `supabase/schema.sql` — **complete, copy-paste-ready Postgres schema** for Supabase: all tables,
  enums, indexes, triggers (updated_at, audit, bed-occupancy), auto-generated MRN, reporting views
  (`ward_occupancy`, `admission_report`), private storage buckets, and full role-based RLS. Run it
  in the Supabase SQL Editor, then create staff logins in Auth and insert matching `staff` rows
  (`staff.user_id = auth.users.id`).

---

## 📈 Update Logs

When working with Claude Code, log completed steps, timestamps, and architectural shifts here.

* 2026-07-02: **Added Phase 21 — Patient Demographics & Review of Systems (ROS).** Execution-ready
  spec (no code yet) for a complaint-driven ROS and full patient background/demographic record. Raised
  by a practicing nurse: CareFlow has a free-text SOAP note but no structured ROS and no
  past-medical/family/social history, losing the reasoning trail that decides what to test for. Design:
  **select-don't-type** question controls; each body system is a self-contained **module** (symptoms +
  history + genetics); the chief complaint auto-opens the relevant modules and the doctor can add any
  of the 12; answers compile a readable **`ros_summary`** narrative. Reuses existing patterns — the
  301 system-tagged bilingual terms in `data/clinical-terms/subjective.json` seed the question bank
  (bilingual JSON seed files like `clinical_terms`, no migration to grow); `allergies` (patient-level)
  and `consultations`/`diagnoses` (visit-level) as table models; the four-layer change (schema → shared
  types → mockStorage → supabaseData); `syncQueue` offline, `version` concurrency, audit + tenant RLS.
  New: `patient_history` + `ros_responses` tables, `body_system`/`ros_answer_type`/`ros_question_kind`/
  `patient_history_type`/`marital_status` enums, demographic columns on `patients`, `consultations.
  ros_summary`. Full DDL, types, service wiring, UI, security (per-type `zod` validation of
  `answer_value`, role gating, cross-tenant tests, PII-safe telemetry), stability (offline/concurrency/
  hydration/denormalization), i18n, seed, verify, and a 6-step delivery sequence (A–F) are in the phase;
  rationale + alternatives in `DEMOGRAPHICS_ROS_DESIGN.md` (repo root).

* 2026-06-02: **Added Phase 18.5 — Verified Tenant Onboarding.** Before a hospital is created, the
  founding admin must verify identity via **Google sign-in or email OTP**; only then do they fill the
  hospital-creation form. Separates user identity from tenant creation (replacing the current
  create-user-at-signup), preventing junk/unverified tenants and tying each account to a recoverable
  identity. Built on Supabase `signInWithOAuth` / `signInWithOtp` + a `SECURITY DEFINER`
  `create_hospital_and_admin` RPC. Scoped to the founding admin only — staff logins stay
  admin-created (Phase 17). Verification is limited to **email OTP + Google only** (SMS OTP is out of
  scope — avoids SMS-provider cost/complexity). No code changed — phase spec only.

* 2026-06-02: **Marked Phases 17 & 18 complete; added Phase 19.** Reconciled the roadmap with the code:
  **Phase 17 (multi-tenancy)** and **Phase 18 (Supabase backend)** are implemented and verified (`tsc`
  clean, 258 tests pass) — hospitals table + `hospital_id` everywhere, `current_hospital_id()` RLS,
  per-hospital storage, real Supabase Auth + data layer (`services/supabaseData`/`supabaseAuth`,
  `lib/supabase/*`), local-first sync, optimistic concurrency, and isolation/RLS/storage integration
  tests; admin-creates-staff via a server action using the service-role admin client; marketing
  `(marketing)` + authenticated `(app)` route split. Honest carve-outs left open: full
  suspend→restrict subscription gating (Phase 17, `[~]`) and the formal data-privacy/retention/backup
  review (Phase 18, `[~]`). Added **Phase 19 — Platform Owner / Super-Admin Console**: a cross-tenant
  owner dashboard built as a **separate app in a new monorepo** (`apps/web` + `apps/owner-console` +
  `packages/shared`), reading via a privileged server path on aggregate **telemetry, not PHI**, with
  the metrics + management actions (incl. completing the suspend gating). No app code changed — status
  reconciliation + new phase spec only.

* 2026-06-02: **Added Phase 16.10 — Clinical Term Autocomplete & Library.** Type-ahead over curated
  bilingual (FR/EN) medical-term libraries so doctors who type slowly enter notes by selecting from a
  pop-up menu, across six categories: subjective, examination, assessment, plan, medication, and
  **investigations** (lab + imaging + procedure combined, each term carrying an `order_type` so the
  created Order gets the right type). Two-layer design: a static, bundled, offline **seed** (one JSON
  file per category under `data/clinical-terms/`) plus a **learned** layer (custom terms + usage-based
  ranking) that grows with use. **Drop-in extensibility is explicit:** the loader statically imports the
  six files, so pasting more terms into a file is picked up on the next build with no code change —
  matching the user's workflow (they've pre-generated the lists and will paste them into the files
  Claude Code surfaces). Performance confirmed fine at ~700/category via lazy-load + result cap +
  debounce. Learned terms get `hospital_id` in Phase 17. No code changed — phase spec only.

* 2026-06-09: **Phase 16.9 — Billing & Invoicing shipped end-to-end.** Implemented the full module: a
  pure computation layer (`components/billing/billing.ts` — seed catalog, `ref_code`-keyed resolvers,
  ward-segment/night math from the transfers timeline, idempotent auto-charge derivation, bill summary)
  with 14 unit tests; service layer in `mockStorage.ts` (`billable_items` + `charges` collections,
  `recalculateAutoCharges` idempotent reconcile, manual line + discount + per-line status + `settleBill`,
  sample charges seeded for **every** visit); `/billing` master-detail screen + `/billing/prices` catalog
  admin (admin + receptionist), nav entry; a bill-PDF exporter reusing the visit-summary jsPDF helpers;
  full EN/FR i18n + `formatXaf`; and the Supabase schema (`billable_items`/`charges` enums, tables,
  indexes, triggers, admin+receptionist RLS — **applied to the live DB on 2026-06-09, with sample
  billing data seeded for all 51 production demo visits**).
  **Deviations from the original spec, decided with the user:** (1) **live & free for all hospitals**, not
  a paid-tier toggle; (2) **informational only — settling ticks `is_financial_cleared` as a convenience
  but adds no discharge-blocking logic** (the gate is unchanged); (3) catalog priced via a semantic
  `ref_code` + ward-name bed resolution rather than `department_id`/`ward_id` columns, each charge
  carrying a `source_ref_id` for idempotent reconciliation. Verify gate green: `tsc` clean, **234 tests**
  (incl. a full-journey billing leg), eslint clean, `next build` green with both billing routes.

* 2026-06-02: **Added Phase 16.9 — Patient Billing & Expenditure Tracking (optional module).** An
  optional, paid-tier, per-hospital-toggleable module that prices every chargeable activity by
  department and auto-accrues a patient's bill from events already recorded (consultation, orders,
  prescriptions, bed-nights per ward segment via the transfers timeline, nursing/day, procedures), then
  exposes a `/billing` screen (admin + receptionist) to discount, add manual lines, total, and export a
  PDF — with settling the bill flipping `is_financial_cleared` so unpaid blocks discharge. Locked
  decisions: small common-drugs price list + manual; time-based charges computed at billing time;
  admin+receptionist billing actors (all discounts/manual lines audited); per-visit bill scope; integer
  XAF. Data model = `billable_items` (catalog) + `charges` (ledger, snapshotted prices); both get
  `hospital_id` in Phase 17. Scope is invoicing only — payment collection/insurance stay parked.
  Includes a seed price catalog so it demos with real numbers. No code changed — phase spec only.

* 2026-06-07: **Phase 17 — mock multi-tenancy + the SaaS front door (signup / login / landing / auth
  boundary).** Made the mock a real pooled-tenant store, then built the public entry. **Tenancy:** a
  module-level "active hospital" scopes every read (`loadScoped()`) and stamps every create-mutator
  (`hospital_id`); added `hospitals` directory + `createHospital`; control-plane reads (the hospital
  list, `getStaffForHospital`, session resolution) stay deliberately cross-tenant. **Auth:** new
  `services/mockAuth` (localStorage session) + `AuthProvider` (owns `setActiveHospitalId`);
  `role-provider` refactored to derive purely from the auth context. **Front door:** route groups
  `(marketing)` (public `/` landing, `/signup`, `/login` — French-first, new `marketing`/`auth`/
  `account` i18n) and `(app)` (dashboard moved to `/dashboard` behind `RequireAuth` + AppShell, now
  with an account/sign-out menu). **Bug caught in verification (important):** the Live Board read the
  *unscoped* store, so a brand-new hospital saw the demo caseload — `getActiveVisits`/`getOpenOrders`/
  `getActiveAdmissions` and the per-parent reads were on `loadDatabase()`; converted all 16 chained
  tenant reads to `loadScoped()` and added a regression test asserting the board/queue reads are
  scoped. Also fixed a Base UI crash (`DropdownMenuLabel` must sit inside a `DropdownMenuGroup`).
  Browser-verified both directions (fresh tenant → 0-active board; demo → full caseload), signup →
  account menu → sign-out → login. `tsc` clean, **191 tests** green, production build OK. This clears
  the Phase 17 mock-side verify gate; live-DB cross-tenant tests under real RLS remain for Phase 18.
* 2026-06-07: **Phase 17 — tenant-scoped schema authored (`supabase/schema.sql`).** Made the entire
  schema multi-tenant in one pass: added a `hospitals` (account/tenant) table + `subscription_status`
  enum; added a non-null `hospital_id uuid references hospitals(id) on delete cascade` to all 18 domain
  tables (departments, wards, beds, staff, patients, allergies, visits, consultations, diagnoses,
  orders, results, prescriptions, medication_administrations, treatment_records, admissions, transfers,
  care_plan_items, care_plan_entries) plus a nullable `hospital_id` on `audit_log`. Converted the
  formerly-global uniques to **per-tenant composites** (`unique(hospital_id, code/name)` on departments,
  `unique(hospital_id, name)` on wards, `unique(hospital_id, mrn)` + `unique(hospital_id, national_id)`
  on patients, `unique(hospital_id, email)` on staff; `beds` keeps `unique(ward_id, label)` — already
  tenant-isolated via ward). Added the `current_hospital_id()` SECURITY DEFINER helper, a
  `hospital_id = current_hospital_id()` predicate on **every** RLS policy (+ `hospitals`-table policies
  for self-read and admin self-update; no client INSERT — signup is service-role), per-tenant storage
  paths (`(storage.foldername(name))[1] = current_hospital_id()::text` on read/write/update), tenant
  `idx_<table>_hospital` indexes on all tables, `security_invoker` views exposing `hospital_id`, and
  `hospital_id` capture in the audit trigger. **Schema-only** (no live Supabase DB) — verified by review
  + grep. Cross-tenant isolation tests remain unchecked (need a live DB; deferred to Phase 18 verify).
* 2026-06-02: **Split Phase 17 into multi-tenancy + cutover.** Before the backend cutover, added
  **Phase 17 — Multi-Tenant Foundation, Hospital Accounts & Onboarding**: CareFlow becomes a SaaS where
  each hospital is an isolated tenant. Plan = a `hospitals` (account) table + a `hospital_id` FK on
  every domain table + a `current_hospital_id()` RLS helper with a `hospital_id = current_hospital_id()`
  predicate on **every** policy, per-tenant uniqueness (patient ID / bed / department names scoped per
  hospital), per-tenant storage prefixes, hospital signup (creates the hospital + founding admin),
  admin-creates-staff logins via a Supabase Edge Function (username+password for staff without email),
  subscription gating tied to monetization, a public French-first landing page, and **automated
  cross-tenant isolation tests** (the make-or-break). The former backend cutover is now **Phase 18**
  (the final phase), updated to reference the tenant-scoped schema. Decided tenancy model: pooled
  (shared tables + `hospital_id` + RLS); dedicated DB per hospital is a future premium option. No code
  changed — phase spec only.

* 2026-06-02: **Phase 16.5 COMPLETE — demo-readiness QA pass (drawer confirm + FR layout sweep).**
  The last polish before the backend. **(1) Role-led drawer confirmed:** verified in-browser that the
  `PatientDrawer` opens to each role's primary action with everything else folded under "More"
  (nurse → vitals/care-stage, reception → reconcile/placement, doctor → consult console; admin sees all
  expanded). No code change needed — the Phase-14 `PRIMARY_BY_ROLE` lead sets already land in practice,
  the Allergies safety banner stays pinned first for every role, and the full-width 44px-tall "More"
  expander is a good mobile tap target. **(2) French layout/overflow sweep:** walked all 9 pages in FR
  at desktop (1280) and mobile (390) — strings are complete (FR runs ~15–20% longer, so the risk was
  visual, not missing keys). Two layout fixes: (a) the header facility title (`app-shell.tsx`) gained
  `truncate` so "General Hospital" / "Hôpital Général" can't spill onto the global-search button when
  the header is tight; (b) the floor-map ward-card header (`app/floor-map/page.tsx`) now wraps the
  tally chips + edit button *below* the ward name on narrow cards via a `@container` query
  (`@[30rem]:flex-1`) — previously the title column collapsed to ~27px and truncated "Emergency Bays"
  to a single letter on mobile. That bug was locale-independent (the overflow was actually *worse* in
  EN) but surfaced during the FR pass; the container query keeps the inline shared-row layout on wide
  cards while wrapping on narrow ones, correct at every width regardless of the surrounding grid.
  **(3) en/fr key-parity test:** `i18n/parity.test.ts` (3 tests) fails CI with a readable diff if the
  dictionaries ever drift, so a missing French string surfaces as a test failure rather than a silent
  English fallback mid-demo. **(4) Housekeeping:** removed the `@rollup/rollup-linux-arm64-gnu` and
  `@oxc-parser/binding-linux-arm64-gnu` devDependencies (Linux-arm64-only sandbox binaries that break
  `npm install` on macOS / CI). **Verify:** 153/153 tests pass; `tsc --noEmit` exit 0; floor-map clean
  at 390 / 768 / 1280 in both locales. Frontend-only — Phase 17 (Supabase backend) is next and final.
* 2026-06-02: **Phase 16 COMPLETE — intake simplifications, demo mode & the no-instructions
  walkthrough.** Closed the final three guidance items. **(1) Intake simplifications:** the intake DOB
  field gains an "Exact date unknown? Enter age instead" toggle (`app/intake/page.tsx`) — entering an
  approximate age stores a `YYYY-01-01` DOB via a small `approximateDob(years)` helper (0 < years ≤
  130). The `PatientDrawer` now states outcomes in plain language: transfers confirm with "Moved to
  {placement}." / "Now under {doctor}." (green success line), and discharge gets an explicit confirm
  step ("This closes {name}'s visit and moves them off the board. Their record stays on file.") before
  it fires. `SyncStatus` is fully localized, including the reassuring offline copy "Saved on this
  device. Will sync when the internet returns." Discharge blockers moved from hardcoded English to
  i18n keys (`drawer.blocker*`) in `evaluateDischargeReadiness` — a Phase-13 leak fix; the rendering
  component resolves them with `t()`. **(2) Demo mode:** `components/demo/reset-demo.tsx` — a
  confirm-gated card on the Staff page that calls `resetDatabase()` (wipe + reseed + clear the sync
  outbox) and hard-reloads to a known clean state for repeatable demos. New FR/EN `demo` namespace.
  **(3) Verify walkthrough:** browser-confirmed a first-time user can register a patient via the board
  CTA and advance them through triage → consultation → diagnostics → discharge using only the on-card
  "next step" nudges and the discharge confirm step — no instructions needed. New/extended FR/EN
  `intake`, `drawer`, `sync`, `demo` keys (`fr satisfies Messages` enforces parity). Updated 2
  `mockStorage` test expectations to the new blocker keys (**150 pass total**); `tsc --noEmit` clean.
  Fixed one bug found in verification: the drawer's tick-scoped reset effect was wiping the transfer
  confirmation the instant the post-transfer `refresh()` bumped `tick` — split the confirmation/
  confirm-step resets into an `[open, visitId]`-scoped effect. Re-verified EN + FR in-browser (transfer
  confirmation renders, demo reset reseeds to 51 patients with an empty outbox, intake age toggle + sync
  chip + discharge confirm all localized). Frontend-only — no Supabase yet.
* 2026-06-02: **Phase 16 — comprehension & demo-readiness (4 of the guidance items).** Made the
  board teach itself. **(1) Next-step nudges:** `nextStepLabel(stage, visitType)` in
  `components/live-board/stages.ts` returns the i18n key for the action that advances a visit — keyed
  off the *next* stage so it honours the outpatient short-circuit (diagnostics → discharge) — surfaced
  as an accent-colored "→ action" pill on every `PatientCard` (e.g. a triaged patient shows "Send to
  doctor" / "Envoyer au médecin"). **(2) Guided tour:** new `components/onboarding/guided-tour.tsx` — a
  centered, mount-guarded, localStorage-dismissed 4-step overlay (board → tap a patient → register →
  switch role/language) wired into `AppShell`; a "?" navbar button replays it mid-demo via the
  `careflow:open-tour` window event. **(3) Legibility pass:** lifted `--muted-foreground` contrast in
  both light & dark blocks of `globals.css` and bumped the smallest board fonts (card MRN/meta/reason,
  journey + stat-column headers) up a step. **(4) Friendlier empty states:** board columns now read
  "No patients waiting here" / "Aucun patient en attente ici" (the prominent Register CTA already lives
  in the board header). New FR/EN `nextStep` + `tour` namespaces (`fr satisfies Messages` keeps them in
  sync). Added 4 `nextStepLabel` vitest cases (**150 pass total**); `tsc --noEmit` clean. Browser-verified
  EN + FR: tour shows on first load, steps through, "Got it" persists, "?" replays; nudges render per
  stage; live DOM carries the bumped sizes. *(Remaining Phase 16 items — intake simplifications, one-click
  demo-mode reset, and the final no-instructions walkthrough — are still open.)* Frontend-only — no
  Supabase yet.
* 2026-06-02: **Full patient history report (separate download).** Added a distinct lifetime-record
  export alongside the single-visit report (by explicit request: "full patient history as a separate
  report download option, not an extension of the visit report"). **Data layer:** added
  `getVisitsForPatient(patientId)` to `services/mockStorage.ts` and `buildPatientHistory(patientId)` +
  `PatientHistoryData` to `components/reports/visit-summary.ts` — assembles every encounter
  chronologically (oldest → newest) by reusing the per-visit aggregator, with patient-level allergies
  shown once, total-visit count, and first/last arrival bookends. **PDF:** refactored
  `visit-summary-export.ts` into composable section renderers (header, patient, allergies, visit,
  clinical) shared by both exporters; new `exportPatientHistoryPdf(data, t, locale)` adds a history
  overview block and a filled per-visit banner ("Visit N of M · date · type") introducing each
  encounter. **UI:** a second **Download full history** button in the `PatientDrawer` header next to the
  visit report; both lazy-import the exporter. New `visitReport.history` i18n keys (EN + FR). **Verified**
  in-browser EN + FR for Samuel Idris (seeded inpatient): both produce valid `%PDF-1.3` ~29 KB blobs;
  FR carries "Visite N sur M" / "Aperçu des antécédents" / "Nombre de visites" with no English leaks.
  Added 2 vitest cases (146 pass total); `tsc --noEmit` clean. Frontend-only — no Supabase yet.
* 2026-06-02: **Phase 16 item pulled forward — take-home patient visit report (PDF).** A patient can
  now leave with a comprehensive record of their encounter (and carry it to another facility). **Data
  layer:** `components/reports/visit-summary.ts` — `buildVisitSummary(visitId)` assembles one visit's
  whole record from the existing read queries (patient + visit identifiers, allergies, vitals sorted
  chronologically, doctor SOAP consultations, diagnoses sorted primary-first, orders joined to their
  results, prescriptions joined to MAR administrations, admission + transfers + computed length of
  stay) and exposes staff/ward/bed name resolvers so the renderer stays join-free. **PDF:**
  `components/reports/visit-summary-export.ts` — `exportVisitSummaryPdf(data, t, locale)` renders a
  clean clinical document via the same jsPDF + autotable stack as the ops report (sectioned layout,
  key/value blocks, tables, wrapped SOAP paragraphs, abnormal-result flags, dose-administration
  summaries, page numbers + a hand-off disclaimer), lazy-imported so the heavy libs only load on click.
  **UI:** a **Download patient report** button in the `PatientDrawer` header (reachable from the board
  and from Phase 15 search). New `visitReport` i18n namespace (EN + FR) covers every section title,
  field label, and value; per the Phase 13 scope boundary, clinical *values* (drug names, ICD-10
  descriptions, free-text notes, dose/route/frequency, GCS/SpO₂) stay canonical. **Verified**
  in-browser EN + FR: opened Samuel Idris (seeded inpatient) via search → clicked the report button →
  a valid `%PDF-1.3`, ~27 KB blob is produced containing all sections (title, patient, hospital number,
  doctor's notes, diagnoses, tests, medications, admission, disclaimer); FR build carries French
  section titles + disclaimer; no code errors. Added 4 vitest cases (148 pass total); `tsc --noEmit`
  clean. Frontend-only — no Supabase yet. *(Single-visit scope by decision; a full cross-visit history
  report is a natural follow-on.)*
* 2026-06-02: **Phase 15 complete.** "Find My Patient" front door — a global patient search pinned to
  every screen. **Data layer:** added `searchPatients(query, limit=8)` to `services/mockStorage.ts`
  (case-insensitive substring over name, MRN/hospital number, national ID, phone, and the emergency
  anonymous identifier; ranked exact → prefix → mid-string, name-alphabetical tiebreak) and
  `getLatestVisitForPatient(patientId)` (resolves a patient to the visit to open — open visit
  preferred, else most recent by `created_at`). **UI:** new `components/search/global-search.tsx` — a
  trigger in the app-shell header (wide search box on desktop with a ⌘K hint, icon-only on mobile) plus
  a window-level ⌘K / Ctrl+K shortcut, opening a centered command dialog built directly on
  `@base-ui/react/dialog` (no Command/cmdk primitive exists). Live results show name (or anonymous
  identifier), the `CF-YYYY-NNNNNN` hospital number in mono + phone, and a translated visit-type badge;
  clicking a result resolves the visit and opens the existing `PatientDrawer` (reused as-is). Wired
  into `components/layout/app-shell.tsx`; new `search` i18n namespace added to `en.ts`/`fr.ts`
  (placeholder, description, type-to-search, no-results with `{query}`, hospital-no, no-visit). **Verified**
  in-browser EN + FR: "mensah" → Grace Mensah and "CF-2026-000002" → Samuel Idris each in ≤2 taps from
  any page, result opens the drawer, ⌘K opens search, FR strings + translated badge ("Hospitalisé") +
  no-results message all clean; no hydration warnings. Added 9 vitest cases (140 pass total); `tsc
  --noEmit` clean. Frontend-only — no Supabase yet.
* 2026-06-02: **Phase 14 complete.** Role-based, task-focused simplification (no auth yet — rides the
  Phase 8 dev `RoleProvider`). **(1) Role-driven nav:** a `ROLE_NAV` map in
  `components/layout/app-shell.tsx` narrows the flat 9-item menu to each acting role's routes
  (reception → board/register/beds/match; nurse → board/meds/beds; doctor → board/tests/meds;
  pharmacist & lab_tech subsets; admin → full). Hydration-safe — the full menu renders until mount,
  then narrows, so SSR/first paint stay stable; routes are only hidden, never blocked. **(2) Role-led
  `PatientDrawer`:** each section got a stable `SectionKey`; the acting role's lead sections render
  first/expanded (`PRIMARY_BY_ROLE`: doctor → console + care stage; nurse → vitals + care stage;
  reception → reconcile + placement + care stage) and everything else folds under one "More options"
  expander. Done with per-section flex `order` + a `hidden` toggle (no JSX relocated, low risk);
  unmapped roles (admin/pharmacist/lab_tech) see all sections; `careStage` is in every lead set so the
  drawer is never empty for outpatient/non-anonymous visits. **(3) Primary action:** the Live Board
  header now leads with a prominent **Register a patient** CTA, the department filter demoted beside it.
  **(4) Triage acuity (flagged item #3):** new `TriageLevel` (1 critical … 5 non-urgent) on `Visit`,
  threaded through `CreateVisitInput`/`createNewVisit`, seeded with clinically-sensible values per
  visit type (DB version bumped `careflow_db_v4` → `careflow_db_v5` to force a fresh seed), surfaced as
  a colored acuity badge on every board card (`--triage-1..5` tokens added to both light & dark blocks
  of `globals.css` + `@theme inline`) and settable on the intake form. All new strings localized FR/EN.
  **Verified** in-browser across doctor/nurse/reception (menu + drawer show only that role's tasks,
  "More" reveals the rest) and admin (full nav, all sections, no collapse); triage badges render in
  both locales; EN/FR toggle clean; `tsc --noEmit` clean; 131 vitest pass; no hydration errors.
* 2026-06-02: **Phase 13 complete.** Localization (FR/EN) & plain language. Built a zero-dependency
  homegrown i18n core: `i18n/en.ts` (source-of-truth dictionary, `type Messages = typeof en`),
  `i18n/fr.ts` (`satisfies Messages` → `tsc` fails on any missing/renamed key, the compile-time
  "no English leaks" guarantee), `i18n/index.ts` (`translate(locale, key, params?)` — dot-path lookup,
  `{param}` interpolation, en-fallback then raw-key fallback), and `i18n/format.ts` (locale-aware
  `formatDate/DateTime/Number/Percent` over `Intl`, `en-US`/`fr-FR`). A `LocaleProvider` mirroring
  `RoleProvider` (localStorage `careflow_locale`, hydration-guarded `useT()`/`useLocale()` resolving
  against `mounted ? locale : "en"`, sets `document.documentElement.lang`) wired into `app/layout.tsx`;
  an FR/EN navbar toggle modeled on `ThemeToggle`. **English is the default/SSR locale**, French opt-in.
  Converted every `Record<Enum,string>` label map to return **message keys** (role/allergy/order/
  prescription/MAR/bed-status/visit-type/care-stage/range-preset), resolved with `t()` at call sites;
  pure modules (`reports.ts`/`export.ts`) keep returning keys and the render/export layer localizes via
  `sliceLabel`/threaded `t`+`locale` (PDF & Excel exporters now emit fully localized chrome). Swept all
  `app/*/page.tsx` + the ~1,600-line `PatientDrawer` + live-board + app-shell; plain-language relabels
  (Intake→"Enregistrer un patient", Diagnostics→"Tests & résultats", Floor Map→"Lits", MRN→"Numéro
  d'hôpital", etc.). Caught two non-key leaks the type-check can't see — the dev `RoleSwitcher`
  (rendered raw `ROLE_LABEL` keys) and the shared `ui/sheet` sr-only "Close" — now both localized.
  **Scope boundary:** clinical values stay canonical (drug names, ICD-10 descriptions, `GCS`/`SpO₂`/
  `IV`/`IM`, free-text complaints, parseable route/frequency options); page `metadata` stays English
  (server-only). 131 vitest cases pass (added `i18n/i18n.test.ts`: `translate` dot-path/interpolation/
  fallbacks + `format.ts` fr-FR vs en-US); `tsc --noEmit` clean. Verified in browser: toggled FR,
  `document.documentElement.lang === "fr"`, navbar date reads `mar. 2 juin`, walked reception → doctor
  (PatientDrawer console) → nurse and all eight pages + the drawer with **zero English leaks** and **no
  hydration warnings/console errors**; EN toggle restores English everywhere. (NB: this app's PWA
  service worker caches the JS bundle — had to unregister it + clear caches to see edits in dev.)
* 2026-06-02: **Added Phase 16.7 — Cameroon Patient ID format.** Replaces the auto-generated MRN
  (`CF-YYYY-NNNNNN`) with a Cameroon-standard ID built at registration from `YYMMDD` + name initials +
  ` - ` + mother's-name initial (e.g. Bambot Hanson Ngongmun, 20/11/1998, mother Ndung → `981120BHN -
  N`). Locked decisions: replaces MRN entirely as the displayed ID (patient UUID stays the internal
  key); uniqueness via suffix-on-clash for now; new optional mother's-first-name field. Spec covers
  edge cases (unknown/approx DOB, anonymous intake → ID at reconciliation, accent normalization) and
  includes recomputed seed IDs for the existing patients. No code changed yet — phase spec only.

* 2026-06-02: **Added Phase 16.6 — Nursing Care Plan (inpatient).** New feature phase (frontend + mock
  now, schema-ready for Phase 17) driven by feedback from a practicing nurse: a dedicated
  `/care-plans` page (left-nav, master/detail) where nurses record the individualized non-medication
  care an admitted patient needs (Henderson's 14 components — hygiene, nutrition, positioning,
  temperature, etc.) and an append-only care log + shift handover, so continuity survives nurse
  handovers. Data model = `CarePlanItem` (the plan) + append-only `CarePlanEntry` (log/handover) +
  `care_need_category` enum, mirrored into `supabase/schema.sql`. Kept off the patient drawer (too
  crowded) except as a read-only summary. **Includes concrete seed data** for the four admitted seed
  patients (Idris, Bello, Owusu, John Doe · Gamma) so the panel renders populated for demos. No code
  changed yet — phase spec only.

* 2026-06-02: **Added Phase 16.5 — Demo-Readiness QA Pass.** A frontend-only polish step before the
  backend, capturing two follow-ups: (1) **finish & confirm the drawer simplification** — verify the
  role-led `PatientDrawer` opens each role to its primary action with the rest collapsed (tighten the
  lead-section set if a role still has to scroll); (2) a **French browser pass** for layout/overflow
  (FR runs ~15–20% longer than EN) at mobile + desktop, plus an en/fr key-parity test and removal of
  the sandbox-only `@rollup/...-linux-arm64-gnu` / `@oxc-parser/...-linux-arm64-gnu` deps from
  `package.json`. No code changed.

* 2026-06-02: **Roadmap re-sequenced for adoption (UX before backend).** Added four frontend-only
  phases ahead of the backend cutover, targeting low-tech-literacy staff at small/medium hospitals in
  Douala: **Phase 13** Localization (French-primary + FR/EN toggle) & plain-language relabeling;
  **Phase 14** role-based, task-focused simplification (role-driven nav + splitting the ~1,600-line
  `PatientDrawer` into a role-led primary action with the rest collapsed); **Phase 15** global
  "find my patient" search by name / hospital number; **Phase 16** comprehension, guidance &
  demo-readiness (legibility pass, guided tour, next-step nudges, friendlier empty states, print a
  visit slip, approximate-age intake, plain confirmations/errors, demo-reset). The backend cutover is
  **renumbered to Phase 17 and remains the final phase**; the former "Phase 14 — Hardening &
  Compliance" is folded into Phase 17 (its frontend items moved into Phase 16). No code changed.

* 2026-05-31: **Reports trim.** Removed 7 presentations from `/reports` *and everything that fed them* — top allergens, allergy coverage, clinician workload, diagnostic orders, top prescribed drugs, medication administrations, and bed status. Deleted the backing aggregators (`topAllergens`, `allergyPrevalence`, `staffWorkload`, `ordersByType`, `topDrugs`, `medsByStatus`, `bedStatusMix`) and their label maps from `components/reports/reports.ts`, slimmed `ReportData`/`FullReport`/`buildReport`, dropped the matching PDF tables + XLSX sheets in `export.ts`, removed the four now-dead service getters (`getAllAllergies/Orders/Prescriptions/MedicationAdministrations`), and pruned the vitest blocks/fixtures. Surviving sections: KPIs, visit trend, visit-type mix, department throughput, top diagnoses, length of stay, ward occupancy, care-stage distribution, sex/age demographics, abnormal-result rate, clearance bottlenecks. 106 vitest cases pass; `tsc --noEmit` clean; verified in browser (light + dark) — the 7 charts are gone, the rest render.

* 2026-05-31: Roadmap initialized. Architecture configured for local storage mocking. Base schema blueprints defined. Ready for Phase 1 deployment.
* 2026-05-31: **Stack correction** — the pre-initialized project runs on **Next.js 16.2.6 (App Router, Turbopack) + React 19 + Tailwind v4**, not Next.js 14. All Phase 1+ work follows Tailwind v4 (`@theme inline`, CSS-variable theming) and Base UI primitive conventions rather than the older Next 14 / Tailwind v3 assumptions.
* 2026-05-31: **Phase 1 complete.** Installed `lucide-react` and initialized `shadcn/ui` (`base-nova` style, Base UI). Added base components. Authored relational data models in `types/healthcare.ts`. Built a calm slate light theme in `app/globals.css`. Created a responsive `AppShell` with desktop sidebar collapsing to a mobile Sheet drawer. Verified with `tsc --noEmit`, `next build`, and in-browser.
* 2026-05-31: **Phase 2 complete.** Built `services/mockStorage.ts` — a `localStorage`-backed engine with lazy auto-seed, SSR-safe reads, corrupt-state recovery, `resetDatabase()`. Implemented all handlers. Seeded 5 staff + 5 clinical profiles incl. anonymous unconscious patient. Wired Live Board stat cards to live per-stage counts.
* 2026-05-31: **Phase 3 complete.** Built the 4-column kanban journey board, adaptive touch-friendly patient cards, and the Patient Intake form with Emergency Unconscious toggle + auto-generated tracking tag. Verified end-to-end in light/dark and at mobile width.
* 2026-05-31: **Phase 4 complete.** Built the slide-out `PatientDrawer` (clearance gates, vitals/GCS logging, treatment history, anonymous-only reconciliation panel). Fixed Base UI integration issues. Verified end-to-end.
* 2026-05-31: **Phase 5 complete.** Added verification gates and discharge simulation. `evaluateDischargeReadiness()`, clearance-gated discharge, anonymous-record block, simulated follow-up transmissions. Verified.
* 2026-05-31: **Roadmap restructured for full EMR scope.** Re-centered the architecture on the **Visit** as the record spine and split **outpatient vs inpatient** paths. Added Phases 6–14 covering departments, clinical encounters + diagnoses, the orders→results loop, prescriptions + MAR, the editable ward/bed floor map with live occupancy, reporting + Excel export, and the Supabase backend cutover (Auth, role-based RLS, audit trail). Locked scope decisions: billing deferred, MRN auto-generated, RLS written now. Flagged omissions (transfers, allergies, triage acuity, deceased outcome, consent capture, concurrency, retention).
* 2026-05-31: **Supabase schema authored** (`supabase/schema.sql`). Copy-paste-ready: all tables/enums/indexes; updated_at, audit, and bed-occupancy triggers; **auto-generated MRN** (`CF-YYYY-NNNNNN` via `mrn_seq` + `generate_mrn()`); `ward_occupancy` + `admission_report` reporting views; private storage buckets (`lab-results`, `patient-documents`); and full role-based RLS (doctor/nurse/admin/lab_tech/pharmacist/receptionist) with an admin-only, client-tamper-proof audit log.
* 2026-05-31: **Phase 6 complete.** Re-centered the model on the **Visit**. Rewrote `services/mockStorage.ts` (bumped to `careflow_db_v2`) around the full clinical entity set — departments, wards, beds, staff, patients, visits, consultations, diagnoses, orders, results, prescriptions, MAR, treatment records, admissions — with all mutation logic in the service layer. Added pure helpers: `generateMrn()`, `isTerminalStage()`, `evaluateDischargeReadiness()` (3 clearances + anonymous block), `computeWardOccupancy()`, plus visit-centric mutations (`createNewVisit`, `addTreatmentLog`, `createAdmissionForVisit`, `updateAdmissionClearances`, `updateVisitStage` with terminal-transition cascade, `reconcileAnonymousProfile`). Reseeded a full hospital (7 departments, 3 wards, 8 beds, 8 staff, 5 patients incl. anonymous, 5 visits across outpatient/inpatient/emergency, full clinical records, 3 admissions). Migrated the UI: board now uses **4 grouped columns** (Intake / Consultation / Treatment / Discharge) mapping the 8 `care_stage` values; updated patient card, drawer, stage counts, intake, staff and reconciliation pages to the visit/MRN model. Added the `--status-diagnostics` token (light + dark + `@theme inline`). Added **vitest** (`npm test`) with 18 passing unit tests for the pure helpers. `tsc --noEmit` clean; verified end-to-end in browser (light + dark, discharge gate + cascade confirmed).
* 2026-05-31: **Phase 8 complete.** Clinical encounter & documentation, plus a dev role switcher. Service layer: `addConsultation` (SOAP note; auto-advances triage→consultation), `addDiagnosis` (ICD-10 + description + primary, with single-primary-per-visit demotion), and `recordDisposition` (discharge-home / admit / observation / refer — orchestrates existing stage/admission mutations and logs the choice to the treatment record; no new schema field). Built a doctor-gated **Doctor console** in the `PatientDrawer`: prior record (existing diagnoses as badges + latest SOAP note), a 4-field SOAP entry form, structured diagnosis entry with a native ICD-10 datalist quick-pick (auto-fills description), and a 2×2 disposition grid. Added a **dev-only role switcher** (no auth): `components/role-provider.tsx` (`RoleProvider` context — acting staff persisted to `careflow_acting_staff`, hydration-guarded, defaults to the seeded attending doctor) and a navbar `RoleSwitcher` dropdown grouping staff by role; the sidebar footer now reflects the acting staff (name + initials + role). Wired `RoleProvider` into `app/layout.tsx`. Whole scaffold is removed when real auth lands (Phase 13). Added 5 vitest cases for the pure `staffInitials`/`ROLE_LABEL` helpers (28 passing total). `tsc --noEmit` clean; verified in browser (light + dark): doctor sees the console and a saved diagnosis persists with the acting doctor as author; switching to a nurse hides the console while keeping vitals/care-stage. Cross-visit patient timeline deferred.
* 2026-05-31: **Phase 7 complete.** Departments & patient routing. Added department admin to the service layer (`createDepartment`, `updateDepartment`, `setDepartmentActive` — soft-archive, never hard-deleted) plus pure routing helpers (`filterVisitsByDepartment`, `countVisitsByDepartment`, `ALL_DEPARTMENTS` sentinel) and read queries (`getActiveVisitsForDepartment`, `getActiveVisitCountsByDepartment`). Built the **Departments** directory (`/departments`, new nav entry) — cards with code/description/active-visit counts, inline active toggle, and a create/edit Sheet; an unrouted-visits notice. Added a **per-department filter** to the Live Board: a new `LiveBoard` client wrapper owns the "Viewing" selector and narrows both the stage-count cards and the kanban columns (All departments = admin view, a specific unit = that unit's patients). Registration already routes a visit to a department. Added 5 vitest cases for the routing helpers (23 passing total). `tsc --noEmit` clean; verified in browser (light + dark): created a Maternity dept, confirmed it appears in the board filter, and filtering to Internal Medicine narrowed to its 2 active visits.
* 2026-05-31: **RoleSwitcher fix.** The dev role-switcher dropdown never opened — its header `DropdownMenuLabel` (Base UI `Menu.GroupLabel`) sat outside any `Menu.Group`/`RadioGroup`, throwing `MenuGroupContext is missing` and crashing the whole `RoleSwitcher` render. Wrapped the header label in a `DropdownMenuGroup` and switched the trigger from a nested Base UI `Button` (`render={<Button/>}`) to a native button styled via `buttonVariants` to avoid a double-primitive composition. Verified the menu opens, lists staff by role, and switching updates the acting role + sidebar footer.
* 2026-05-31: **Phase 9 complete.** Orders & results loop. Added `is_abnormal` to the `Result` model. Service layer: `addOrder` (lab/imaging/procedure; nudges a consultation-stage visit to `diagnostics`), `updateOrderStatus` (start / cancel; stamps `completed_at`), `addResult` (records value/range/summary/abnormal/mock-attachment and auto-completes the parent order), plus read queries `getResultsForVisit` and `getOpenOrders(orderType?)` (the diagnostics queue, oldest first). Shared pure helpers in `components/diagnostics/orders.ts` (`ORDER_TYPE_LABEL`, `ORDER_STATUS_LABEL`, `ORDER_STATUS_TOKEN`, `isOrderOpen`, `hasAbnormalResult`, `COMMON_ORDERS` quick-picks). UI: an **Orders & results** block in the doctor console (existing orders with status badges + their results, abnormal-flag highlighting; a test-type select with type-aware datalist quick-pick to place new orders) and a new **Diagnostics queue** page (`/diagnostics`, new nav entry) — open orders across visits with patient/MRN/ordering-clinician context, Start (in_progress), and a result-entry Sheet (value, reference range, summary, abnormal toggle, mock attachment filename). Attachments stored as filename metadata only — real binary upload deferred to Phase 13 (Supabase Storage). Added a fresh requested order to the seed so the queue is populated on first load. Added 9 vitest cases for the order helpers (37 passing total). `tsc --noEmit` clean; verified end-to-end in browser (light + dark): recorded an abnormal Troponin result from the queue — it left the queue and surfaced on the doctor drawer with the Abnormal flag, value, and attachment; a D-dimer ordered from the drawer appeared back in the queue.
* 2026-05-31: **Phase 10 complete.** Prescriptions & Medication Administration (MAR) — the doctor writes the structure, nurses administer without going back. Service layer: `addPrescription` (drug/dose/route/frequency/duration/instructions; status `active`; prescriber falls back to the visit's attending), `updatePrescriptionStatus`, and `recordMedicationAdministration` (stamps `administered_at`/`scheduled_for` + author, touches the parent prescription), plus the `getActivePrescriptions(departmentId?)` read query (active prescriptions on open visits). Shared pure helpers in `components/medications/prescriptions.ts` (`PRESCRIPTION_STATUS_LABEL`/`_TOKEN`, `MAR_STATUS_LABEL`/`_TOKEN`, `ROUTE_OPTIONS`, `FREQUENCY_OPTIONS`, `COMMON_DRUGS` quick-picks, `isPrescriptionActive`, and the deterministic dosing model `parseFrequencyHours` + `computeDoseStatus(now)` → overdue/due/upcoming/prn/inactive with a 30-min grace, sorted via `DOSE_STATE_ORDER`). UI: a **Prescriptions** block in the doctor console (existing prescriptions with status badges + detail/instructions; a new-prescription form with drug datalist that auto-fills dose+route from `COMMON_DRUGS`, plus route/frequency datalists) and a new **Medications** page (`/medications`, new nav entry) — a nurse MAR worklist sorted overdue→due→upcoming with one-tap Given/Held/Refused (timestamps + author), relative due times, patient/MRN/unit/prescriber context, and a **shift-handover** summary of outstanding meds per ward. Added 16 vitest cases for the medication helpers (53 passing total). `tsc --noEmit` clean; verified end-to-end in browser (light + dark): an overdue Amoxicillin marked Given moved to upcoming and cleared its ward; a Ceftriaxone prescribed from the doctor drawer surfaced on the MAR as upcoming for the correct ward.
* 2026-05-31: **MAR split by care setting.** The Medications worklist now separates **Inpatient · by ward** (admitted patients holding a bed) from **Outpatient & ED**, since the two are administered by different staff in different places. `placeVisit()` resolves each row to its unit + setting (active admission with a bed → inpatient + ward; otherwise ambulatory + department); the shift-handover summary is scoped to inpatient only. No schema change. Verified in browser.
* 2026-05-31: **Phase 12 complete.** Reporting, analytics & export — the review-board payoff. New `/reports` admin dashboard (nav entry, `BarChart3`) over a pure aggregation layer in `components/reports/reports.ts` (vitest-tested in node, 29 cases): KPIs, `visitsOverTime` (daily ≤46d else weekly buckets), visit-type/department/care-stage/bed-status/order/MAR/sex breakdowns, `topDiagnoses`/`topDrugs`/`topAllergens`, `lengthOfStay` (bands + avg/median), `wardOccupancy`, `ageDistribution`, `staffWorkload`, `allergyPrevalence`, `abnormalRate`, `clearanceBottlenecks`, all date-range-scoped via `presetRange` + a `buildReport` bundle that is the single source of truth for screen and exports. Recharts visualizations in `components/reports/charts.tsx` (stacked-area trend, donuts, horizontal/vertical bars) on a new **8-hue categorical palette** (`--chart-1..8`, light + dark + `@theme inline`); every color is a theme token so charts adapt to light/dark. Range presets (7d/30d/90d/all + custom date inputs). **Exports** in `components/reports/export.ts` (browser-only): `exportReportPdf` (jsPDF + autotable — KPI tiles, drawn colored bar charts via paired `CHART_RGB` sRGB tuples, and ~15 detail tables) and `exportReportXlsx` (SheetJS multi-sheet workbook). Read-only whole-collection getters added to the service layer (`getAllAllergies/Diagnoses/Orders/Results/Prescriptions/MedicationAdministrations/TreatmentRecords/Transfers`). **Richer seed:** bumped storage to `careflow_db_v3` and added a deterministic historical caseload (`seedHistoricalCaseload`, mulberry32 PRNG) — ~46 *closed*/terminal visits spread over 60 days with weighted ICD-10 diagnoses, orders+results (some abnormal), prescriptions+MAR doses, vitals, and discharged admissions (LOS 1–14d for ALOS) + 6 extra staff; kept closed/terminal so the live board, MAR and floor map are untouched while reports read every row. New deps: recharts, xlsx, jspdf, jspdf-autotable. 113 vitest cases pass; `tsc --noEmit` clean; verified in browser (light + dark): all-time shows 51 visits over the full window, every chart renders multi-colored in both themes, and both PDF + Excel exports fire without error. Live aggregation runs client-side over the mock store — the SQL `admission_report` view + aggregate queries are deferred to the Phase 13 cutover.
* 2026-06-01: **PWA + offline + durable outbox (pre-Phase-13 groundwork).** Built everything that can exist *before* Supabase so the eventual cutover is a one-function change, not a rebuild. **(1) PWA/installable + offline:** `app/manifest.ts` (`MetadataRoute.Manifest` — standalone, slate `#0f172a`/`#f8fafc` colors, 3 icons), `viewport` + PWA `metadata` (applicationName, appleWebApp, apple-touch icon) in `app/layout.tsx`, a zero-dependency icon generator (`scripts/generate-icons.mjs` — hand-rolled PNG via `node:zlib` + CRC32, emits `public/icons/*` + `icon.svg`), a hand-written service worker (`public/sw.js`, cache `careflow-v1`: cache-first for hashed assets, **network-first navigations** so Turbopack HMR keeps working in dev, stale-while-revalidate otherwise; precaches the shell + `/offline`), a themed `/offline` fallback, `components/pwa/service-worker-register.tsx`, and `/sw.js` no-cache + JS-content-type headers in `next.config.ts`. **(2) Durable outbox:** new `services/syncQueue.ts` — every mutation is captured as a restart-surviving pending change in `careflow_outbox_v1` (separate from the DB key). Capture is wired through the **single existing `persist()` seam** in `mockStorage.ts` via a pure, node-tested `diffDatabases(pre, post)` that emits one insert/update/delete per affected row with the **Postgres (snake_case) table name** — so none of the ~25 mutation functions were touched and the UI contract is unchanged. Seed/heal/reset persist with `{ track: false }` (the heal write refreshes the diff baseline each load); reset also `clearOutbox()`s. A navbar `SyncStatus` chip (online/offline + pending count, hydration-guarded, new `--status-warning` token in light+dark+`@theme inline`) and a headless `SyncEngine` (drains on mount/online/`careflow:outbox`) are mounted in the layout. **(3) The single sync seam:** `isSyncConfigured()` (returns `false` today) + `pushChangeToServer()` (throws `SyncNotConfiguredError`; documented Phase-13 supabase upsert/delete body inline) — `drainOutbox()` is a safe no-op until the flag flips, after which the queue drains automatically. **Deliberately out of scope (stays Phase 13):** real `supabase-js` calls, multi-device merge/conflict resolution, Web Push. 120 vitest cases pass (added `services/syncQueue.test.ts` reducers + seam, and `diffDatabases` insert/update/delete + multi-row + snake_case cases); `tsc --noEmit` clean; `next build` compiles the manifest + `/offline` routes. Verified in browser (light + dark): SW controls the page with `careflow-v1` populated (shell + assets), manifest serves 200/standalone, advancing a patient's stage enqueued exactly `visits:update` and the chip read "1 change queued to sync", the entry **survived a reload** (restart-survival), and the `/offline` shell is cached and renders in both themes.
* 2026-05-31: **Allergies (standalone safety phase).** Patient-level allergy record — keyed to the patient so it persists across visits — with a `no_known_allergies` flag that distinguishes *confirmed none* from *not yet assessed*. Mirrored into `supabase/schema.sql` (`allergy_category`/`allergy_severity` enums, `allergies` table + index, `patients.no_known_allergies`, updated_at/audit/RLS wiring incl. a nurse/doctor/admin write policy). Service layer: `getAllergiesForPatient`, `addAllergy`, `removeAllergy`, `markNoKnownAllergies`; `reconcileAnonymousProfile` now re-points allergies from the anonymous record to the merged profile. Pure helpers in `components/allergies/allergies.ts` (category/severity label + token maps, `ALLERGY_SEVERITY_RANK`, `COMMON_ALLERGENS` quick-picks, `categoryForAllergen`, `sortAllergiesBySeverity` worst-first, `highestSeverity`, and the 3-state `allergyDisplayState`). UI: an always-visible, severity-ranked **allergy banner** at the top of the `PatientDrawer` (red/treatment border when present, "No known allergies" when confirmed, "Allergies not assessed" when unassessed) plus a **drug-allergy caution** inside the prescribing form — deliberately a *visible warning the doctor reads*, not an auto-blocking interaction check (real allergy↔drug matching is fuzzy; a wrong block is worse than the list). Seeded 3 states: Mensah/Idris with allergies, Bello confirmed-none, Owusu/anon unassessed (no contraindication seeded against a prescribed drug). Added 12 vitest cases (65 passing total). `tsc --noEmit` clean; verified in browser (light + dark): all three banner states and the prescribing caution render correctly with no console errors.

* 2026-07-26: **The Merge (branch `merge-overhaul`) — the July overhaul rebased onto the Phase-21 main
  line.** The audit-driven overhaul (see the `overhaul-2026-07` branch's ROADMAP entry) had been built
  on a stale mid-June snapshot; this merge transplants ALL of it onto the monorepo without losing any
  Phase 18.6–21 work. Executed in five gated steps: **M1** branded ids + const-array enums in
  `@careflow/shared` (remote's ROS/notification types re-expressed with brands), compile-time-checked
  i18n keys, schema union (`clinical_terms`, `follow_up_tasks`, broad realtime publication,
  JWT-claim-first + InitPlan-wrapped RLS helpers, subscription write-gate, `prune_audit_log`) + one
  hosted migration (`packages/db/migrations/2026-07-merge-overhaul.sql`). **M2** storage-engine
  transplant: the 4,957-line blob monolith became a 36-line barrel over `services/db/*` (in-memory
  authoritative cache + IndexedDB per-row mirror, BroadcastChannel, reactive `useCacheVersion`);
  Phase-21 ROS/history, notifications generation, order/Rx deletes, dispositions, care-collab and
  telemetry all re-homed; the sync queue now composes BOTH lines' fixes — remote's mid-drain
  live-queue reconcile (UAT F#2) and local-wins version re-base (≤3 retries) in front of the
  overhaul's backoff, dead-letter and reviewable conflict records; hydration is windowed
  (patient_history full-fetch; ros/notifications windowed; per-patient on-demand history). **M3** the
  2,720-line drawer monolith → 15 decomposed sections carrying every remote feature (Background+ROS
  placement, admit/observe/refer dialogs, meal-timing prescribing, two-step deletes, 45vw layout,
  PatientName) plus the overhaul's vitals bounds, visit timeline, ReconcileDialog and state-leak fix.
  **M4** slimmed pages absorb remote deltas (intake demographics + background quick-add, reports
  register view, billing settle confirm, PatientName everywhere); worklist AND follow-ups coexist
  (worklist rewired reactive + one wall-clock tick); bell store on `subscribeCache`; server actions
  carry remote's Zod validation AND the overhaul's caller authentication (+ prod-disable of legacy
  provisioning); DOM test infra ported. **M5** full gate — and two latent main bugs fixed en route:
  the Phase-21 RLS tests lacked savepoints around expected rejections (failed on main itself against
  a fresh stack), and hospital-name validation returned a generic message (`zReqLineNamed`). Final
  gate: typecheck clean · **389 node + 14 DOM + 22 live-Supabase integration tests** green (the 22
  include the 3 that fail on main) · both apps build. Deploy: Vercel root `apps/web` (+ optional
  `apps/owner-console`), hosted steps in `docs/PRODUCTION-CUTOVER.md`.
