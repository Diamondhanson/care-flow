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

## PHASE 10 — Prescriptions & Medication Administration (MAR) 🔜

**Goal:** the doctor writes the medication structure; nurses administer it without going back.

* [ ] Prescription entry (drug, dose, route, frequency, duration, instructions).
* [ ] Nurse MAR view: due/overdue doses, one-tap "given / held / refused" with timestamp + author.
* [ ] Shift-handover view summarizing outstanding meds and tasks per ward.

## PHASE 11 — Editable Ward / Bed Floor Map & Occupancy 🔜

**Goal:** admin defines the hospital's physical layout; occupancy stays live.

* [ ] Admin CRUD for **Wards** (name, floor, department) and the **Beds** inside each ward — so an
      admin can manually add the number of wards/floors and how many beds each contains.
* [ ] Assigning an admitted patient to a bed marks it occupied; discharge/transfer frees it —
      **automatic in the Supabase schema via the `sync_bed_occupancy` trigger.**
* [ ] Live floor-map view: per ward/floor, how many beds total / free / occupied, and who's in each
      occupied bed; block assigning a patient when no free bed exists.
* [ ] Backed by the `ward_occupancy` reporting view.

## PHASE 12 — Reporting, Analytics & Export 🔜

**Goal:** the payoff — accurate counts and exportable records for the review board.

* [ ] Dashboard: patients seen per period, admissions vs outpatient, current bed occupancy,
      average length of stay, top diagnoses, medications dispensed, per-department throughput.
* [ ] Date-range filtering (weekly / monthly to match the review board's cadence).
* [ ] **Excel export** (SheetJS) of any report; printable analytics from the dashboard.
* [ ] Backed by the `admission_report` view + new aggregate queries.

## PHASE 13 — Backend Cutover: Supabase, Auth, RBAC & Audit 🔜

**Goal:** swap the mock for a real, secure, multi-user backend.

* [ ] Provision the database — **`supabase/schema.sql` is written and ready to copy-paste** (all
      tables, enums, indexes, triggers, MRN generator, occupancy sync, reporting views, storage
      buckets, and RLS).
* [ ] **Role-based access (implemented at this step, with the backend):** real Supabase Auth login;
      "locked in as a doctor/nurse/admin" enforced by the **RLS policies already defined** in the
      schema (doctors author consultations/orders/prescriptions; nurses record vitals + MAR; lab
      techs enter results; pharmacists update fulfilment; admin manages structure; everyone reads
      the operational record).
* [ ] **Audit trail (implemented at this step):** every change to a sensitive table records *who*
      and *when* plus before/after snapshots — **already wired** via the `audit_trigger` +
      append-only `audit_log` (admin-readable, client-tamper-proof) in the schema.
* [ ] Replace `services/mockStorage.ts` internals with `supabase-js` calls; keep the UI contract
      identical.
* [ ] File storage: lab results / imaging / scanned documents in the private storage buckets.

## PHASE 14 — Hardening & Compliance 🔜

* [ ] Unit/integration tests for gate logic, occupancy, reconciliation, MRN, RLS policy behavior.
* [ ] Data-privacy review (patient data is sensitive — encryption at rest/in transit, access
      logging, retention policy, backups).
* [ ] Error handling, loading/empty states, accessibility pass.
* [ ] Seed/demo + admin onboarding (creating the first admin, departments, wards, beds, staff).

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
2. **Allergies & current medications.** Safety-critical and expected on every chart. A doctor
   prescribing without seeing allergies is a real hazard. *Recommend adding to the patient/visit
   record early.*
3. **Triage acuity / priority.** Who gets seen first? An emergency-severity level (e.g.
   1=critical … 5=non-urgent) on the visit makes the queue meaningful. *Cheap to add now.*
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
