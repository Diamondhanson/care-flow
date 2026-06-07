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

* [x] Admin CRUD for **Wards** (name, floor, department) and the **Beds** inside each ward — the
      `/floor-map` page lets an admin create wards, pre-fill or append beds (auto-numbered
      "Bed N"), rename beds, set manual status (free / reserved / cleaning / maintenance), and
      remove empty beds.
* [x] Assigning an admitted patient to a bed marks it occupied; transfer/discharge frees the old
      bed and occupies the new one — `transferAdmission`/`assignBedToAdmission` in the service layer
      mirror the Supabase `sync_bed_occupancy` trigger.
* [x] Live floor-map view: wards grouped by floor, per-ward total / free / occupied tallies, and
      who occupies each bed; occupied beds can't be re-statused or removed.
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
  * [x] "Floor Map" → **Lits** / "Beds"
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

## PHASE 16.6 — Nursing Care Plan (Inpatient) 🔜

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

* [ ] `care_need_category` enum from Henderson's 14, named practically: `breathing`, `nutrition`,
      `elimination`, `mobility_positioning`, `sleep_rest`, `hygiene`, `temperature`, `dressing`,
      `safety`, `communication_emotional`, `pain_comfort`, `spiritual`, `wound_skin_care`, `other`.
* [ ] `CarePlanItem` (the **plan** — what the patient needs): `admission_id`, `patient_id`,
      `category`, `description`, `frequency` (free text, e.g. "Every 2h"), optional `goal`,
      `status` (`active` / `resolved`), `created_by_id`, timestamps.
* [ ] `CarePlanEntry` (the **log + handover** — append-only, never overwritten, like `transfers`):
      `admission_id` (and optional `care_plan_item_id`), `note`, `is_handover` flag, `recorded_by_id`,
      `recorded_at`.
* [ ] Add all three to `types/healthcare.ts`, `services/mockStorage.ts` (CRUD + read queries:
      `getCarePlanItemsForAdmission`, `getCarePlanEntriesForAdmission`, `addCarePlanItem`,
      `resolveCarePlanItem`, `addCarePlanEntry`, `getAdmittedPatientsForCarePlan`), and
      `supabase/schema.sql` (tables + indexes + `updated_at`/audit triggers + nurse/doctor/admin RLS
      write, all-staff read).

### UI

* [ ] New left-nav entry **"Nursing care plan"** (`/care-plans`), in the **nurse** role's menu
      (`ROLE_NAV` in `app-shell.tsx`); visible to doctor/admin too (read + write).
* [ ] **Master/detail page:** left = list of currently admitted patients (name, bed/ward, a count of
      active care needs, and a **handover-waiting** signal when an unread handover note exists); right =
      the selected patient's care plan in three blocks — **What is required** (the plan items),
      **What has been done** (the care log, with handover notes visually highlighted), and actions to
      **Record care** and **Leave handover**.
* [ ] A **ward filter** at the top so a nurse can narrow to her ward at shift change.
* [ ] Low-friction input: category is a **quick-pick** (not free typing); record-care and handover are
      short forms. (Natural future home for the French voice-to-note AI.)
* [ ] A compact **read-only** care-plan summary inside the patient drawer (for a doctor's glance), so
      the drawer references the record without becoming the working surface.
* [ ] Fully localized (FR/EN) including the category labels.

### Seed sample data (so the panel is populated and demoable)

Seed against the existing admitted patients (bump the mock DB key). Concrete records:

* [ ] **Samuel Idris — ICU-04 (post-op laparotomy).** Needs: Hygiene — "assist with bed bath, keep skin
      dry" (Daily); Mobility/positioning — "turn every 2h to prevent pressure sores" (Every 2h);
      Temperature — "tepid sponge and review if temp > 38.5°C" (As needed); Nutrition — "soft diet,
      assist feeding, encourage fluids" (Each meal). Log: Romero 12:05 "Turned to left side. Temp 37.8°C,
      settling." · Patel 14:20 "Bed bath given, skin intact. Ate half of lunch." · **Handover** Patel
      15:00 "Anxious about surgery tomorrow — needs reassurance. Watch temperature this evening."
* [ ] **Aisha Bello — Ward B-11 (pneumonia, recovering).** Needs: Breathing — "sit upright, encourage
      deep breathing / chest physio" (Every 4h); Hygiene — "assist shower" (Daily); Mobility —
      "encourage short walks on the ward" (Twice daily). Log: Patel 13:10 "Walked to end of ward and
      back, tolerated well." · **Handover** "Chest clearer, coughing productively. Keep prompting deep
      breathing."
* [ ] **Daniel Owusu — Ward A-03 (diabetic, stabilized).** Needs: Nutrition — "diabetic diet, monitor
      intake" (Each meal); Wound/skin care — "inspect feet daily for ulcers" (Daily). Log: Romero 11:30
      "Feet inspected, no ulcers. Ate full breakfast."
* [ ] **John Doe · Gamma — ICU-02 (unconscious, head trauma, GCS improving).** Needs: Hygiene — "full
      bed bath + mouth care" (Daily); Positioning — "turn every 2h" (Every 2h); Elimination — "catheter
      care, monitor output" (Each shift); Eye care — "clean + protect eyes to prevent dryness" (Every
      4h); Safety — "cot sides up, neuro observations" (Each shift). Log: Patel 14:00 "Full bed bath and
      mouth care done. Repositioned. Output adequate." · **Handover** "GCS improving (7→9). Continue
      2-hourly turns and eye care. Family visited."

### Verify

* [ ] Open `/care-plans` as a nurse: the four seeded patients appear in the list with their need counts,
      Idris shows a handover-waiting signal; clicking a patient shows required care + the care log with
      the handover note highlighted; recording care and leaving a handover append to the log and update
      the signal. Admin/doctor can read it; the drawer shows the read-only summary. FR + EN clean; `tsc`
      clean; unit tests for the new pure helpers green.

## PHASE 16.7 — Cameroon Patient ID Format 🔜

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
* [ ] Add `mother_first_name` (nullable) to `Patient` in `types/healthcare.ts`, the intake form, and
      `supabase/schema.sql`.
* [ ] Replace the MRN display field with the new ID. Recommend renaming `patients.mrn` →
      `patients.patient_code` for clarity (update all references), or keep the column name but change
      its meaning/format — either way, drop the `CF-…` default and generate app-side.
* [ ] Pure helper in the service layer: `generatePatientId(dob, fullName, motherFirstName)` →
      base ID, plus clash-suffix logic against existing IDs. Generate at patient creation
      (`createNewVisit`) and (re)generate at `reconcileAnonymousProfile`.
* [ ] `supabase/schema.sql`: drop the `mrn_seq` / `generate_mrn()` default; the app supplies the ID on
      insert (or a `plpgsql` function mirrors the helper). Keep a `unique` index on the ID.
* [ ] Intake form: add the optional "Mother's first name" field; show the generated patient ID on the
      success screen instead of the MRN.
* [ ] Update every display of the old MRN: patient cards, drawer header, **global search** (match on
      the new ID + name + phone), reports, and the printed visit slip.
* [ ] i18n: relabel "Hospital number / Numéro d'hôpital" → "Patient ID / Identifiant patient"; add
      FR/EN labels for the mother's-name field.
* [ ] Unit tests: the worked example → `981120BHN - N`; accent stripping; missing mother → no ` - x`;
      approximate DOB; clash → suffix.

### Seed regeneration (so existing patients carry valid IDs)
Recompute each seeded patient's ID in the new format and add a plausible mother's first name:
* [ ] Grace Mensah, 1989-03-14, mother Akosua → `890314GM - A`
* [ ] Samuel Idris, 1972-11-02, mother Fatima → `721102SI - F`
* [ ] Aisha Bello, 1995-07-21, mother Hauwa → `950721AB - H`
* [ ] Daniel Owusu, 1960-01-09, mother Abena → `600109DO - A`
* [ ] John Doe · Gamma (anonymous) → no ID until reconciled

### Verify
* [ ] Registering a patient generates the correct ID (with and without a mother's name); the worked
      example and edge-case unit tests pass; a forced clash appends `-2`; anonymous intake gets its ID
      at reconciliation; the ID shows on cards/search/drawer/intake in FR + EN; `tsc` clean, tests green.

## PHASE 17 — Backend Cutover: Supabase, Auth, RBAC, Audit & Compliance 🔚 FINAL PHASE

**Goal:** swap the mock for a real, secure, multi-user backend — the last phase, after the UX is
demo-ready.

* [ ] Provision the database — **`supabase/schema.sql` is written and ready to copy-paste** (all
      tables, enums, indexes, triggers, MRN generator, occupancy sync, reporting views, storage
      buckets, and RLS).
* [ ] **Role-based access (enforced at this step):** real Supabase Auth login; "locked in as a
      doctor/nurse/admin" enforced by the **RLS policies already defined** in the schema (doctors
      author consultations/orders/prescriptions; nurses record vitals + MAR; lab techs enter results;
      pharmacists update fulfilment; admin manages structure; everyone reads the operational record).
      The dev role switcher (Phase 8) is removed here.
* [ ] **Audit trail (enforced at this step):** every change to a sensitive table records *who* and
      *when* plus before/after snapshots — **already wired** via the `audit_trigger` + append-only
      `audit_log` (admin-readable, client-tamper-proof) in the schema.
* [ ] Replace `services/mockStorage.ts` internals with `supabase-js` calls; keep the UI contract
      identical and flip the `isSyncConfigured()` seam so the offline outbox drains automatically.
* [ ] File storage: lab results / imaging / scanned documents in the private storage buckets.
* [ ] **Compliance hardening (folded in from the former Phase 14):** integration tests for RLS policy
      behavior; data-privacy review (encryption at rest/in transit, access logging, **retention
      policy**, backups); concurrency strategy for simultaneous edits (flagged item #7).

---

## 🅿️ Future / parking lot (out of current scope)

* **Billing & payments** — invoices, line items, payments, NHIS/insurance, receipts. Would feed
  the existing financial-clearance gate. Deliberately deferred.
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
