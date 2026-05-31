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

// ---------------------------------------------------------------------------
// 4a. Reference / structural data (the editable "floor map")
// ---------------------------------------------------------------------------

/** `departments` — e.g. Maternity, Ophthalmology, Internal Medicine. */
export interface Department {
  id: DepartmentId;
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
  /**
   * Permanent hospital number, auto-assigned on registration
   * (format `CF-YYYY-NNNNNN`, e.g. "CF-2026-000123"). The digital equivalent of
   * the patient-booklet number — stable across every visit.
   */
  mrn: string;
  full_name: string;
  date_of_birth: ISODate | null;
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
  order_id: OrderId;
  recorded_by_id: StaffId | null;
  summary: string | null;
  /** Numeric or text result value. */
  value: string | null;
  reference_range: string | null;
  attachment_path: string | null;
  recorded_at: ISODateString;
}

/** `prescriptions` — the "structure of medication" written by a doctor. */
export interface Prescription {
  id: PrescriptionId;
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

// ---------------------------------------------------------------------------
// 4f. Audit log
// ---------------------------------------------------------------------------

/**
 * `audit_log` — append-only trail written by the SECURITY DEFINER audit trigger
 * (Phase 13). Admin-readable, client-tamper-proof. Modeled here for the
 * reporting/admin UI that will read it.
 */
export interface AuditLog {
  id: AuditLogId;
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
