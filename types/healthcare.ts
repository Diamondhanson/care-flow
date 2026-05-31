/**
 * CareFlow core domain models.
 *
 * These types are modeled as a relational database would be: each entity has a
 * primary-key `id` and references other entities through `*_id` foreign keys
 * rather than embedding nested objects. This keeps the shape portable when the
 * mock storage layer (services/mockStorage.ts) is later swapped for supabase-js.
 */

// ---------------------------------------------------------------------------
// Primary key aliases — string IDs, named per table for readability.
// ---------------------------------------------------------------------------

export type StaffId = string;
export type PatientId = string;
export type AdmissionId = string;
export type TreatmentRecordId = string;

/** ISO-8601 timestamp string (e.g. "2026-05-31T14:32:00.000Z"). */
export type ISODateString = string;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type StaffRole = "doctor" | "nurse" | "admin";

/**
 * The four stages of the care journey, mapping to the kanban columns on the
 * Live Status Board.
 */
export type AdmissionStage =
  | "boarding"
  | "treatment"
  | "discharge_planning"
  | "followed_up";

export type Sex = "male" | "female" | "other" | "unknown";

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface Staff {
  id: StaffId;
  full_name: string;
  role: StaffRole;
  /** Department or ward the staff member is assigned to. */
  department: string;
  email: string;
  is_active: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

export interface Patient {
  id: PatientId;
  full_name: string;
  date_of_birth: ISODateString | null;
  sex: Sex;
  phone: string | null;
  /** National ID / MRN once known. Null for unidentified emergency intakes. */
  national_id: string | null;

  /**
   * Emergency-workflow flags. When an unconscious / unidentified patient is
   * boarded, `is_emergency_anonymous` is set true and a human-readable
   * `anonymous_identifier` (e.g. "John Doe - Gamma - 20260531") is generated to
   * bypass paperwork. Once reconciled to a real profile these are cleared.
   */
  is_emergency_anonymous: boolean;
  anonymous_identifier?: string;

  created_at: ISODateString;
  updated_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

export interface Admission {
  id: AdmissionId;
  /** FK -> Patient.id */
  patient_id: PatientId;
  /** FK -> Staff.id of the admissions clerk who boarded the patient. */
  admitted_by_id: StaffId;
  /** FK -> Staff.id of the doctor currently responsible, if assigned. */
  attending_doctor_id: StaffId | null;

  stage: AdmissionStage;
  /** Physical bed / location label, e.g. "ICU-04" or "ER-Bay-2". */
  location: string | null;
  reason: string;

  // Multi-department clearance gates — all three must be true before an
  // admission may advance to `followed_up` / discharge.
  is_medical_cleared: boolean;
  is_financial_cleared: boolean;
  is_pharmacy_ready: boolean;

  admitted_at: ISODateString;
  discharged_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// ---------------------------------------------------------------------------
// Treatment record
// ---------------------------------------------------------------------------

/** A snapshot of recorded vital signs. All fields optional per entry. */
export interface Vitals {
  /** Peripheral oxygen saturation (SpO2), percentage. */
  spo2?: number;
  /** Systolic blood pressure, mmHg. */
  bp_systolic?: number;
  /** Diastolic blood pressure, mmHg. */
  bp_diastolic?: number;
  /** Heart rate / pulse, beats per minute. */
  pulse?: number;
  /** Body temperature, degrees Celsius. */
  temperature?: number;
  /** Respiratory rate, breaths per minute. */
  respiratory_rate?: number;
}

export interface TreatmentRecord {
  id: TreatmentRecordId;
  /** FK -> Admission.id */
  admission_id: AdmissionId;
  /** FK -> Staff.id of the doctor/nurse who logged the entry. */
  recorded_by_id: StaffId;

  vitals: Vitals;
  /**
   * Glasgow Coma Scale total (3–15), used to track unconscious / emergency
   * patients. Null when not assessed.
   */
  gcs_score: number | null;

  notes: string;
  /** Free-text or structured medication instruction logged this round. */
  medication: string | null;

  recorded_at: ISODateString;
  created_at: ISODateString;
}
