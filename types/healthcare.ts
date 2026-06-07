/**
 * CareFlow core domain models (Phase 6 — Visit-Centric Refactor).
 *
 * These types mirror `supabase/schema.sql` exactly so that the eventual backend
 * cutover (Phase 13) is a drop-in swap: the mock service layer
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
// ---------------------------------------------------------------------------

export type HospitalId = string;
export type DepartmentId = string;
export type WardId = string;
export type BedId = string;
export type StaffId = string;
export type PatientId = string;
export type VisitId = string;
export type ConsultationId = string;
export type DiagnosisId = string;
export type OrderId = string;
export type ResultId = string;
export type PrescriptionId = string;
export type MedicationAdministrationId = string;
export type TreatmentRecordId = string;
export type AdmissionId = string;
export type TransferId = string;
export type AllergyId = string;
export type CarePlanItemId = string;
export type CarePlanEntryId = string;
export type AuditLogId = number;

/** Supabase `auth.users(id)` — the authenticated user a Staff row links to. */
export type AuthUserId = string;

/** ISO-8601 timestamp string (Postgres `timestamptz`), e.g. "2026-05-31T14:32:00.000Z". */
export type ISODateString = string;

/** Date-only string (Postgres `date`), e.g. "1989-03-14". */
export type ISODate = string;

// ---------------------------------------------------------------------------
// Enumerated types (1:1 with the SQL `create type ... as enum` declarations).
// ---------------------------------------------------------------------------

/**
 * `subscription_status` — a hospital tenant's account standing. `trial` on
 * signup, `active` once paying, `suspended` cuts off access (gating hook).
 */
export type SubscriptionStatus = "trial" | "active" | "suspended";

/** `staff_role` — expanded beyond clinical roles to cover the whole hospital. */
export type StaffRole =
  | "doctor"
  | "nurse"
  | "admin"
  | "lab_tech"
  | "pharmacist"
  | "receptionist";

/** `sex_type` */
export type Sex = "male" | "female" | "other" | "unknown";

/** `visit_type` — outpatient (sees a doctor and leaves) vs inpatient vs emergency. */
export type VisitType = "outpatient" | "inpatient" | "emergency";

/**
 * `triage_level` — emergency-severity acuity that orders the queue: who is seen
 * first. 1 = immediate/critical (resuscitation) … 5 = non-urgent. Modeled on the
 * 5-level Emergency Severity Index. `null` until a nurse triages the visit.
 */
export type TriageLevel = 1 | 2 | 3 | 4 | 5;

/** `visit_status` — lifecycle of a single encounter. */
export type VisitStatus = "open" | "closed" | "cancelled";

/**
 * `care_stage` — the care-journey stage that drives the live kanban board.
 * Replaces the old 4-value `AdmissionStage`; now models the full path from
 * registration through follow-up, including the outpatient short-circuit.
 */
export type CareStage =
  | "registration"
  | "triage"
  | "consultation"
  | "diagnostics"
  | "treatment"
  | "discharge_planning"
  | "discharged"
  | "followed_up";

/** `order_type` — category of a recommended test. */
export type OrderType = "lab" | "imaging" | "procedure";

/** `order_status` — lifecycle of an order until its result closes the loop. */
export type OrderStatus = "requested" | "in_progress" | "completed" | "cancelled";

/** `bed_status` — drives live occupancy on the floor map. */
export type BedStatus =
  | "free"
  | "occupied"
  | "reserved"
  | "cleaning"
  | "maintenance";

/** `admission_status` */
export type AdmissionStatus = "active" | "discharged";

/** `prescription_status` */
export type PrescriptionStatus = "active" | "completed" | "discontinued";

/**
 * `mar_status` — Medication Administration Record: what actually happened at the
 * bedside for a single scheduled dose.
 */
export type MarStatus = "given" | "held" | "refused" | "missed";

/** `allergy_category` — what kind of substance the patient reacts to. */
export type AllergyCategory = "drug" | "food" | "environmental" | "other";

/**
 * `allergy_severity` — clinical seriousness, worst-first when displayed.
 * `life_threatening` covers anaphylaxis and must never be buried in a list.
 */
export type AllergySeverity =
  | "mild"
  | "moderate"
  | "severe"
  | "life_threatening";

/**
 * `care_need_category` — the kind of basic nursing care an admitted patient
 * needs, based on Virginia Henderson's 14 components of basic nursing care
 * (named practically for everyday use). Drives the quick-pick on the care-plan
 * page so categories are chosen, not typed.
 */
export type CareNeedCategory =
  | "breathing"
  | "nutrition"
  | "elimination"
  | "mobility_positioning"
  | "sleep_rest"
  | "hygiene"
  | "temperature"
  | "dressing"
  | "safety"
  | "communication_emotional"
  | "pain_comfort"
  | "spiritual"
  | "wound_skin_care"
  | "other";

/** `care_plan_item_status` — an active need vs one that has been resolved. */
export type CarePlanItemStatus = "active" | "resolved";

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
}

/** `wards` — a floor/unit belonging to a department; holds beds. */
export interface Ward {
  id: WardId;
  hospital_id: HospitalId;
  department_id: DepartmentId | null;
  name: string;
  /** e.g. "2nd Floor", "Block C". */
  floor_label: string | null;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
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
   * Empty for an emergency-anonymous record until reconciliation supplies real
   * details. The patient UUID (`id`) remains the true internal key for all FKs.
   */
  mrn: string;
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

  created_at: ISODateString;
  updated_at: ISODateString;
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
  created_at: ISODateString;
  updated_at: ISODateString;
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
  created_at: ISODateString;
  updated_at: ISODateString;
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
  instructions: string | null;
  status: PrescriptionStatus;
  created_at: ISODateString;
  updated_at: ISODateString;
}

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
  category: CareNeedCategory;
  /** What the patient needs, e.g. "Assist with bed bath, keep skin dry". */
  description: string;
  /** Free text, e.g. "Every 2h", "Each meal", "As needed". */
  frequency: string | null;
  /** Optional target/outcome, e.g. "Skin remains intact". */
  goal: string | null;
  status: CarePlanItemStatus;
  created_by_id: StaffId | null;
  created_at: ISODateString;
  updated_at: ISODateString;
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
  recorded_by_id: StaffId | null;
  recorded_at: ISODateString;
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
