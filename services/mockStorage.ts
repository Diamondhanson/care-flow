/**
 * CareFlow mock persistence engine (Phase 6 — Visit-Centric Refactor).
 *
 * A localStorage-backed simulator that stands in for the eventual Supabase
 * backend. ALL data mutation logic lives here so UI components stay
 * storage-agnostic — when we move to a real backend, only this file is swapped
 * for `supabase-js` calls and the UI contract (the exported functions below) is
 * preserved.
 *
 * The store now holds the full visit-centric relational model that mirrors
 * `types/healthcare.ts` (and, transitively, `supabase/schema.sql`). **The Visit
 * is the spine of the record** — consultations, diagnoses, orders, results,
 * prescriptions, MAR entries, vitals and (inpatient only) an admission all hang
 * off a visit by `*_id` foreign keys rather than nested objects.
 */

import type {
  Admission,
  AdmissionId,
  Bed,
  BedId,
  CareStage,
  Consultation,
  Department,
  DepartmentId,
  Diagnosis,
  MedicationAdministration,
  Order,
  OrderId,
  Patient,
  PatientId,
  Prescription,
  PrescriptionId,
  Result,
  Staff,
  StaffId,
  TreatmentRecord,
  Visit,
  VisitId,
  VisitType,
  Ward,
  WardId,
} from "@/types/healthcare";

const STORAGE_KEY = "careflow_db_v2";

interface Database {
  departments: Department[];
  wards: Ward[];
  beds: Bed[];
  staff: Staff[];
  patients: Patient[];
  visits: Visit[];
  consultations: Consultation[];
  diagnoses: Diagnosis[];
  orders: Order[];
  results: Result[];
  prescriptions: Prescription[];
  medicationAdministrations: MedicationAdministration[];
  treatmentRecords: TreatmentRecord[];
  admissions: Admission[];
  /** Last MRN sequence value issued (drives `generate_mrn()` parity). */
  mrnCounter: number;
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
 * Format a Medical Record Number, e.g. `CF-2026-000123`. Pure — mirrors the
 * Postgres `generate_mrn()` function so the format survives the backend swap.
 */
export function generateMrn(year: number, sequence: number): string {
  return `CF-${year}-${String(sequence).padStart(6, "0")}`;
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
  address?: string | null;
  national_id?: string | null;
  is_emergency_anonymous?: boolean;
  /** If omitted for an emergency intake, one is generated automatically. */
  anonymous_identifier?: string;
}

export interface CreateVisitInput {
  visit_type: VisitType;
  department_id?: DepartmentId | null;
  attending_doctor_id?: StaffId | null;
  registered_by_id?: StaffId | null;
  chief_complaint?: string | null;
  triage_notes?: string | null;
  /** Defaults to "registration". */
  stage?: CareStage;
}

export interface AddTreatmentLogInput {
  recorded_by_id?: StaffId | null;
  spo2?: number | null;
  pulse?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  temperature_c?: number | null;
  gcs_score?: number | null;
  notes?: string | null;
  recorded_at?: string;
}

export interface CreateAdmissionInput {
  attending_doctor_id?: StaffId | null;
  ward_id?: WardId | null;
  bed_id?: BedId | null;
  stage?: CareStage;
  reason?: string | null;
  is_medical_cleared?: boolean;
  is_financial_cleared?: boolean;
  is_pharmacy_ready?: boolean;
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
// Stage helpers (which stages still belong on the active board)
// ---------------------------------------------------------------------------

/** A visit has left the floor once it reaches one of these stages. */
export function isTerminalStage(stage: CareStage): boolean {
  return stage === "discharged" || stage === "followed_up";
}

// ---------------------------------------------------------------------------
// Read queries — reference / structural
// ---------------------------------------------------------------------------

export function getDepartments(): Department[] {
  return loadDatabase().departments;
}

export function getDepartmentById(id: DepartmentId): Department | undefined {
  return loadDatabase().departments.find((d) => d.id === id);
}

export function getWards(): Ward[] {
  return loadDatabase().wards;
}

export function getWardById(id: WardId): Ward | undefined {
  return loadDatabase().wards.find((w) => w.id === id);
}

export function getBeds(): Bed[] {
  return loadDatabase().beds;
}

export function getBedById(id: BedId): Bed | undefined {
  return loadDatabase().beds.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Read queries — people
// ---------------------------------------------------------------------------

export function getStaff(): Staff[] {
  return loadDatabase().staff;
}

export function getStaffById(id: StaffId): Staff | undefined {
  return loadDatabase().staff.find((s) => s.id === id);
}

export function getPatients(): Patient[] {
  return loadDatabase().patients;
}

export function getPatientById(id: PatientId): Patient | undefined {
  return loadDatabase().patients.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Read queries — visits (the record spine)
// ---------------------------------------------------------------------------

export function getVisits(): Visit[] {
  return loadDatabase().visits;
}

export function getVisitById(id: VisitId): Visit | undefined {
  return loadDatabase().visits.find((v) => v.id === id);
}

/**
 * All visits still in progress (status "open"), most-recently arrived first.
 * This drives the Live Status Board.
 */
export function getActiveVisits(): Visit[] {
  return loadDatabase()
    .visits.filter((v) => v.status === "open")
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
}

/** Visits whose patient is still flagged as an anonymous emergency. */
export function getAnonymousVisits(): Visit[] {
  const db = loadDatabase();
  const anonymousPatientIds = new Set(
    db.patients.filter((p) => p.is_emergency_anonymous).map((p) => p.id)
  );
  return db.visits.filter((v) => anonymousPatientIds.has(v.patient_id));
}

// ---------------------------------------------------------------------------
// Read queries — clinical record (hang off a visit)
// ---------------------------------------------------------------------------

export function getConsultationsForVisit(visitId: VisitId): Consultation[] {
  return loadDatabase()
    .consultations.filter((c) => c.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getDiagnosesForVisit(visitId: VisitId): Diagnosis[] {
  return loadDatabase()
    .diagnoses.filter((d) => d.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getOrdersForVisit(visitId: VisitId): Order[] {
  return loadDatabase()
    .orders.filter((o) => o.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getResultsForOrder(orderId: OrderId): Result[] {
  return loadDatabase()
    .results.filter((r) => r.order_id === orderId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

export function getPrescriptionsForVisit(visitId: VisitId): Prescription[] {
  return loadDatabase()
    .prescriptions.filter((p) => p.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getMedicationAdministrationsForPrescription(
  prescriptionId: PrescriptionId
): MedicationAdministration[] {
  return loadDatabase()
    .medicationAdministrations.filter((m) => m.prescription_id === prescriptionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getTreatmentRecordsForVisit(visitId: VisitId): TreatmentRecord[] {
  return loadDatabase()
    .treatmentRecords.filter((r) => r.visit_id === visitId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

// ---------------------------------------------------------------------------
// Read queries — admissions (inpatient only)
// ---------------------------------------------------------------------------

export function getAdmissions(): Admission[] {
  return loadDatabase().admissions;
}

export function getAdmissionById(id: AdmissionId): Admission | undefined {
  return loadDatabase().admissions.find((a) => a.id === id);
}

/** The admission for a visit, if it became an inpatient stay. */
export function getAdmissionForVisit(visitId: VisitId): Admission | undefined {
  return loadDatabase().admissions.find((a) => a.visit_id === visitId);
}

/** Admissions still occupying a bed (status "active"). */
export function getActiveAdmissions(): Admission[] {
  return loadDatabase()
    .admissions.filter((a) => a.status === "active")
    .sort((a, b) => b.admitted_at.localeCompare(a.admitted_at));
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export interface WardOccupancy {
  ward: Ward;
  total: number;
  occupied: number;
  free: number;
}

/** Per-ward bed occupancy, mirroring the `ward_occupancy` SQL view. Pure. */
export function computeWardOccupancy(wards: Ward[], beds: Bed[]): WardOccupancy[] {
  return wards.map((ward) => {
    const wardBeds = beds.filter((b) => b.ward_id === ward.id);
    const occupied = wardBeds.filter(
      (b) => b.status === "occupied" || b.status === "reserved"
    ).length;
    return {
      ward,
      total: wardBeds.length,
      occupied,
      free: wardBeds.length - occupied,
    };
  });
}

export function getWardOccupancy(): WardOccupancy[] {
  const db = loadDatabase();
  return computeWardOccupancy(db.wards, db.beds);
}

// ---------------------------------------------------------------------------
// Mutations — registration / intake
// ---------------------------------------------------------------------------

/**
 * Register a patient and open their first visit in a single operation. Assigns a
 * permanent MRN (`CF-YYYY-NNNNNN`). For emergency anonymous intakes an anonymous
 * identifier is generated if the caller did not supply one.
 */
export function createNewVisit(
  patientData: CreatePatientInput,
  visitData: CreateVisitInput
): { patient: Patient; visit: Visit } {
  const db = loadDatabase();
  const timestamp = nowISO();

  const isAnonymous = patientData.is_emergency_anonymous ?? false;
  const anonymousIdentifier = isAnonymous
    ? patientData.anonymous_identifier ?? generateAnonymousIdentifier()
    : null;

  const nextSequence = db.mrnCounter + 1;
  db.mrnCounter = nextSequence;

  const patient: Patient = {
    id: generateId(),
    mrn: generateMrn(new Date(timestamp).getFullYear(), nextSequence),
    full_name: patientData.full_name,
    date_of_birth: patientData.date_of_birth ?? null,
    sex: patientData.sex ?? "unknown",
    phone: patientData.phone ?? null,
    address: patientData.address ?? null,
    national_id: patientData.national_id ?? null,
    is_emergency_anonymous: isAnonymous,
    anonymous_identifier: anonymousIdentifier,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const visit: Visit = {
    id: generateId(),
    patient_id: patient.id,
    visit_type: visitData.visit_type,
    status: "open",
    stage: visitData.stage ?? "registration",
    department_id: visitData.department_id ?? null,
    attending_doctor_id: visitData.attending_doctor_id ?? null,
    registered_by_id: visitData.registered_by_id ?? null,
    chief_complaint: visitData.chief_complaint ?? null,
    triage_notes: visitData.triage_notes ?? null,
    arrived_at: timestamp,
    closed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.patients.push(patient);
  db.visits.push(visit);
  persist(db);

  return { patient, visit };
}

// ---------------------------------------------------------------------------
// Mutations — clinical logging
// ---------------------------------------------------------------------------

/** Append a vitals / GCS checkpoint to a visit. */
export function addTreatmentLog(
  visitId: VisitId,
  logData: AddTreatmentLogInput
): TreatmentRecord {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addTreatmentLog: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const record: TreatmentRecord = {
    id: generateId(),
    visit_id: visitId,
    recorded_by_id: logData.recorded_by_id ?? null,
    spo2: logData.spo2 ?? null,
    pulse: logData.pulse ?? null,
    bp_systolic: logData.bp_systolic ?? null,
    bp_diastolic: logData.bp_diastolic ?? null,
    temperature_c: logData.temperature_c ?? null,
    gcs_score: logData.gcs_score ?? null,
    notes: logData.notes ?? null,
    recorded_at: logData.recorded_at ?? timestamp,
  };

  db.treatmentRecords.push(record);

  // Touch the parent visit so consumers see fresh activity.
  visit.updated_at = timestamp;
  persist(db);

  return record;
}

// ---------------------------------------------------------------------------
// Mutations — admissions (inpatient bed assignment + occupancy sync)
// ---------------------------------------------------------------------------

/**
 * Promote a visit to an inpatient admission, optionally assigning a bed. When a
 * bed is assigned it is flipped to "occupied" and back-references the admission
 * (mirrors the `sync_bed_occupancy` trigger).
 */
export function createAdmissionForVisit(
  visitId: VisitId,
  admissionData: CreateAdmissionInput = {}
): Admission {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`createAdmissionForVisit: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const admission: Admission = {
    id: generateId(),
    visit_id: visitId,
    patient_id: visit.patient_id,
    attending_doctor_id:
      admissionData.attending_doctor_id ?? visit.attending_doctor_id ?? null,
    ward_id: admissionData.ward_id ?? null,
    bed_id: admissionData.bed_id ?? null,
    status: "active",
    stage: admissionData.stage ?? visit.stage,
    reason: admissionData.reason ?? visit.chief_complaint ?? null,
    is_medical_cleared: admissionData.is_medical_cleared ?? false,
    is_financial_cleared: admissionData.is_financial_cleared ?? false,
    is_pharmacy_ready: admissionData.is_pharmacy_ready ?? false,
    admitted_at: timestamp,
    discharged_at: null,
    updated_at: timestamp,
  };

  db.admissions.push(admission);

  if (admission.bed_id) {
    const bed = db.beds.find((b) => b.id === admission.bed_id);
    if (bed) {
      bed.status = "occupied";
      bed.current_admission_id = admission.id;
      bed.updated_at = timestamp;
    }
  }

  visit.visit_type = "inpatient";
  visit.updated_at = timestamp;
  persist(db);

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

// ---------------------------------------------------------------------------
// Verification gate + discharge
// ---------------------------------------------------------------------------

/**
 * Verification gate (Phase 5). Determine whether an inpatient admission is
 * eligible to be discharged. Discharge is blocked until all three department
 * clearances are granted AND the patient is no longer an unreconciled anonymous
 * emergency record. Pure — safe to call from the UI to drive button state.
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
function logFollowUpTransmission(visit: Visit, patient?: Patient): void {
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
 * Move a visit to a new care stage.
 *
 * Reaching a terminal stage ("discharged"/"followed_up") closes the visit
 * (stamps `closed_at`, sets `status="closed"` so it drops off the active board),
 * and — for an inpatient visit with an admission — is gated: it throws unless
 * all clearances are granted and the patient is reconciled. A terminal
 * transition also discharges the admission, frees the bed, and fires the
 * simulated follow-up notification log.
 */
export function updateVisitStage(visitId: VisitId, newStage: CareStage): Visit {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`updateVisitStage: visit "${visitId}" not found`);
  }

  const patient = db.patients.find((p) => p.id === visit.patient_id);
  const admission = db.admissions.find((a) => a.visit_id === visitId);
  const becomingTerminal = isTerminalStage(newStage) && visit.status === "open";

  // Verification gate — block the final discharge transition until ready.
  if (becomingTerminal && admission && patient) {
    const { ready, blockers } = evaluateDischargeReadiness(admission, patient);
    if (!ready) {
      throw new Error(`Cannot discharge: ${blockers.join("; ")}`);
    }
  }

  const timestamp = nowISO();
  visit.stage = newStage;
  visit.updated_at = timestamp;

  if (becomingTerminal) {
    visit.status = "closed";
    visit.closed_at = timestamp;

    if (admission) {
      admission.status = "discharged";
      admission.stage = newStage;
      admission.discharged_at = timestamp;
      admission.updated_at = timestamp;

      // Free the bed the admission occupied.
      if (admission.bed_id) {
        const bed = db.beds.find((b) => b.id === admission.bed_id);
        if (bed) {
          bed.status = "free";
          bed.current_admission_id = null;
          bed.updated_at = timestamp;
        }
      }
    }
  } else if (admission) {
    // Keep the admission stage in lock-step while the patient is on the floor.
    admission.stage = newStage;
    admission.updated_at = timestamp;
  }

  persist(db);

  if (becomingTerminal) {
    logFollowUpTransmission(visit, patient);
  }

  return visit;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Merge an unidentified emergency patient into a verified permanent profile.
 *
 * The anonymous patient's visits and admissions (and, transitively, their
 * clinical records, which key off the visit) are re-pointed at the real patient.
 * The anonymous placeholder record is then removed. Accepts either the anonymous
 * Patient.id or its `anonymous_identifier`.
 */
export function reconcileAnonymousProfile(
  anonymousId: PatientId | string,
  realPatientId: PatientId
): { patient: Patient; reassignedVisits: Visit[] } {
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

  // Re-point the anonymous patient's visits to the verified profile. The
  // clinical record (consultations, vitals, etc.) follows automatically since it
  // keys off visit_id.
  const reassignedVisits: Visit[] = [];
  for (const visit of db.visits) {
    if (visit.patient_id === anonymous.id) {
      visit.patient_id = realPatient.id;
      visit.updated_at = timestamp;
      reassignedVisits.push(visit);
    }
  }

  // Re-point admissions too (they carry their own patient_id).
  for (const admission of db.admissions) {
    if (admission.patient_id === anonymous.id) {
      admission.patient_id = realPatient.id;
      admission.updated_at = timestamp;
    }
  }

  realPatient.updated_at = timestamp;

  // Drop the anonymous placeholder now that its clinical history is merged.
  db.patients = db.patients.filter((p) => p.id !== anonymous.id);

  persist(db);
  return { patient: realPatient, reassignedVisits };
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
// Seed data — a small but complete hospital: departments, wards/beds, staff
// across all six roles, patients with MRNs, and realistic outpatient, inpatient
// and emergency visits carrying consultations, diagnoses, orders/results,
// prescriptions, MAR entries and vitals — one visit per active board column,
// including an unconscious anonymous ICU patient.
// ---------------------------------------------------------------------------

function seedDatabaseObject(): Database {
  // Anchor seed timestamps around the current clinical day.
  const day = (offsetHours: number) =>
    new Date(Date.now() - offsetHours * 3600_000).toISOString();

  const departments: Department[] = [
    { id: "dept_emergency", name: "Emergency", code: "EMG", description: "Emergency & trauma", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_medicine", name: "Internal Medicine", code: "MED", description: "General internal medicine", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_surgery", name: "Surgery", code: "SUR", description: "General & specialist surgery", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_icu", name: "Intensive Care", code: "ICU", description: "Critical care unit", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_lab", name: "Laboratory", code: "LAB", description: "Pathology & diagnostics", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_pharmacy", name: "Pharmacy", code: "PHA", description: "Dispensary", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_admin", name: "Administration", code: "ADM", description: "Front desk & records", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const wards: Ward[] = [
    { id: "ward_icu", department_id: "dept_icu", name: "ICU", floor_label: "3rd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_medb", department_id: "dept_medicine", name: "Medical Ward B", floor_label: "2nd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_er", department_id: "dept_emergency", name: "Emergency Bays", floor_label: "Ground Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const beds: Bed[] = [
    { id: "bed_icu_02", ward_id: "ward_icu", label: "ICU-02", status: "occupied", current_admission_id: "adm_anon_gamma", created_at: day(8760), updated_at: day(5) },
    { id: "bed_icu_04", ward_id: "ward_icu", label: "ICU-04", status: "occupied", current_admission_id: "adm_idris", created_at: day(8760), updated_at: day(28) },
    { id: "bed_icu_01", ward_id: "ward_icu", label: "ICU-01", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_11", ward_id: "ward_medb", label: "B-11", status: "occupied", current_admission_id: "adm_bello", created_at: day(8760), updated_at: day(96) },
    { id: "bed_medb_09", ward_id: "ward_medb", label: "B-09", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_10", ward_id: "ward_medb", label: "B-10", status: "cleaning", current_admission_id: null, created_at: day(8760), updated_at: day(30) },
    { id: "bed_er_1", ward_id: "ward_er", label: "ER-Bay-1", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_er_2", ward_id: "ward_er", label: "ER-Bay-2", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
  ];

  const staff: Staff[] = [
    { id: "staff_okafor", user_id: null, full_name: "Dr. A. Okafor", role: "doctor", department_id: "dept_medicine", email: "a.okafor@generalhospital.med", phone: "+233 20 555 0010", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_chen", user_id: null, full_name: "Dr. M. Chen", role: "doctor", department_id: "dept_surgery", email: "m.chen@generalhospital.med", phone: "+233 20 555 0011", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_patel", user_id: null, full_name: "Nurse J. Patel", role: "nurse", department_id: "dept_icu", email: "j.patel@generalhospital.med", phone: "+233 20 555 0012", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_romero", user_id: null, full_name: "Nurse L. Romero", role: "nurse", department_id: "dept_emergency", email: "l.romero@generalhospital.med", phone: "+233 20 555 0013", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_boateng", user_id: null, full_name: "K. Boateng", role: "lab_tech", department_id: "dept_lab", email: "k.boateng@generalhospital.med", phone: "+233 20 555 0014", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_eze", user_id: null, full_name: "T. Eze", role: "pharmacist", department_id: "dept_pharmacy", email: "t.eze@generalhospital.med", phone: "+233 20 555 0015", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_adebayo", user_id: null, full_name: "R. Adebayo", role: "receptionist", department_id: "dept_admin", email: "r.adebayo@generalhospital.med", phone: "+233 20 555 0016", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_quartey", user_id: null, full_name: "S. Quartey", role: "admin", department_id: "dept_admin", email: "s.quartey@generalhospital.med", phone: "+233 20 555 0017", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const patients: Patient[] = [
    { id: "pat_mensah", mrn: generateMrn(2026, 1), full_name: "Grace Mensah", date_of_birth: "1989-03-14", sex: "female", phone: "+233 20 555 0142", address: "12 Ring Rd, Accra", national_id: "GHA-8841203", is_emergency_anonymous: false, anonymous_identifier: null, created_at: day(3), updated_at: day(3) },
    { id: "pat_idris", mrn: generateMrn(2026, 2), full_name: "Samuel Idris", date_of_birth: "1972-11-02", sex: "male", phone: "+234 80 555 0199", address: "5 Awolowo St, Lagos", national_id: "NGA-5520117", is_emergency_anonymous: false, anonymous_identifier: null, created_at: day(28), updated_at: day(6) },
    { id: "pat_anon_gamma", mrn: generateMrn(2026, 3), full_name: "Unidentified Patient", date_of_birth: null, sex: "unknown", phone: null, address: null, national_id: null, is_emergency_anonymous: true, anonymous_identifier: "John Doe - Gamma - 20260531", created_at: day(5), updated_at: day(1) },
    { id: "pat_bello", mrn: generateMrn(2026, 4), full_name: "Aisha Bello", date_of_birth: "1995-07-21", sex: "female", phone: "+234 70 555 0173", address: "8 Marina Rd, Lagos", national_id: "NGA-7790455", is_emergency_anonymous: false, anonymous_identifier: null, created_at: day(96), updated_at: day(12) },
    { id: "pat_owusu", mrn: generateMrn(2026, 5), full_name: "Daniel Owusu", date_of_birth: "1960-01-09", sex: "male", phone: "+233 24 555 0166", address: "30 Cantonments, Accra", national_id: "GHA-3310928", is_emergency_anonymous: false, anonymous_identifier: null, created_at: day(720), updated_at: day(2) },
  ];

  const visits: Visit[] = [
    // Intake column (registration/triage) — emergency, just arrived.
    { id: "vis_mensah", patient_id: "pat_mensah", visit_type: "emergency", status: "open", stage: "triage", department_id: "dept_emergency", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Acute chest pain", triage_notes: "Diaphoretic, BP elevated. ECG ordered. Awaiting cardiac workup.", arrived_at: day(3), closed_at: null, created_at: day(3), updated_at: day(3) },
    // Consultation column (consultation/diagnostics) — outpatient diabetes follow-up.
    { id: "vis_owusu", patient_id: "pat_owusu", visit_type: "outpatient", status: "open", stage: "diagnostics", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Routine diabetes review", triage_notes: "Stable, ambulatory. HbA1c sample taken.", arrived_at: day(2), closed_at: null, created_at: day(2), updated_at: day(2) },
    // Treatment column — inpatient post-op recovery.
    { id: "vis_idris", patient_id: "pat_idris", visit_type: "inpatient", status: "open", stage: "treatment", department_id: "dept_surgery", attending_doctor_id: "staff_chen", registered_by_id: "staff_adebayo", chief_complaint: "Post-operative recovery, laparotomy", triage_notes: null, arrived_at: day(28), closed_at: null, created_at: day(28), updated_at: day(6) },
    // Treatment column — anonymous emergency, head trauma in ICU.
    { id: "vis_anon", patient_id: "pat_anon_gamma", visit_type: "emergency", status: "open", stage: "treatment", department_id: "dept_icu", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Unconscious on arrival, head trauma — RTA", triage_notes: "Unidentified. GCS 7 on arrival. Neuro protocol initiated.", arrived_at: day(5), closed_at: null, created_at: day(5), updated_at: day(1) },
    // Discharge column — inpatient pneumonia, awaiting financial clearance.
    { id: "vis_bello", patient_id: "pat_bello", visit_type: "inpatient", status: "open", stage: "discharge_planning", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Community-acquired pneumonia", triage_notes: null, arrived_at: day(96), closed_at: null, created_at: day(96), updated_at: day(12) },
  ];

  const consultations: Consultation[] = [
    { id: "con_owusu", visit_id: "vis_owusu", doctor_id: "staff_okafor", subjective: "Reports good adherence to metformin. Occasional polyuria. No hypoglycaemic episodes.", examination: "Well, afebrile. Feet examined — no ulcers. BMI 28.", assessment: "Type 2 diabetes mellitus, fair control.", plan: "Check HbA1c. Continue metformin. Dietary reinforcement. Review in 3 months.", created_at: day(2), updated_at: day(2) },
    { id: "con_idris", visit_id: "vis_idris", doctor_id: "staff_chen", subjective: "Mild incisional pain, controlled. Passing flatus.", examination: "Wound clean and dry. Abdomen soft. Bowel sounds present.", assessment: "Day-2 post laparotomy, recovering well.", plan: "Continue analgesia & DVT prophylaxis. Mobilize. Monitor wound.", created_at: day(26), updated_at: day(26) },
    { id: "con_bello", visit_id: "vis_bello", doctor_id: "staff_okafor", subjective: "Cough improving. No fever for 48h. Appetite returning.", examination: "Chest clear on auscultation. SpO₂ 98% on air.", assessment: "Community-acquired pneumonia, resolving.", plan: "Complete oral antibiotics. Plan discharge once finance cleared.", created_at: day(24), updated_at: day(24) },
    { id: "con_anon", visit_id: "vis_anon", doctor_id: "staff_okafor", subjective: "Unable to obtain — patient unresponsive.", examination: "GCS 7 on arrival. Pupils equal & reactive. Localizes to pain.", assessment: "Traumatic brain injury, RTA. Awaiting CT head.", plan: "Neuro protocol, mannitol, close monitoring. CT head urgent.", created_at: day(5), updated_at: day(5) },
  ];

  const diagnoses: Diagnosis[] = [
    { id: "dx_owusu", visit_id: "vis_owusu", consultation_id: "con_owusu", diagnosed_by_id: "staff_okafor", icd10_code: "E11.9", description: "Type 2 diabetes mellitus without complications", is_primary: true, created_at: day(2) },
    { id: "dx_bello", visit_id: "vis_bello", consultation_id: "con_bello", diagnosed_by_id: "staff_okafor", icd10_code: "J18.9", description: "Pneumonia, unspecified organism", is_primary: true, created_at: day(24) },
    { id: "dx_anon", visit_id: "vis_anon", consultation_id: "con_anon", diagnosed_by_id: "staff_okafor", icd10_code: "S06.9", description: "Intracranial injury, unspecified", is_primary: true, created_at: day(5) },
  ];

  const orders: Order[] = [
    { id: "ord_owusu_hba1c", visit_id: "vis_owusu", ordered_by_id: "staff_okafor", order_type: "lab", description: "HbA1c", status: "completed", created_at: day(2), completed_at: day(1), updated_at: day(1) },
    { id: "ord_bello_cxr", visit_id: "vis_bello", ordered_by_id: "staff_okafor", order_type: "imaging", description: "Chest X-ray (PA)", status: "completed", created_at: day(90), completed_at: day(88), updated_at: day(88) },
    { id: "ord_anon_ct", visit_id: "vis_anon", ordered_by_id: "staff_okafor", order_type: "imaging", description: "CT head (non-contrast)", status: "in_progress", created_at: day(5), completed_at: null, updated_at: day(4) },
  ];

  const results: Result[] = [
    { id: "res_owusu_hba1c", order_id: "ord_owusu_hba1c", recorded_by_id: "staff_boateng", summary: "Moderately elevated — reinforce adherence.", value: "7.8%", reference_range: "< 7.0%", attachment_path: null, recorded_at: day(1) },
    { id: "res_bello_cxr", order_id: "ord_bello_cxr", recorded_by_id: "staff_boateng", summary: "Right lower lobe consolidation, consistent with pneumonia.", value: "Abnormal", reference_range: null, attachment_path: null, recorded_at: day(88) },
  ];

  const prescriptions: Prescription[] = [
    { id: "rx_idris_para", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Paracetamol", dose: "1 g", route: "IV", frequency: "every 6 hours", duration: "3 days", instructions: "For post-op analgesia.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_idris_enox", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Enoxaparin", dose: "40 mg", route: "SC", frequency: "once daily", duration: "while inpatient", instructions: "DVT prophylaxis.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_bello_amox", visit_id: "vis_bello", prescribed_by_id: "staff_okafor", drug_name: "Amoxicillin-clavulanate", dose: "625 mg", route: "oral", frequency: "every 8 hours", duration: "7 days", instructions: "Complete full course.", status: "active", created_at: day(90), updated_at: day(12) },
    { id: "rx_owusu_metf", visit_id: "vis_owusu", prescribed_by_id: "staff_okafor", drug_name: "Metformin", dose: "1 g", route: "oral", frequency: "twice daily", duration: "ongoing", instructions: "Take with meals.", status: "active", created_at: day(2), updated_at: day(2) },
  ];

  const medicationAdministrations: MedicationAdministration[] = [
    { id: "mar_idris_para_1", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(12), administered_at: day(12), status: "given", notes: "Tolerated well.", created_at: day(12) },
    { id: "mar_idris_para_2", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(6), administered_at: day(6), status: "given", notes: null, created_at: day(6) },
    { id: "mar_idris_enox_1", prescription_id: "rx_idris_enox", administered_by_id: "staff_patel", scheduled_for: day(24), administered_at: day(24), status: "given", notes: null, created_at: day(24) },
    { id: "mar_bello_amox_1", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(16), administered_at: day(16), status: "given", notes: null, created_at: day(16) },
    { id: "mar_bello_amox_2", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(8), administered_at: null, status: "missed", notes: "Patient off ward for imaging.", created_at: day(8) },
  ];

  const treatmentRecords: TreatmentRecord[] = [
    { id: "trec_mensah_1", visit_id: "vis_mensah", recorded_by_id: "staff_romero", spo2: 96, pulse: 102, bp_systolic: 158, bp_diastolic: 96, temperature_c: 37.0, gcs_score: 15, notes: "Chest pain 7/10. ECG taken, troponin sent.", recorded_at: day(3) },
    { id: "trec_idris_1", visit_id: "vis_idris", recorded_by_id: "staff_patel", spo2: 97, pulse: 88, bp_systolic: 128, bp_diastolic: 82, temperature_c: 37.4, gcs_score: 15, notes: "Stable post-op. Pain controlled. Mobilizing with assistance.", recorded_at: day(6) },
    { id: "trec_anon_1", visit_id: "vis_anon", recorded_by_id: "staff_patel", spo2: 94, pulse: 104, bp_systolic: 148, bp_diastolic: 95, temperature_c: 37.9, gcs_score: 7, notes: "Unresponsive to voice, localizes to pain. Pupils equal/reactive. CT head pending.", recorded_at: day(4) },
    { id: "trec_anon_2", visit_id: "vis_anon", recorded_by_id: "staff_okafor", spo2: 96, pulse: 92, bp_systolic: 138, bp_diastolic: 88, temperature_c: 37.5, gcs_score: 9, notes: "Slight improvement in responsiveness. Continue close monitoring.", recorded_at: day(1) },
    { id: "trec_bello_1", visit_id: "vis_bello", recorded_by_id: "staff_patel", spo2: 98, pulse: 74, bp_systolic: 118, bp_diastolic: 76, temperature_c: 36.9, gcs_score: 15, notes: "Afebrile 48h. Chest clear on auscultation. Fit for discharge planning.", recorded_at: day(12) },
  ];

  const admissions: Admission[] = [
    { id: "adm_idris", visit_id: "vis_idris", patient_id: "pat_idris", attending_doctor_id: "staff_chen", ward_id: "ward_icu", bed_id: "bed_icu_04", status: "active", stage: "treatment", reason: "Post-operative recovery, laparotomy", is_medical_cleared: false, is_financial_cleared: true, is_pharmacy_ready: false, admitted_at: day(28), discharged_at: null, updated_at: day(6) },
    { id: "adm_anon_gamma", visit_id: "vis_anon", patient_id: "pat_anon_gamma", attending_doctor_id: "staff_okafor", ward_id: "ward_icu", bed_id: "bed_icu_02", status: "active", stage: "treatment", reason: "Unconscious on arrival, head trauma — RTA", is_medical_cleared: false, is_financial_cleared: false, is_pharmacy_ready: false, admitted_at: day(5), discharged_at: null, updated_at: day(1) },
    { id: "adm_bello", visit_id: "vis_bello", patient_id: "pat_bello", attending_doctor_id: "staff_okafor", ward_id: "ward_medb", bed_id: "bed_medb_11", status: "active", stage: "discharge_planning", reason: "Community-acquired pneumonia, responding to treatment", is_medical_cleared: true, is_financial_cleared: false, is_pharmacy_ready: true, admitted_at: day(96), discharged_at: null, updated_at: day(12) },
  ];

  return {
    departments,
    wards,
    beds,
    staff,
    patients,
    visits,
    consultations,
    diagnoses,
    orders,
    results,
    prescriptions,
    medicationAdministrations,
    treatmentRecords,
    admissions,
    mrnCounter: patients.length,
  };
}
