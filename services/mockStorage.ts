/**
 * CareFlow mock persistence engine (Phase 2).
 *
 * A localStorage-backed simulator that stands in for the eventual database.
 * ALL data mutation logic lives here so UI components stay storage-agnostic —
 * when we move to a real backend, only this file is swapped for `supabase-js`
 * calls and the UI contract (the exported functions below) is preserved.
 *
 * The store holds four relational tables that mirror `types/healthcare.ts`,
 * linked by `*_id` foreign keys rather than nested objects.
 */

import type {
  Admission,
  AdmissionId,
  AdmissionStage,
  Patient,
  PatientId,
  Staff,
  TreatmentRecord,
  Vitals,
} from "@/types/healthcare";

const STORAGE_KEY = "careflow_db_v1";

interface Database {
  staff: Staff[];
  patients: Patient[];
  admissions: Admission[];
  treatmentRecords: TreatmentRecord[];
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowISO(): string {
  return new Date().toISOString();
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read the database. On the server (no localStorage) we return a fresh,
 * non-persisted seed so SSR renders consistent data; in the browser we lazily
 * seed on first access and persist.
 */
function loadDatabase(): Database {
  if (!isBrowser()) {
    return seedDatabaseObject();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDatabaseObject();
    persist(seeded);
    return seeded;
  }

  try {
    return JSON.parse(raw) as Database;
  } catch {
    // Corrupt payload — reset to a clean seed rather than crashing the UI.
    const seeded = seedDatabaseObject();
    persist(seeded);
    return seeded;
  }
}

function persist(db: Database): void {
  if (isBrowser()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }
}

// ---------------------------------------------------------------------------
// Input shapes (what callers provide; ids/timestamps are filled in here)
// ---------------------------------------------------------------------------

export interface CreatePatientInput {
  full_name: string;
  date_of_birth?: string | null;
  sex?: Patient["sex"];
  phone?: string | null;
  national_id?: string | null;
  is_emergency_anonymous?: boolean;
  /** If omitted for an emergency intake, one is generated automatically. */
  anonymous_identifier?: string;
}

export interface CreateAdmissionInput {
  admitted_by_id: Staff["id"];
  attending_doctor_id?: Staff["id"] | null;
  reason: string;
  location?: string | null;
  stage?: AdmissionStage;
  is_medical_cleared?: boolean;
  is_financial_cleared?: boolean;
  is_pharmacy_ready?: boolean;
}

export interface AddTreatmentLogInput {
  recorded_by_id: Staff["id"];
  vitals?: Vitals;
  gcs_score?: number | null;
  notes?: string;
  medication?: string | null;
  recorded_at?: string;
}

// ---------------------------------------------------------------------------
// Emergency-intake helpers
// ---------------------------------------------------------------------------

const GREEK_TAGS = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
];

/**
 * Generate a human-readable anonymous tracking identifier for an unconscious /
 * unidentified emergency intake, e.g. "John Doe - Gamma - 20260531".
 */
export function generateAnonymousIdentifier(seedIndex?: number): string {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const tag =
    typeof seedIndex === "number"
      ? GREEK_TAGS[seedIndex % GREEK_TAGS.length]
      : GREEK_TAGS[Math.floor(Math.random() * GREEK_TAGS.length)];
  return `John Doe - ${tag} - ${stamp}`;
}

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export function getStaff(): Staff[] {
  return loadDatabase().staff;
}

export function getStaffById(id: Staff["id"]): Staff | undefined {
  return loadDatabase().staff.find((s) => s.id === id);
}

export function getPatients(): Patient[] {
  return loadDatabase().patients;
}

export function getPatientById(id: PatientId): Patient | undefined {
  return loadDatabase().patients.find((p) => p.id === id);
}

export function getAdmissionById(id: AdmissionId): Admission | undefined {
  return loadDatabase().admissions.find((a) => a.id === id);
}

/**
 * All admissions that are still in the building (not yet fully discharged),
 * most-recently admitted first. This drives the Live Status Board.
 */
export function getActiveAdmissions(): Admission[] {
  return loadDatabase()
    .admissions.filter((a) => a.discharged_at === null)
    .sort((a, b) => b.admitted_at.localeCompare(a.admitted_at));
}

/** Admissions whose patient is still flagged as an anonymous emergency. */
export function getAnonymousAdmissions(): Admission[] {
  const db = loadDatabase();
  const anonymousPatientIds = new Set(
    db.patients.filter((p) => p.is_emergency_anonymous).map((p) => p.id)
  );
  return db.admissions.filter((a) => anonymousPatientIds.has(a.patient_id));
}

export function getTreatmentRecordsForAdmission(
  admissionId: AdmissionId
): TreatmentRecord[] {
  return loadDatabase()
    .treatmentRecords.filter((r) => r.admission_id === admissionId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Board a new patient: creates the Patient record and an associated Admission
 * in a single operation. For emergency anonymous intakes, an anonymous
 * identifier is generated if the caller did not supply one.
 */
export function createNewAdmission(
  patientData: CreatePatientInput,
  admissionData: CreateAdmissionInput
): { patient: Patient; admission: Admission } {
  const db = loadDatabase();
  const timestamp = nowISO();

  const isAnonymous = patientData.is_emergency_anonymous ?? false;
  const anonymousIdentifier = isAnonymous
    ? patientData.anonymous_identifier ?? generateAnonymousIdentifier()
    : undefined;

  const patient: Patient = {
    id: generateId(),
    full_name: patientData.full_name,
    date_of_birth: patientData.date_of_birth ?? null,
    sex: patientData.sex ?? "unknown",
    phone: patientData.phone ?? null,
    national_id: patientData.national_id ?? null,
    is_emergency_anonymous: isAnonymous,
    anonymous_identifier: anonymousIdentifier,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const admission: Admission = {
    id: generateId(),
    patient_id: patient.id,
    admitted_by_id: admissionData.admitted_by_id,
    attending_doctor_id: admissionData.attending_doctor_id ?? null,
    stage: admissionData.stage ?? "boarding",
    location: admissionData.location ?? null,
    reason: admissionData.reason,
    is_medical_cleared: admissionData.is_medical_cleared ?? false,
    is_financial_cleared: admissionData.is_financial_cleared ?? false,
    is_pharmacy_ready: admissionData.is_pharmacy_ready ?? false,
    admitted_at: timestamp,
    discharged_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.patients.push(patient);
  db.admissions.push(admission);
  persist(db);

  return { patient, admission };
}

/** Append a vitals / GCS / medication log entry to an admission. */
export function addTreatmentLog(
  admissionId: AdmissionId,
  logData: AddTreatmentLogInput
): TreatmentRecord {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`addTreatmentLog: admission "${admissionId}" not found`);
  }

  const timestamp = nowISO();
  const record: TreatmentRecord = {
    id: generateId(),
    admission_id: admissionId,
    recorded_by_id: logData.recorded_by_id,
    vitals: logData.vitals ?? {},
    gcs_score: logData.gcs_score ?? null,
    notes: logData.notes ?? "",
    medication: logData.medication ?? null,
    recorded_at: logData.recorded_at ?? timestamp,
    created_at: timestamp,
  };

  db.treatmentRecords.push(record);

  // Touch the parent admission so consumers see fresh activity.
  admission.updated_at = timestamp;
  persist(db);

  return record;
}

/**
 * Verification gate (Phase 5). Determine whether an admission is eligible to
 * reach the final `followed_up` / discharged state. Discharge is blocked until
 * all three department clearances are granted AND the patient is no longer an
 * unreconciled anonymous emergency record. Pure — safe to call from the UI to
 * drive button state and warnings.
 */
export function evaluateDischargeReadiness(
  admission: Admission,
  patient: Patient
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!admission.is_medical_cleared) blockers.push("Medical clearance pending");
  if (!admission.is_financial_cleared) blockers.push("Financial clearance pending");
  if (!admission.is_pharmacy_ready) blockers.push("Pharmacy not ready");
  if (patient.is_emergency_anonymous) {
    blockers.push("Anonymous emergency profile must be reconciled first");
  }
  return { ready: blockers.length === 0, blockers };
}

/**
 * Simulate the automated post-discharge follow-up transmissions a real system
 * would fire (SMS reminder, tele-check-in booking, summary dispatch). Logged to
 * the system console only — no real messages are sent.
 */
function logFollowUpTransmission(admission: Admission, patient?: Patient): void {
  const name =
    patient?.is_emergency_anonymous && patient.anonymous_identifier
      ? patient.anonymous_identifier
      : patient?.full_name ?? "Unknown patient";
  const followUpDate = new Date(Date.now() + 7 * 24 * 3600_000)
    .toISOString()
    .slice(0, 10);

  console.groupCollapsed(
    `[CareFlow ▸ Follow-Up Service] Post-discharge transmissions — ${name}`
  );
  console.info(`Discharge confirmed @ ${new Date().toLocaleString()}`);
  console.info(
    `SMS recovery reminder queued → ${patient?.phone ?? "registered contact"}`
  );
  console.info(`7-day tele-check-in scheduled for ${followUpDate}`);
  console.info(`Discharge summary dispatched to attending physician`);
  console.groupEnd();
}

/**
 * Move an admission to a new stage. Advancing to `followed_up` stamps the
 * discharge time (so it drops out of the active board) and is gated: it throws
 * unless all clearances are granted and the patient is reconciled. Reaching
 * discharge also fires the simulated follow-up notification log.
 */
export function updateAdmissionStage(
  admissionId: AdmissionId,
  newStage: AdmissionStage
): Admission {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`updateAdmissionStage: admission "${admissionId}" not found`);
  }

  const patient = db.patients.find((p) => p.id === admission.patient_id);

  // Verification gate — block the final discharge transition until ready.
  if (newStage === "followed_up" && patient) {
    const { ready, blockers } = evaluateDischargeReadiness(admission, patient);
    if (!ready) {
      throw new Error(`Cannot discharge: ${blockers.join("; ")}`);
    }
  }

  const timestamp = nowISO();
  const wasDischarged = admission.discharged_at !== null;
  admission.stage = newStage;
  admission.updated_at = timestamp;
  if (newStage === "followed_up" && admission.discharged_at === null) {
    admission.discharged_at = timestamp;
  }

  persist(db);

  if (newStage === "followed_up" && !wasDischarged) {
    logFollowUpTransmission(admission, patient);
  }

  return admission;
}

/** Update any of the three multi-department clearance gates on an admission. */
export function updateAdmissionClearances(
  admissionId: AdmissionId,
  clearances: Partial<
    Pick<
      Admission,
      "is_medical_cleared" | "is_financial_cleared" | "is_pharmacy_ready"
    >
  >
): Admission {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(
      `updateAdmissionClearances: admission "${admissionId}" not found`
    );
  }

  if (clearances.is_medical_cleared !== undefined) {
    admission.is_medical_cleared = clearances.is_medical_cleared;
  }
  if (clearances.is_financial_cleared !== undefined) {
    admission.is_financial_cleared = clearances.is_financial_cleared;
  }
  if (clearances.is_pharmacy_ready !== undefined) {
    admission.is_pharmacy_ready = clearances.is_pharmacy_ready;
  }
  admission.updated_at = nowISO();

  persist(db);
  return admission;
}

/**
 * Merge an unidentified emergency patient into a verified permanent profile.
 *
 * The anonymous patient's admissions (and, transitively, their treatment
 * records, which reference the admission) are re-pointed at the real patient.
 * The anonymous placeholder record is then removed. Accepts either the
 * anonymous Patient.id or its `anonymous_identifier`.
 */
export function reconcileAnonymousProfile(
  anonymousId: PatientId | string,
  realPatientId: PatientId
): { patient: Patient; reassignedAdmissions: Admission[] } {
  const db = loadDatabase();

  const anonymous = db.patients.find(
    (p) =>
      p.is_emergency_anonymous &&
      (p.id === anonymousId || p.anonymous_identifier === anonymousId)
  );
  if (!anonymous) {
    throw new Error(
      `reconcileAnonymousProfile: anonymous patient "${anonymousId}" not found`
    );
  }

  const realPatient = db.patients.find((p) => p.id === realPatientId);
  if (!realPatient) {
    throw new Error(
      `reconcileAnonymousProfile: target patient "${realPatientId}" not found`
    );
  }

  const timestamp = nowISO();

  // Re-point the anonymous patient's admissions to the verified profile.
  // Treatment records follow automatically since they key off admission_id.
  const reassignedAdmissions: Admission[] = [];
  for (const admission of db.admissions) {
    if (admission.patient_id === anonymous.id) {
      admission.patient_id = realPatient.id;
      admission.updated_at = timestamp;
      reassignedAdmissions.push(admission);
    }
  }

  realPatient.updated_at = timestamp;

  // Drop the anonymous placeholder now that its clinical history is merged.
  db.patients = db.patients.filter((p) => p.id !== anonymous.id);

  persist(db);
  return { patient: realPatient, reassignedAdmissions };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Wipe and re-seed the store. Useful during testing/demoing. */
export function resetDatabase(): Database {
  const seeded = seedDatabaseObject();
  persist(seeded);
  return seeded;
}

// ---------------------------------------------------------------------------
// Seed data — 5 hyper-realistic clinical profiles across every stage,
// including an unconscious anonymous patient in active treatment.
// ---------------------------------------------------------------------------

function seedDatabaseObject(): Database {
  // Anchor seed timestamps around the current clinical day.
  const day = (offsetHours: number) =>
    new Date(Date.now() - offsetHours * 3600_000).toISOString();

  const staff: Staff[] = [
    {
      id: "staff_okafor",
      full_name: "Dr. A. Okafor",
      role: "doctor",
      department: "Internal Medicine",
      email: "a.okafor@generalhospital.med",
      is_active: true,
      created_at: day(720),
      updated_at: day(720),
    },
    {
      id: "staff_chen",
      full_name: "Dr. M. Chen",
      role: "doctor",
      department: "Surgery",
      email: "m.chen@generalhospital.med",
      is_active: true,
      created_at: day(720),
      updated_at: day(720),
    },
    {
      id: "staff_patel",
      full_name: "Nurse J. Patel",
      role: "nurse",
      department: "ICU",
      email: "j.patel@generalhospital.med",
      is_active: true,
      created_at: day(720),
      updated_at: day(720),
    },
    {
      id: "staff_romero",
      full_name: "Nurse L. Romero",
      role: "nurse",
      department: "Emergency",
      email: "l.romero@generalhospital.med",
      is_active: true,
      created_at: day(720),
      updated_at: day(720),
    },
    {
      id: "staff_adebayo",
      full_name: "R. Adebayo",
      role: "admin",
      department: "Admissions",
      email: "r.adebayo@generalhospital.med",
      is_active: true,
      created_at: day(720),
      updated_at: day(720),
    },
  ];

  const patients: Patient[] = [
    {
      id: "pat_mensah",
      full_name: "Grace Mensah",
      date_of_birth: "1989-03-14",
      sex: "female",
      phone: "+233 20 555 0142",
      national_id: "GHA-8841203",
      is_emergency_anonymous: false,
      created_at: day(3),
      updated_at: day(3),
    },
    {
      id: "pat_idris",
      full_name: "Samuel Idris",
      date_of_birth: "1972-11-02",
      sex: "male",
      phone: "+234 80 555 0199",
      national_id: "NGA-5520117",
      is_emergency_anonymous: false,
      created_at: day(28),
      updated_at: day(6),
    },
    {
      id: "pat_anon_gamma",
      full_name: "Unidentified Patient",
      date_of_birth: null,
      sex: "unknown",
      phone: null,
      national_id: null,
      is_emergency_anonymous: true,
      anonymous_identifier: "John Doe - Gamma - 20260531",
      created_at: day(5),
      updated_at: day(1),
    },
    {
      id: "pat_bello",
      full_name: "Aisha Bello",
      date_of_birth: "1995-07-21",
      sex: "female",
      phone: "+234 70 555 0173",
      national_id: "NGA-7790455",
      is_emergency_anonymous: false,
      created_at: day(96),
      updated_at: day(12),
    },
    {
      id: "pat_owusu",
      full_name: "Daniel Owusu",
      date_of_birth: "1960-01-09",
      sex: "male",
      phone: "+233 24 555 0166",
      national_id: "GHA-3310928",
      is_emergency_anonymous: false,
      created_at: day(168),
      updated_at: day(20),
    },
  ];

  const admissions: Admission[] = [
    {
      id: "adm_mensah",
      patient_id: "pat_mensah",
      admitted_by_id: "staff_adebayo",
      attending_doctor_id: "staff_okafor",
      stage: "boarding",
      location: "ER-Bay-2",
      reason: "Acute chest pain, awaiting cardiac workup",
      is_medical_cleared: false,
      is_financial_cleared: false,
      is_pharmacy_ready: false,
      admitted_at: day(3),
      discharged_at: null,
      created_at: day(3),
      updated_at: day(3),
    },
    {
      id: "adm_idris",
      patient_id: "pat_idris",
      admitted_by_id: "staff_adebayo",
      attending_doctor_id: "staff_chen",
      stage: "treatment",
      location: "ICU-04",
      reason: "Post-operative recovery, laparotomy",
      is_medical_cleared: false,
      is_financial_cleared: true,
      is_pharmacy_ready: false,
      admitted_at: day(28),
      discharged_at: null,
      created_at: day(28),
      updated_at: day(6),
    },
    {
      id: "adm_anon_gamma",
      patient_id: "pat_anon_gamma",
      admitted_by_id: "staff_romero",
      attending_doctor_id: "staff_okafor",
      stage: "treatment",
      location: "ICU-02",
      reason: "Unconscious on arrival, head trauma — RTA",
      is_medical_cleared: false,
      is_financial_cleared: false,
      is_pharmacy_ready: false,
      admitted_at: day(5),
      discharged_at: null,
      created_at: day(5),
      updated_at: day(1),
    },
    {
      id: "adm_bello",
      patient_id: "pat_bello",
      admitted_by_id: "staff_adebayo",
      attending_doctor_id: "staff_okafor",
      stage: "discharge_planning",
      location: "Ward-B-11",
      reason: "Pneumonia, responding to treatment",
      is_medical_cleared: true,
      is_financial_cleared: false,
      is_pharmacy_ready: true,
      admitted_at: day(96),
      discharged_at: null,
      created_at: day(96),
      updated_at: day(12),
    },
    {
      id: "adm_owusu",
      patient_id: "pat_owusu",
      admitted_by_id: "staff_adebayo",
      attending_doctor_id: "staff_chen",
      stage: "followed_up",
      location: "Ward-A-03",
      reason: "Diabetic ketoacidosis, stabilized",
      is_medical_cleared: true,
      is_financial_cleared: true,
      is_pharmacy_ready: true,
      admitted_at: day(168),
      discharged_at: null,
      created_at: day(168),
      updated_at: day(20),
    },
  ];

  const treatmentRecords: TreatmentRecord[] = [
    {
      id: "trec_idris_1",
      admission_id: "adm_idris",
      recorded_by_id: "staff_patel",
      vitals: {
        spo2: 97,
        bp_systolic: 128,
        bp_diastolic: 82,
        pulse: 88,
        temperature: 37.4,
        respiratory_rate: 18,
      },
      gcs_score: 15,
      notes: "Stable post-op. Pain controlled. Mobilizing with assistance.",
      medication: "Paracetamol 1g IV q6h; Enoxaparin 40mg SC daily",
      recorded_at: day(6),
      created_at: day(6),
    },
    {
      id: "trec_anon_1",
      admission_id: "adm_anon_gamma",
      recorded_by_id: "staff_patel",
      vitals: {
        spo2: 94,
        bp_systolic: 148,
        bp_diastolic: 95,
        pulse: 104,
        temperature: 37.9,
        respiratory_rate: 22,
      },
      gcs_score: 7,
      notes:
        "Unresponsive to voice, localizes to pain. Pupils equal/reactive. CT head pending.",
      medication: "Mannitol 20% per neuro protocol; maintenance fluids",
      recorded_at: day(4),
      created_at: day(4),
    },
    {
      id: "trec_anon_2",
      admission_id: "adm_anon_gamma",
      recorded_by_id: "staff_okafor",
      vitals: {
        spo2: 96,
        bp_systolic: 138,
        bp_diastolic: 88,
        pulse: 92,
        temperature: 37.5,
        respiratory_rate: 19,
      },
      gcs_score: 9,
      notes: "Slight improvement in responsiveness. Continue close monitoring.",
      medication: "Continue neuro protocol",
      recorded_at: day(1),
      created_at: day(1),
    },
    {
      id: "trec_bello_1",
      admission_id: "adm_bello",
      recorded_by_id: "staff_patel",
      vitals: {
        spo2: 98,
        bp_systolic: 118,
        bp_diastolic: 76,
        pulse: 74,
        temperature: 36.9,
        respiratory_rate: 16,
      },
      gcs_score: 15,
      notes: "Afebrile 48h. Chest clear on auscultation. Fit for discharge planning.",
      medication: "Oral amoxicillin-clavulanate to complete course",
      recorded_at: day(12),
      created_at: day(12),
    },
  ];

  return { staff, patients, admissions, treatmentRecords };
}
