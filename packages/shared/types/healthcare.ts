/**
 * CareFlow core domain models (Phase 6 — Visit-Centric Refactor).
 *
 * These types mirror `packages/db/schema.sql` exactly so that the eventual
 * backend cutover (Phase 13) is a drop-in swap: the mock service layer
 * (`services/mockStorage.ts`) is replaced with `supabase-js` calls and the UI
 * contract — these types — is preserved.
 *
 * Modeling rules (kept faithful to the SQL schema):
 *  - Every entity has a primary-key `id` (a UUID string).
 *  - Relationships are expressed as `*_id` foreign keys, never nested objects.
 *  - **The Visit is the spine of the record.** A patient has many visits over
 *    their lifetime; each visit owns its consultations, vitals, orders, results,
 *    prescriptions and (only when inpatient) an admission.
 *  - Nullable SQL columns are typed `T | null` (not optional `?`), matching how
 *    a row comes back from Postgres. Optional `?` is reserved for fields a row
 *    may genuinely omit at the application layer.
 */

// ---------------------------------------------------------------------------
// Primary-key aliases — UUID strings, named per table for readability.
//
// Branded (nominal) so differently-typed ids cannot be mixed up: a `VisitId`
// no longer type-checks where a `PatientId` is expected. The brand is a
// phantom compile-time tag only — at runtime every id is still a plain
// string (or number for `AuditLogId`), so no behavior changes anywhere.
// Plain strings enter the branded world via an explicit cast at the boundary
// where they are created (`generateId() as PatientId`) or hydrated (server
// rows, seed literals).
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Branded<T, B> = T & { readonly [__brand]: B };

/** Widen one branded id back to its runtime primitive; leaves other types alone. */
type Debrand<V> = V extends Branded<string, infer _B>
  ? string
  : V extends Branded<number, infer _B>
    ? number
    : V;

/**
 * `T` with every branded id field widened to its plain runtime type
 * (distributes over unions, so `DepartmentId | null` widens to
 * `string | null`; string-literal unions like `BedStatus` carry no brand and
 * pass through unchanged). For fixture/seed literals: build rows with plain
 * string ids, then re-brand with a single `as T` cast.
 */
export type Unbranded<T> = { [K in keyof T]: Debrand<T[K]> };

export type HospitalId = Branded<string, "HospitalId">;
export type DepartmentId = Branded<string, "DepartmentId">;
export type WardId = Branded<string, "WardId">;
export type BedId = Branded<string, "BedId">;
export type StaffId = Branded<string, "StaffId">;
export type PatientId = Branded<string, "PatientId">;
export type VisitId = Branded<string, "VisitId">;
export type ConsultationId = Branded<string, "ConsultationId">;
export type DiagnosisId = Branded<string, "DiagnosisId">;
export type OrderId = Branded<string, "OrderId">;
export type ResultId = Branded<string, "ResultId">;
export type PrescriptionId = Branded<string, "PrescriptionId">;
export type MedicationAdministrationId = Branded<string, "MedicationAdministrationId">;
export type TreatmentRecordId = Branded<string, "TreatmentRecordId">;
export type AdmissionId = Branded<string, "AdmissionId">;
export type TransferId = Branded<string, "TransferId">;
export type AllergyId = Branded<string, "AllergyId">;
export type PatientHistoryId = Branded<string, "PatientHistoryId">;
export type RosResponseId = Branded<string, "RosResponseId">;
export type CarePlanItemId = Branded<string, "CarePlanItemId">;
export type CarePlanEntryId = Branded<string, "CarePlanEntryId">;
export type BillableItemId = Branded<string, "BillableItemId">;
export type ChargeId = Branded<string, "ChargeId">;
export type AuditLogId = Branded<number, "AuditLogId">;

/** Supabase `auth.users(id)` — the authenticated user a Staff row links to. */
export type AuthUserId = Branded<string, "AuthUserId">;

/** ISO-8601 timestamp string (Postgres `timestamptz`), e.g. "2026-05-31T14:32:00.000Z". */
export type ISODateString = string;

/** Date-only string (Postgres `date`), e.g. "1989-03-14". */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Enumerated types (1:1 with the SQL `create type ... as enum` declarations).
//
// Each union is derived from an exported `as const` member array (identical
// names + member order as the SQL) so `types/enum-parity.test.ts` can assert
// the lists never drift from `packages/db/schema.sql`.
// ---------------------------------------------------------------------------

/**
 * `subscription_status` — a hospital tenant's account standing. `trial` on
 * signup, `active` once paying, `suspended` cuts off access (gating hook).
 */
export const SUBSCRIPTION_STATUSES = ["trial", "active", "suspended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** `staff_role` — expanded beyond clinical roles to cover the whole hospital. */
export const STAFF_ROLES = [
  "doctor",
  "nurse",
  "admin",
  "lab_tech",
  "pharmacist",
  "receptionist",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** `sex_type` */
export const SEXES = ["male", "female", "other", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

/** `visit_type` — outpatient (sees a doctor and leaves) vs inpatient vs emergency. */
export const VISIT_TYPES = ["outpatient", "inpatient", "emergency"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/**
 * `triage_level` — emergency-severity acuity that orders the queue: who is seen
 * first. 1 = immediate/critical (resuscitation) … 5 = non-urgent. Modeled on the
 * 5-level Emergency Severity Index. `null` until a nurse triages the visit.
 */
export type TriageLevel = 1 | 2 | 3 | 4 | 5;

/** `visit_status` — lifecycle of a single encounter. */
export const VISIT_STATUSES = ["open", "closed", "cancelled"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/**
 * `care_stage` — the care-journey stage that drives the live kanban board.
 * Replaces the old 4-value `AdmissionStage`; now models the full path from
 * registration through follow-up, including the outpatient short-circuit.
 */
export const CARE_STAGES = [
  "registration",
  "triage",
  "consultation",
  "diagnostics",
  "treatment",
  "discharge_planning",
  "discharged",
  "followed_up",
  // Terminal outcome: the patient died in care. Closes the visit (like a
  // discharge) but is counted separately from discharges in reporting.
  "deceased",
] as const;
export type CareStage = (typeof CARE_STAGES)[number];

/** `order_type` — category of a recommended test. */
export const ORDER_TYPES = ["lab", "imaging", "procedure"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

// ---------------------------------------------------------------------------
// Clinical term library (Phase 16.10) — autocomplete dictionary for clinical
// fields. The seed layer is bundled JSON (one file per category); the learned
// layer (custom terms + usage counts) grows at runtime. Both share this shape.
// ---------------------------------------------------------------------------

/** The clinical fields the term-autocomplete library serves. */
export type ClinicalTermCategory =
  | "subjective"
  | "examination"
  | "assessment"
  | "plan"
  | "medication"
  | "investigations"
  // Phase 21 follow-up: patient-background autocomplete (past-surgical
  // procedures and vaccines for the immunization history).
  | "procedures"
  | "immunizations";

/**
 * A single entry in the clinical-term library. Bilingual, with synonyms (incl.
 * lay terms) so partial/colloquial spellings still surface it. Category-specific
 * fields are populated only for their own category and are `null`/absent
 * otherwise. `investigations` is one combined bucket for lab + imaging +
 * procedure — `order_type` routes a selected term to the right `Order` type.
 *
 * Seed files omit `category` (it is stamped from the filename by the loader);
 * the in-memory shape always carries it.
 */
export interface ClinicalTerm {
  category: ClinicalTermCategory;
  /** Canonical English term (display + match). */
  term_en: string;
  /** Canonical French term (display + match). */
  term_fr: string;
  /** Alternative English spellings / lay terms (match only). */
  synonyms_en?: string[];
  /** Alternative French spellings / lay terms (match only). */
  synonyms_fr?: string[];
  /** Body system (subjective / examination), else null. */
  system?: string | null;
  /** ICD-10 code (assessment), else null. */
  icd10?: string | null;
  /** Routing for investigations (lab / imaging / procedure), else null. */
  order_type?: OrderType | null;
  /** Medication: typical dose (e.g. "500 mg"), else null. */
  dose?: string | null;
  /** Medication: route (e.g. "oral", "IV"), else null. */
  route?: string | null;
  /** Medication: frequency (e.g. "every 8 hours"), else null. */
  frequency?: string | null;
  /** Medication: dose form (e.g. "tablet", "syrup"), else null. */
  form?: string | null;
  /** Medication: drug class (e.g. "antibiotic"), else null. */
  drug_class?: string | null;
}

/** The file shape pasted into `data/clinical-terms/<category>.json` — no `category`. */
export type ClinicalTermSeed = Omit<ClinicalTerm, "category">;

/**
 * The synced, per-hospital learned layer of the term library (Stage 2 — mirrors
 * the `clinical_terms` Postgres table). One row per learned term key holding
 * both the optional doctor-added custom term (null for seed-library terms that
 * only accrued usage) and its usage ranking stats. Replaces the old device-only
 * localStorage blob, so custom vocabulary follows the hospital, not the device.
 */
export interface ClinicalTermRow {
  id: string;
  hospital_id: HospitalId;
  /** Stable identity: category + normalized English label (see `termKey`). */
  term_key: string;
  category: ClinicalTermCategory;
  /** The doctor-added custom term payload, or null for seed-term usage rows. */
  custom_term: ClinicalTerm | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `order_status` — lifecycle of an order until its result closes the loop. */
export const ORDER_STATUSES = [
  "requested",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * `billing_category` — the kind of billable line item, used to group the price
 * catalog and to drive how a charge is computed (flat per-item vs time-based).
 */
export const BILLING_CATEGORIES = [
  "consultation",
  "lab_test",
  "imaging",
  "procedure",
  "medication",
  "bed_per_night",
  "nursing_per_day",
  "other",
] as const;
export type BillingCategory = (typeof BILLING_CATEGORIES)[number];

/**
 * `billing_unit` — how a billable item is quantified. `per_item` is a flat
 * one-off; `per_night`/`per_day` are time-based and computed at billing time
 * from the admission/transfers timeline.
 */
export const BILLING_UNITS = ["per_item", "per_night", "per_day"] as const;
export type BillingUnit = (typeof BILLING_UNITS)[number];

/**
 * `charge_source` — provenance of a ledger charge. Auto-generated charges
 * (everything except `manual`/`discount`) are reconciled idempotently against
 * their originating clinical record via `Charge.source_ref_id`. `manual` and
 * `discount` rows are operator-entered and never reconciled away.
 */
export const CHARGE_SOURCES = [
  "consultation",
  "order",
  "prescription",
  "bed",
  "nursing",
  "procedure",
  "manual",
  "discount",
] as const;
export type ChargeSource = (typeof CHARGE_SOURCES)[number];

/** `charge_status` — settlement state of a single ledger line. */
export const CHARGE_STATUSES = ["pending", "paid", "waived"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** `bed_status` — drives live occupancy on the floor map. */
export const BED_STATUSES = [
  "free",
  "occupied",
  "reserved",
  "cleaning",
  "maintenance",
] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

/** `admission_status` */
export const ADMISSION_STATUSES = ["active", "discharged"] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/** `prescription_status` */
export const PRESCRIPTION_STATUSES = ["active", "completed", "discontinued"] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/**
 * `mar_status` — Medication Administration Record: what actually happened at the
 * bedside for a single scheduled dose.
 */
export const MAR_STATUSES = ["given", "held", "refused", "missed", "suspended"] as const;
export type MarStatus = (typeof MAR_STATUSES)[number];

/** `allergy_category` — what kind of substance the patient reacts to. */
export const ALLERGY_CATEGORIES = ["drug", "food", "environmental", "other"] as const;
export type AllergyCategory = (typeof ALLERGY_CATEGORIES)[number];

/**
 * `allergy_severity` — clinical seriousness, worst-first when displayed.
 * `life_threatening` covers anaphylaxis and must never be buried in a list.
 */
export const ALLERGY_SEVERITIES = [
  "mild",
  "moderate",
  "severe",
  "life_threatening",
] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

/**
 * `body_system` — the Review-of-Systems axis (Phase 21). Mirrors the `system`
 * tags in the clinical-term library so a subjective term routes to its module.
 */
export const BODY_SYSTEMS = [
  "general",
  "cardiac",
  "respiratory",
  "gi",
  "gu",
  "neuro",
  "ent",
  "eyes",
  "skin",
  "musculoskeletal",
  "psych",
  "obstetric_gynae",
] as const;
export type BodySystem = (typeof BODY_SYSTEMS)[number];

/**
 * `ros_answer_type` — how a bank question is answered; drives which selectable
 * control the UI renders and how `answer_value` is stored.
 */
export const ROS_ANSWER_TYPES = [
  "boolean",
  "single_select",
  "multi_select",
  "scale",
  "duration",
  "numeric",
  "date",
  "text",
] as const;
export type RosAnswerType = (typeof ROS_ANSWER_TYPES)[number];

/**
 * `ros_question_kind` — lets one system module carry symptom questions AND the
 * pertinent history/genetics questions for that system.
 */
export const ROS_QUESTION_KINDS = ["symptom", "history", "genetic"] as const;
export type RosQuestionKind = (typeof ROS_QUESTION_KINDS)[number];

/** `patient_history_type` — the kind of clinical-background record. */
export const PATIENT_HISTORY_TYPES = [
  "past_medical",
  "past_surgical",
  "family",
  "social",
  "obstetric_gynae",
  "medication",
  "immunization",
] as const;
export type PatientHistoryType = (typeof PATIENT_HISTORY_TYPES)[number];

/** `marital_status` — demographic context. */
export const MARITAL_STATUSES = [
  "single",
  "married",
  "partnered",
  "divorced",
  "widowed",
  "unknown",
] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

/**
 * `care_need_category` — the kind of basic nursing care an admitted patient
 * needs, based on Virginia Henderson's 14 components of basic nursing care
 * (named practically for everyday use). Drives the quick-pick on the care-plan
 * page so categories are chosen, not typed.
 */
export const CARE_NEED_CATEGORIES = [
  "breathing",
  "nutrition",
  "elimination",
  "mobility_positioning",
  "sleep_rest",
  "hygiene",
  "temperature",
  "dressing",
  "safety",
  "communication_emotional",
  "pain_comfort",
  "spiritual",
  "wound_skin_care",
  "other",
] as const;
export type CareNeedCategory = (typeof CARE_NEED_CATEGORIES)[number];

/** `care_plan_item_status` — an active need vs one that has been resolved. */
export const CARE_PLAN_ITEM_STATUSES = ["active", "resolved"] as const;
export type CarePlanItemStatus = (typeof CARE_PLAN_ITEM_STATUSES)[number];

/**
 * `care_item_kind` (Phase 20 — doctor↔nurse shared care list). One shared list on
 * the patient carries three kinds of item:
 *  - `nursing_need`  — a nurse-authored ADL/Henderson care need (the original use).
 *  - `instruction`   — a one-off doctor instruction to nursing ("encourage fluids").
 *  - `monitoring`    — a recurring doctor order ("vitals every 1h"); its `frequency`
 *                      drives a due/overdue cue via the same parser the MAR uses.
 */
export const CARE_ITEM_KINDS = ["nursing_need", "instruction", "monitoring"] as const;
export type CareItemKind = (typeof CARE_ITEM_KINDS)[number];

/**
 * `usage_event_type` — the kinds of usage-telemetry event the hospital app
 * emits into `usage_events` (Phase 19.1). Metadata-only; never PHI.
 */
export const USAGE_EVENT_TYPES = [
  "login",
  "patient_registered",
  "visit_opened",
  "record_created",
  "sync_failed",
  "feature_used",
] as const;
export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

/**
 * `ai_feature` — which AI Clinical Assist feature produced an `ai_suggestions`
 * row (Phase 22): Moment 1 (`plan`), Moment 2 (`results`), or Ask CareFlow
 * in patient / cohort mode.
 */
export const AI_FEATURES = ["plan", "results", "ask_patient", "ask_cohort"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * `ai_decision` — what the clinician did with an AI suggestion. Every row
 * starts `shown`; the UI records `accepted` / `edited` / `dismissed`.
 */
export const AI_DECISIONS = ["shown", "accepted", "edited", "dismissed"] as const;
export type AiDecision = (typeof AI_DECISIONS)[number];

// ---------------------------------------------------------------------------
// 4·0 Tenant / account (multi-tenancy — Phase 17)
// ---------------------------------------------------------------------------

/**
 * `hospitals` — the account/tenant entity. CareFlow is pooled multi-tenancy:
 * every other row carries a `hospital_id` and a tenant only ever sees its own
 * data (RLS via `current_hospital_id()` on the real backend; scoped reads in the
 * mock). One hospital == one isolated customer account.
 */
export interface Hospital {
  id: HospitalId;
  name: string;
  /** Region / city, e.g. "Littoral — Douala". */
  region: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  /** Monetization tier, e.g. "standard"; drives feature gating later. */
  subscription_tier: string;
  subscription_status: SubscriptionStatus;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4a. Reference / structural data (the editable "floor map")
// ---------------------------------------------------------------------------

/** `departments` — e.g. Maternity, Ophthalmology, Internal Medicine. */
export interface Department {
  id: DepartmentId;
  /** Owning tenant. Scoped per hospital; `code`/`name` unique within it. */
  hospital_id: HospitalId;
  name: string;
  /** Short code, e.g. "MAT", "OPH". */
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/** `wards` — a floor/unit belonging to a department; holds beds. */
export interface Ward {
  id: WardId;
  hospital_id: HospitalId;
  department_id: DepartmentId | null;
  name: string;
  /** Physical block/building, e.g. "Block A", "Maternity Wing". */
  block: string | null;
  /** e.g. "2nd Floor", "Block C". */
  floor_label: string | null;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/** `beds` — one row per physical bed; status + admission link keep occupancy live. */
export interface Bed {
  id: BedId;
  hospital_id: HospitalId;
  ward_id: WardId;
  /** e.g. "Bed 12", "A-04". Unique within a ward. */
  label: string;
  status: BedStatus;
  /** Back-reference set by the occupancy sync when a patient is assigned. */
  current_admission_id: AdmissionId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4b. People
// ---------------------------------------------------------------------------

/**
 * `staff` — links to a Supabase auth user so "logging in as a doctor" is real
 * authentication rather than a dropdown. Department is now an FK, not free text.
 */
export interface Staff {
  id: StaffId;
  hospital_id: HospitalId;
  /** FK -> auth.users(id). Null until a login is provisioned. */
  user_id: AuthUserId | null;
  full_name: string;
  role: StaffRole;
  department_id: DepartmentId | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/** `patients` — the stable person record, referenced by every visit. */
export interface Patient {
  id: PatientId;
  hospital_id: HospitalId;
  /**
   * Human-facing patient ID — the Cameroon-standard booklet number generated at
   * registration (Phase 16.7). Format: `YYMMDD` + name initials + ` - ` +
   * mother's-first-name initial, e.g. "981120BHN - N" (born 1998-11-20, mother
   * Ndung). On a clash, a counter is appended (`… - N-2`). The field name stays
   * `mrn` for continuity, but it is no longer the old `CF-YYYY-NNNNNN` sequence.
   * NULL for an emergency-anonymous record until reconciliation supplies real
   * details — NULL (not "") so multiple unidentified patients coexist under the
   * `unique (hospital_id, mrn)` constraint (Postgres allows many NULLs, but "" is
   * a value that would collide). The patient UUID (`id`) is the true internal key.
   */
  mrn: string | null;
  full_name: string;
  date_of_birth: ISODate | null;
  /**
   * Mother's first name (optional). Used only to derive the patient ID's
   * trailing initial; blank means the ID has no ` - <initial>` suffix.
   */
  mother_first_name: string | null;
  sex: Sex;
  phone: string | null;
  address: string | null;
  /** Government national ID / NHIS, once known. Unique. */
  national_id: string | null;

  /**
   * Emergency anonymous intake (unconscious / unidentified patient). When set,
   * an `anonymous_identifier` (e.g. "John Doe - Gamma - 20260531") is generated
   * to bypass paperwork; both are cleared once reconciled to a real profile.
   */
  is_emergency_anonymous: boolean;
  anonymous_identifier: string | null;

  /**
   * Set true only when a clinician has actively confirmed the patient has no
   * known allergies. A patient with an empty allergy list AND this flag false
   * means "not yet asked" — clinically very different from "confirmed none".
   */
  no_known_allergies: boolean;

  /** Demographic context (Phase 21). All optional at intake. */
  occupation: string | null;
  marital_status: MaritalStatus;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;

  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `allergies` — a patient-level safety record. Surfaced wherever a clinician
 * might prescribe, so a known reaction is never missed. Keyed to the patient
 * (not the visit) because an allergy persists across every encounter.
 */
export interface Allergy {
  id: AllergyId;
  hospital_id: HospitalId;
  patient_id: PatientId;
  /** The offending substance, e.g. "Penicillin", "Peanuts". */
  substance: string;
  category: AllergyCategory;
  severity: AllergySeverity;
  /** The reaction it provokes, e.g. "Anaphylaxis", "Rash". */
  reaction: string | null;
  /** Who documented it. */
  noted_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `patient_history` — patient-level clinical background (Phase 21). Keyed to
 * the patient (not a visit) because history persists across encounters —
 * pre-filled on every return visit (review-and-update, not re-enter). One
 * table carries all seven history types, distinguished by `type` (the same
 * "single shared list by kind" approach as `care_plan_items.kind`).
 */
export interface PatientHistory {
  id: PatientHistoryId;
  hospital_id: HospitalId;
  patient_id: PatientId;
  type: PatientHistoryType;
  /** e.g. "Type 2 diabetes", "Appendectomy 2015", "Mother — breast cancer". */
  description: string;
  /**
   * Type-specific structured fields without a table per type:
   *   social → {tobacco_pack_years, alcohol, drugs}
   *   obstetric_gynae → {gravida, para, lmp}
   *   family → {relation, condition}
   */
  detail: Record<string, unknown> | null;
  /** Coarse timing: "2015", "childhood", "since 2020". */
  onset: string | null;
  /** past_medical: still active? null = not applicable. */
  is_active: boolean | null;
  noted_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// Review of Systems (Phase 21) — question bank shapes (reference data from
// data/ros/<system>.json) and the persisted per-encounter answer rows.
// ---------------------------------------------------------------------------

/** A selectable option on a `single_select` / `multi_select` / `scale` question. */
export interface RosOption {
  value: string;
  label_en: string;
  label_fr: string;
}

/**
 * One self-describing question node in the ROS bank. Follow-ups are one level
 * deep in v1 and are revealed only when the parent answer matches `show_if`.
 */
export interface RosQuestion {
  /** Stable id, e.g. "cardiac.chest_pain" — snapshotted onto answers. */
  key: string;
  system: BodySystem;
  kind: RosQuestionKind;
  prompt_en: string;
  prompt_fr: string;
  type: RosAnswerType;
  /** High-yield → shown first / included in quick review. */
  key_question?: boolean;
  /** 'female' gates obstetric questions by default (always addable), else null. */
  sex?: Sex | null;
  /** Used to compile the narrative report. */
  report_phrase_en?: string;
  report_phrase_fr?: string;
  options?: RosOption[];
  /** Optional complaint keys that promote this question. */
  triggers?: string[];
  followups?: RosQuestion[];
  /** On a follow-up: parent answer that reveals it (e.g. "yes"). */
  show_if?: string;
}

/**
 * The raw answer shape by `answer_type`:
 * boolean→true|false · single_select/scale→"crushing" · multi_select→["nausea"]
 * · duration/numeric→{value,unit} · date→"2026-06-14" · text→"…".
 */
export type RosAnswerValue =
  | boolean
  | string
  | string[]
  | { value: number; unit?: string };

/**
 * `ros_responses` — a single answered ROS question for one encounter (Phase
 * 21). Rows exist only for questions the doctor answered — absence = "not
 * asked". `question_text` and `answer_label` are denormalized snapshots (same
 * principle as `diagnoses.description` beside `icd10_code`) so bank edits
 * never rewrite past encounters. Unique on (visit_id, question_key):
 * re-answering updates in place.
 */
export interface RosResponse {
  id: RosResponseId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  consultation_id: ConsultationId | null;
  system: BodySystem;
  question_key: string;
  kind: RosQuestionKind;
  /** Snapshot of the prompt at answer time. */
  question_text: string;
  answer_type: RosAnswerType;
  answer_value: RosAnswerValue;
  /** Localized human-readable answer for the report, e.g. "Crushing", "3 days". */
  answer_label: string;
  /** Optional free qualifier. */
  note: string | null;
  recorded_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4c. The visit (record spine)
// ---------------------------------------------------------------------------

/**
 * `visits` — one trip the patient makes to the hospital, and the spine of the
 * whole record. Consultations, diagnoses, orders, prescriptions, vitals and
 * (only for inpatients) an admission all hang off a visit.
 */
export interface Visit {
  id: VisitId;
  hospital_id: HospitalId;
  patient_id: PatientId;
  visit_type: VisitType;
  status: VisitStatus;
  stage: CareStage;
  department_id: DepartmentId | null;
  attending_doctor_id: StaffId | null;
  /** Who did the nurse intake / registration. */
  registered_by_id: StaffId | null;
  chief_complaint: string | null;
  /** Nurse's initial triage notes / observations. */
  triage_notes: string | null;
  /** Emergency-severity acuity (1 = critical … 5 = non-urgent); null until triaged. */
  triage_level: TriageLevel | null;
  arrived_at: ISODateString;
  closed_at: ISODateString | null;
  // Disposition details captured by the doctor (optional; set when the matching
  // disposition is chosen). Observation → keep-under-watch; referral → sent out.
  /** What the patient is being observed for. */
  observation_reason?: string | null;
  /** How long the observation should run, e.g. "6 hours". */
  observation_duration?: string | null;
  /** Where the observation takes place, e.g. "Observation bay", a ward name. */
  observation_location?: string | null;
  /** Why the patient is being referred. */
  referral_reason?: string | null;
  /** Facility the patient is referred to. */
  referral_facility?: string | null;
  /** Specific person/clinician the referral is addressed to (optional). */
  referral_recipient?: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4d. Clinical record (hangs off a visit)
// ---------------------------------------------------------------------------

/** `consultations` — the doctor's SOAP-style note for a visit. */
export interface Consultation {
  id: ConsultationId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  doctor_id: StaffId | null;
  /** What the patient reports (S). */
  subjective: string | null;
  /** Physical exam findings (O). */
  examination: string | null;
  /** The doctor's clinical assessment (A). */
  assessment: string | null;
  /** The plan: tests, meds, admit/discharge (P). */
  plan: string | null;
  /**
   * Compiled Review-of-Systems narrative (Phase 21), derived on save from the
   * structured `ros_responses` rows — which remain the source of truth.
   */
  ros_summary: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/** `diagnoses` — structured diagnosis (ICD-10 where possible). */
export interface Diagnosis {
  id: DiagnosisId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  consultation_id: ConsultationId | null;
  diagnosed_by_id: StaffId | null;
  icd10_code: string | null;
  description: string;
  /** Primary diagnosis flag — powers "top conditions" reports. */
  is_primary: boolean;
  created_at: ISODateString;
}

/** `orders` — a test the doctor recommends (lab / imaging / procedure). */
export interface Order {
  id: OrderId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  ordered_by_id: StaffId | null;
  order_type: OrderType;
  /** e.g. "Full Blood Count", "Chest X-ray". */
  description: string;
  status: OrderStatus;
  created_at: ISODateString;
  completed_at: ISODateString | null;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `results` — closes the order loop. Attachments (scans, PDFs) live in the
 * private `lab-results` storage bucket; `attachment_path` is the object path.
 */
export interface Result {
  id: ResultId;
  hospital_id: HospitalId;
  order_id: OrderId;
  recorded_by_id: StaffId | null;
  summary: string | null;
  /** Numeric or text result value. */
  value: string | null;
  reference_range: string | null;
  /** Flagged out-of-range / clinically significant; drives review highlighting. */
  is_abnormal: boolean;
  attachment_path: string | null;
  recorded_at: ISODateString;
}

/** `prescriptions` — the "structure of medication" written by a doctor. */
export interface Prescription {
  id: PrescriptionId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  prescribed_by_id: StaffId | null;
  drug_name: string;
  /** e.g. "500 mg". */
  dose: string | null;
  /** e.g. "oral", "IV". */
  route: string | null;
  /** e.g. "every 8 hours". */
  frequency: string | null;
  /** e.g. "5 days". */
  duration: string | null;
  /** Timing relative to food. */
  meal_timing?: MealTiming | null;
  instructions: string | null;
  status: PrescriptionStatus;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * How a medication is taken relative to food. Not a Postgres enum:
 * `prescriptions.meal_timing` is `text` with a `check (meal_timing in (…))`
 * constraint, which the parity test parses and verifies against this array.
 */
export const MEAL_TIMINGS = ["with_meals", "without_meals", "neutral"] as const;
export type MealTiming = (typeof MEAL_TIMINGS)[number];

/**
 * `medication_administrations` (MAR) — one row each time a nurse gives, holds,
 * refuses or misses a dose. This is how an on-call nurse knows what to give next
 * without going back to the doctor, and the proof that care was delivered.
 */
export interface MedicationAdministration {
  id: MedicationAdministrationId;
  hospital_id: HospitalId;
  prescription_id: PrescriptionId;
  administered_by_id: StaffId | null;
  scheduled_for: ISODateString | null;
  administered_at: ISODateString | null;
  status: MarStatus;
  notes: string | null;
  created_at: ISODateString;
}

/**
 * `treatment_records` — vitals / nursing checkpoints, keyed to the visit.
 *
 * NOTE: vitals are now flat columns (matching the SQL schema), not a nested
 * `vitals` object as in the pre-Phase-6 model. Each numeric is nullable.
 */
export interface TreatmentRecord {
  id: TreatmentRecordId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  recorded_by_id: StaffId | null;
  /** Peripheral oxygen saturation (SpO₂), percentage. */
  spo2: number | null;
  /** Heart rate / pulse, beats per minute. */
  pulse: number | null;
  /** Systolic blood pressure, mmHg. */
  bp_systolic: number | null;
  /** Diastolic blood pressure, mmHg. */
  bp_diastolic: number | null;
  /** Body temperature, degrees Celsius. */
  temperature_c: number | null;
  /** Body weight, kilograms. Null when not measured. */
  weight_kg: number | null;
  /** Glasgow Coma Scale total (3–15). Null when not assessed. */
  gcs_score: number | null;
  notes: string | null;
  recorded_at: ISODateString;
}

// ---------------------------------------------------------------------------
// 4e. Admission (inpatient only; links a visit to a bed)
// ---------------------------------------------------------------------------

/**
 * `admissions` — created only when a visit results in an inpatient stay. Links
 * the visit to a ward/bed and carries the three discharge clearance gates.
 */
export interface Admission {
  id: AdmissionId;
  hospital_id: HospitalId;
  visit_id: VisitId;
  patient_id: PatientId;
  attending_doctor_id: StaffId | null;
  ward_id: WardId | null;
  bed_id: BedId | null;
  status: AdmissionStatus;
  stage: CareStage;
  reason: string | null;

  // Discharge clearance gates — all three must be true before discharge.
  is_medical_cleared: boolean;
  is_financial_cleared: boolean;
  is_pharmacy_ready: boolean;

  admitted_at: ISODateString;
  discharged_at: ISODateString | null;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `transfers` — an append-only event recording a patient moving wards, beds, or
 * attending doctors during an admission. The admission row always holds the
 * *current* placement; transfers hold the history (bed-movement audit + the
 * "ICU → general ward" / change-of-doctor trail). Null from/to fields mean that
 * dimension did not change in this move.
 */
export interface Transfer {
  id: TransferId;
  hospital_id: HospitalId;
  admission_id: AdmissionId;
  patient_id: PatientId;
  from_ward_id: WardId | null;
  to_ward_id: WardId | null;
  from_bed_id: BedId | null;
  to_bed_id: BedId | null;
  from_doctor_id: StaffId | null;
  to_doctor_id: StaffId | null;
  reason: string | null;
  transferred_by_id: StaffId | null;
  created_at: ISODateString;
}

// ---------------------------------------------------------------------------
// 4g. Nursing care plan (inpatient — non-medication, needs-based care)
// ---------------------------------------------------------------------------

/**
 * `care_plan_items` — the **plan**: a single individualized nursing-care need an
 * admitted patient has (e.g. "turn every 2h to prevent pressure sores"). The MAR
 * tracks medication; this tracks the ADL/needs-based care (bathing, feeding,
 * positioning, temperature control, comfort…) that fills most of a nursing
 * shift. Keyed to the admission (inpatient stay), with a denormalized
 * `patient_id` for convenient lookups.
 */
export interface CarePlanItem {
  id: CarePlanItemId;
  hospital_id: HospitalId;
  admission_id: AdmissionId;
  patient_id: PatientId;
  /**
   * Nurse ADL need vs. doctor instruction vs. recurring monitoring order — lets
   * one shared list carry all three (Phase 20). Defaults to `nursing_need`.
   */
  kind: CareItemKind;
  /**
   * Who raised it, for color-coding "who asked" in the shared list (usually the
   * creator's role). Null on legacy rows created before Phase 20.
   */
  authored_role: StaffRole | null;
  /**
   * Henderson care-need tag — only meaningful for `nursing_need` items, so now
   * nullable (doctor instructions / monitoring orders leave it null).
   */
  category: CareNeedCategory | null;
  /** What the patient needs, e.g. "Assist with bed bath, keep skin dry". */
  description: string;
  /** Free text, e.g. "Every 2h", "Each meal", "As needed". */
  frequency: string | null;
  /**
   * `monitoring` only: what is being monitored. `"vitals"` anchors due/overdue on
   * the latest `treatment_record`; null/other anchors on the latest care-log
   * entry for the item. Null for non-monitoring kinds.
   */
  monitors: string | null;
  /** Optional target/outcome, e.g. "Skin remains intact". */
  goal: string | null;
  status: CarePlanItemStatus;
  created_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `care_plan_entries` — the **log + handover**: an append-only note recording
 * care that was delivered, or a shift-handover message for the next nurse. Never
 * overwritten (mirrors the `transfers` append-only pattern), so continuity
 * survives a nurse handover. Optionally tied to a specific care-plan item.
 */
export interface CarePlanEntry {
  id: CarePlanEntryId;
  hospital_id: HospitalId;
  admission_id: AdmissionId;
  /** The need this note relates to, when applicable. */
  care_plan_item_id: CarePlanItemId | null;
  note: string;
  /** True when this is an explicit shift-handover note for the next nurse. */
  is_handover: boolean;
  /**
   * Nurse→doctor flag (Phase 20): when true, this note surfaces on the doctor's
   * "needs you" queue until a doctor acknowledges it. The acknowledged_* pair
   * records who cleared it and when; both null while still waiting.
   */
  needs_doctor: boolean;
  acknowledged_by_id: StaffId | null;
  acknowledged_at: ISODateString | null;
  recorded_by_id: StaffId | null;
  recorded_at: ISODateString;
}

// ---------------------------------------------------------------------------
// 4g-bis. Billing & invoicing (Phase 16.9)
// ---------------------------------------------------------------------------

/**
 * `billable_items` — the **price catalog**: a per-tenant list of services and
 * goods the hospital can bill for, each with a current unit price in whole XAF
 * (West African CFA franc has no minor unit, so prices are integers). The
 * catalog is the source of the *current* price; a `Charge` snapshots the price
 * at the moment it is raised, so later edits to the catalog never rewrite an
 * existing bill.
 */
export interface BillableItem {
  id: BillableItemId;
  hospital_id: HospitalId;
  /** Grouping + computation hint (flat vs time-based). */
  category: BillingCategory;
  /** Human label shown on the bill and in the catalog admin, e.g. "Chest X-ray". */
  name: string;
  /** How the item is quantified (per_item / per_night / per_day). */
  unit: BillingUnit;
  /** Current unit price in whole XAF. */
  unit_price: number;
  /**
   * Stable code linking auto-generated charges back to their origin. For beds
   * this is the ward id (`ward_*`), for nursing a fixed sentinel, for
   * order/consultation items the order/visit-type key. `null` for free-form
   * manual catalog entries. Lets the catalog drive auto-charge pricing.
   */
  ref_code: string | null;
  /** Soft toggle: inactive items stay on old bills but can't be newly charged. */
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

/**
 * `charges` — the **billing ledger**: one line per billable event on a visit.
 * Auto-generated lines (beds, nursing, ordered tests, consultations) are
 * reconciled idempotently against their clinical origin via `source_ref_id`,
 * so re-running the auto-charge pass never double-bills. `manual` lines (extra
 * goods/services) and `discount` lines (negative amounts) are operator-entered
 * and preserved across reconciliation. The unit price is **snapshotted** at
 * creation time so catalog edits never silently rewrite a raised bill.
 */
export interface Charge {
  id: ChargeId;
  hospital_id: HospitalId;
  /** The visit this charge belongs to (bills are scoped per visit). */
  visit_id: VisitId;
  /** Catalog item this charge priced from, when applicable. */
  billable_item_id: BillableItemId | null;
  /** Provenance — drives reconciliation behaviour. */
  source: ChargeSource;
  /**
   * Idempotency key for auto-generated charges: the id of the originating row
   * (order id, ward-segment key, nursing-day key, consultation/visit key).
   * `null` for `manual`/`discount` lines, which are never auto-reconciled.
   */
  source_ref_id: string | null;
  /** Snapshotted human label shown on the bill, e.g. "Bed — ICU (3 nights)". */
  description: string;
  /** Quantity (nights, days, or item count). Integer. */
  quantity: number;
  /** Snapshotted unit price in whole XAF at the time the charge was raised. */
  unit_price: number;
  /**
   * Line total in whole XAF (`quantity * unit_price`), persisted for audit and
   * to keep totals stable even if the formula changes. Negative for discounts.
   */
  amount: number;
  /** Settlement state of this line. */
  status: ChargeStatus;
  created_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4h. Audit log
// ---------------------------------------------------------------------------

/**
 * `audit_log` — append-only trail written by the SECURITY DEFINER audit trigger
 * (Phase 13). Admin-readable, client-tamper-proof. Modeled here for the
 * reporting/admin UI that will read it.
 */
export interface AuditLog {
  id: AuditLogId;
  /** Tenant the change belongs to. Nullable (system events may be tenantless). */
  hospital_id: HospitalId | null;
  table_name: string;
  record_id: string | null;
  /** INSERT / UPDATE / DELETE. */
  action: string;
  /** auth.users id of the actor. */
  changed_by_user: AuthUserId | null;
  /** Resolved staff id of the actor. */
  changed_by_staff: StaffId | null;
  changed_at: ISODateString;
  old_data: unknown | null;
  new_data: unknown | null;
}

// ---------------------------------------------------------------------------
// 4i. Post-discharge follow-up
// ---------------------------------------------------------------------------

/**
 * `kind` — the flavour of follow-up contact a task represents. Not a Postgres
 * enum: `follow_up_tasks.kind` is `text` with a `check (kind in (...))`
 * constraint, which the parity test also parses and verifies.
 */
export const FOLLOW_UP_KINDS = ["call", "tele_checkin", "summary_delivery"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

/**
 * `status` — lifecycle of a follow-up task from scheduling to closure. Like
 * `kind`, a text-with-check column (not a Postgres enum) — see the parity test.
 */
export const FOLLOW_UP_STATUSES = ["pending", "done", "cancelled"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/**
 * `follow_up_tasks` — the post-discharge worklist. Two tasks are scheduled
 * automatically when a visit reaches a terminal discharge stage (a recovery
 * call at +2 days and a tele check-in at +7 days); staff work the list from
 * the Follow-ups screen. `title` is patient-facing display data assembled at
 * creation time (not an i18n key).
 */
export interface FollowUpTask {
  id: string;
  hospital_id: HospitalId;
  patient_id: PatientId;
  /** The discharge visit that scheduled this task, when known. */
  visit_id: VisitId | null;
  kind: FollowUpKind;
  /** Plain-language description shown on the worklist, e.g. "Call Awa Tabi — …". */
  title: string;
  /** When the contact is due. */
  due_at: ISODateString;
  status: FollowUpStatus;
  completed_at: ISODateString | null;
  completed_by_id: StaffId | null;
  notes: string | null;
  created_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  /** Optimistic-concurrency version (server-managed; absent until first sync). */
  version?: number;
}

// ---------------------------------------------------------------------------
// 4j. Notifications + Web Push
// ---------------------------------------------------------------------------

export type NotificationId = Branded<string, "NotificationId">;

/**
 * Machine key for a notification event. The bell localises copy from this key +
 * {@link Notification.data}; `title`/`body` on the row are English fallbacks
 * used by Web Push (built server-side, no i18n) and when a locale template is
 * missing. Add a new member here, an i18n template, and a producer to grow the
 * catalogue. (`notifications.type` is free `text` in SQL — no enum/check to
 * mirror, so this stays a plain union.)
 */
export type NotificationType =
  | "consultation.created" // doctor wrote a SOAP note → nurses
  | "order.created" // test/imaging ordered → lab + nurses
  | "result.recorded" // result entered → ordering + attending doctor
  | "prescription.created" // new medication → nurses + pharmacist
  | "vitals.recorded" // vitals logged (esp. abnormal) → attending doctor
  | "mar.exception" // dose held/refused/missed → prescriber
  | "careplan.escalation" // nurse flagged needs_doctor → attending doctor
  | "careplan.acknowledged" // doctor acknowledged an entry → the nurse
  | "visit.registered" // new visit opened → attending doctor + intake nurse
  | "admission.created" // patient admitted → ward nurses
  | "transfer.recorded" // ward/bed/doctor move → from + to doctor
  | "meds.due_soon" // doses entering the reminder window → ward nurses (SERVER-generated by pg_cron remind_due_medications(), count-only)
  | "meds.overdue"; // doses past due beyond the threshold → ward nurses + attending doctor (SERVER-generated by pg_cron escalate_overdue_medications(), count-only)

/**
 * `notifications` — one row per (recipient, event). The acting client writes
 * rows addressed to OTHER staff into the same outbox as clinical data; Supabase
 * Realtime then streams each insert to its recipient. RLS: insert for any active
 * staff in the hospital, select/update/delete self-only.
 */
export interface Notification {
  id: NotificationId;
  hospital_id: HospitalId;
  /** Staff member who should see it. */
  recipient_staff_id: StaffId;
  /** Staff member whose action produced it (null for system events). */
  actor_staff_id: StaffId | null;
  /** Denormalised actor display name, so the bell needs no staff join. */
  actor_name: string | null;
  type: NotificationType;
  /** English fallback headline (Web Push + missing-template fallback). */
  title: string;
  /** English fallback detail line. */
  body: string | null;
  /** What the notification points at, e.g. "visit" | "patient" | "order". */
  entity_type: string | null;
  /** Id of that entity — usually the visit id, used to open the patient drawer. */
  entity_id: string | null;
  patient_id: PatientId | null;
  patient_name: string | null;
  /** Deep-link path for click-through (fallback when no visit drawer applies). */
  link: string | null;
  /** Structured payload for rich localised rendering. */
  data: Record<string, unknown>;
  /** ISO timestamp the recipient opened/marked it read; null while unread. */
  read_at: ISODateString | null;
  created_at: ISODateString;
}

/**
 * `push_subscriptions` — one row per browser+device that granted OS push
 * permission. Written directly (not through the offline cache), keyed by the
 * unique push `endpoint`. The `send-push` Edge Function reads these to deliver
 * Web Push when the recipient's app is backgrounded or closed.
 */
export interface PushSubscriptionRecord {
  id: string;
  hospital_id: HospitalId;
  staff_id: StaffId;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
