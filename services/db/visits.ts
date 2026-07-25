/**
 * Visits — the record spine: registration/intake (`createNewVisit`), visit
 * reads, department routing helpers, care-stage transitions with the
 * discharge verification gate, and the post-discharge follow-up worklist.
 */

import type {
  Admission,
  CareStage,
  DepartmentId,
  FollowUpTask,
  Patient,
  PatientId,
  StaffId,
  TriageLevel,
  Visit,
  VisitId,
  VisitType,
} from "@/types/healthcare";
import {
  generateId,
  generatePatientId,
  nowISO,
  uniquePatientId,
  type Database,
} from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped, tenantId } from "./tenancy";
import type { MessageKey } from "@/i18n";
import { generateAnonymousIdentifier, type CreatePatientInput } from "./patients";

export interface CreateVisitInput {
  visit_type: VisitType;
  department_id?: DepartmentId | null;
  attending_doctor_id?: StaffId | null;
  registered_by_id?: StaffId | null;
  chief_complaint?: string | null;
  triage_notes?: string | null;
  /** Emergency-severity acuity (1 = critical … 5 = non-urgent); null if untriaged. */
  triage_level?: TriageLevel | null;
  /** Defaults to "registration". */
  stage?: CareStage;
}

// ---------------------------------------------------------------------------
// Stage helpers (which stages still belong on the active board)
// ---------------------------------------------------------------------------

/** A visit has left the floor once it reaches one of these stages. */
export function isTerminalStage(stage: CareStage): boolean {
  return (
    stage === "discharged" || stage === "followed_up" || stage === "deceased"
  );
}

// ---------------------------------------------------------------------------
// Department routing helpers (pure — drive the board filter & per-unit views)
// ---------------------------------------------------------------------------

/** Sentinel meaning "no filter" — the admin / all-departments view. */
export const ALL_DEPARTMENTS = "all";

/** A department board filter: a real department id or the "all" sentinel. */
export type DepartmentFilter = DepartmentId | typeof ALL_DEPARTMENTS;

/**
 * Narrow a list of visits to a single department. A `null`/`undefined` or the
 * {@link ALL_DEPARTMENTS} sentinel returns the list untouched (admin view).
 * Pure — no storage access, so it is unit-testable.
 */
export function filterVisitsByDepartment<T extends { department_id: DepartmentId | null }>(
  visits: T[],
  departmentId: DepartmentFilter | null | undefined
): T[] {
  if (!departmentId || departmentId === ALL_DEPARTMENTS) return visits;
  return visits.filter((v) => v.department_id === departmentId);
}

/**
 * Tally visits per department id. Visits with no department are bucketed under
 * the {@link ALL_DEPARTMENTS} key. Pure — used for directory + nav badges.
 */
export function countVisitsByDepartment<T extends { department_id: DepartmentId | null }>(
  visits: T[]
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const v of visits) {
    const key = v.department_id ?? ALL_DEPARTMENTS;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/** Every visit a patient has ever had, most-recently arrived first. */
export function getVisitsForPatient(patientId: PatientId): Visit[] {
  return loadScoped()
    .visits.filter((v) => v.patient_id === patientId)
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
}

/**
 * Resolve a patient to the visit a search result should open: the open visit if
 * one exists, otherwise the most recently created visit. Undefined if the
 * patient has never had a visit.
 */
export function getLatestVisitForPatient(patientId: PatientId): Visit | undefined {
  const visits = loadScoped().visits.filter((v) => v.patient_id === patientId);
  if (visits.length === 0) return undefined;
  const open = visits.filter((v) => v.status === "open");
  const pool = open.length ? open : visits;
  return [...pool].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

// ---------------------------------------------------------------------------
// Read queries — visits (the record spine)
// ---------------------------------------------------------------------------

export function getVisits(): Visit[] {
  return loadScoped().visits;
}

export function getVisitById(id: VisitId): Visit | undefined {
  return loadScoped().visits.find((v) => v.id === id);
}

/**
 * All visits still in progress (status "open"), most-recently arrived first.
 * This drives the Live Status Board.
 */
export function getActiveVisits(): Visit[] {
  return loadScoped()
    .visits.filter((v) => v.status === "open")
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
}

/** Active visits routed to a given department (or all, for the admin view). */
export function getActiveVisitsForDepartment(
  departmentId: DepartmentFilter | null | undefined
): Visit[] {
  return filterVisitsByDepartment(getActiveVisits(), departmentId);
}

/** Per-department tally of active visits, keyed by department id. */
export function getActiveVisitCountsByDepartment(): Record<string, number> {
  return countVisitsByDepartment(getActiveVisits());
}

/** Visits whose patient is still flagged as an anonymous emergency. */
export function getAnonymousVisits(): Visit[] {
  const db = loadScoped();
  const anonymousPatientIds = new Set(
    db.patients.filter((p) => p.is_emergency_anonymous).map((p) => p.id)
  );
  return db.visits.filter((v) => anonymousPatientIds.has(v.patient_id));
}

// ---------------------------------------------------------------------------
// Mutations — registration / intake
// ---------------------------------------------------------------------------

/**
 * Register a patient and open their first visit in a single operation. Assigns a
 * permanent MRN (`CF-YYYY-NNNNNN`). For emergency anonymous intakes an anonymous
 * identifier is generated if the caller did not supply one.
 */

// ---------------------------------------------------------------------------
// Mutations — visits
// ---------------------------------------------------------------------------

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

  // Anonymous emergency records get no patient ID until reconciliation supplies
  // real identity details; everyone else gets a Cameroon booklet ID derived from
  // birth date + name initials + mother's initial, de-duplicated against peers.
  const mrn = isAnonymous
    ? ""
    : uniquePatientId(
        generatePatientId(
          patientData.date_of_birth ?? null,
          patientData.full_name,
          patientData.mother_first_name ?? null,
        ),
        db.patients.map((p) => p.mrn),
      );

  const patient: Patient = {
    id: generateId() as PatientId,
    hospital_id: tenantId(db),
    mrn,
    full_name: patientData.full_name,
    date_of_birth: patientData.date_of_birth ?? null,
    sex: patientData.sex ?? "unknown",
    phone: patientData.phone ?? null,
    address: patientData.address ?? null,
    national_id: patientData.national_id ?? null,
    mother_first_name: patientData.mother_first_name ?? null,
    is_emergency_anonymous: isAnonymous,
    anonymous_identifier: anonymousIdentifier,
    no_known_allergies: false,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const visit: Visit = {
    id: generateId() as VisitId,
    hospital_id: patient.hospital_id,
    patient_id: patient.id,
    visit_type: visitData.visit_type,
    status: "open",
    stage: visitData.stage ?? "registration",
    department_id: visitData.department_id ?? null,
    attending_doctor_id: visitData.attending_doctor_id ?? null,
    registered_by_id: visitData.registered_by_id ?? null,
    chief_complaint: visitData.chief_complaint ?? null,
    triage_notes: visitData.triage_notes ?? null,
    triage_level: visitData.triage_level ?? null,
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
// Verification gate + discharge
// ---------------------------------------------------------------------------

/**
 * Verification gate (Phase 5). Determine whether an inpatient admission is
 * eligible to be discharged. Discharge is blocked until all three department
 * clearances are granted AND the patient is no longer an unreconciled anonymous
 * emergency record. Pure — safe to call from the UI to drive button state.
 *
 * `blockers` are i18n message keys (resolved with `t()` at the render site), not
 * display text, so the gate stays language-agnostic.
 */
export function evaluateDischargeReadiness(
  admission: Admission,
  patient: Patient
): { ready: boolean; blockers: MessageKey[] } {
  const blockers: MessageKey[] = [];
  if (!admission.is_medical_cleared) blockers.push("drawer.blockerMedical");
  if (!admission.is_financial_cleared) blockers.push("drawer.blockerFinancial");
  if (!admission.is_pharmacy_ready) blockers.push("drawer.blockerPharmacy");
  if (patient.is_emergency_anonymous) {
    blockers.push("drawer.blockerReconcile");
  }
  return { ready: blockers.length === 0, blockers };
}

/**
 * Schedule the post-discharge follow-up tasks for a freshly discharged visit:
 * a recovery call at +2 days and a tele check-in at +7 days. Mutates the
 * caller's open `db` snapshot in place (no persist here — the caller's own
 * `persist(db)` picks the new rows up in the same outbox batch as the
 * discharge itself). Titles are patient-facing display data, not i18n keys;
 * anonymous patients are referred to by their emergency identifier.
 */
function createFollowUpTasksForDischarge(
  db: Database,
  visit: Visit,
  patient: Patient | undefined,
  timestamp: string
): void {
  const name =
    patient?.is_emergency_anonymous && patient.anonymous_identifier
      ? patient.anonymous_identifier
      : patient?.full_name ?? "Unknown patient";
  const dueAt = (days: number) =>
    new Date(new Date(timestamp).getTime() + days * 24 * 3600_000).toISOString();
  const base = {
    hospital_id: visit.hospital_id,
    patient_id: visit.patient_id,
    visit_id: visit.id,
    status: "pending" as const,
    completed_at: null,
    completed_by_id: null,
    notes: null,
    created_by_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.followUpTasks.push(
    {
      ...base,
      id: generateId(),
      kind: "call",
      title: `Call ${name} — post-discharge recovery check`,
      due_at: dueAt(2),
    },
    {
      ...base,
      id: generateId(),
      kind: "tele_checkin",
      title: `7-day check-in — ${name}`,
      due_at: dueAt(7),
    }
  );
}

/**
 * The tenant's follow-up worklist: pending tasks first, each group ordered by
 * due date ascending (most urgent at the top).
 */
export function getFollowUpTasks(): FollowUpTask[] {
  return [...loadScoped().followUpTasks].sort((a, b) => {
    const aPending = a.status === "pending" ? 0 : 1;
    const bPending = b.status === "pending" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return a.due_at.localeCompare(b.due_at);
  });
}

/**
 * Close a follow-up task as done — stamps who completed it and when, and an
 * optional outcome note. Returns the updated task.
 */
export function completeFollowUpTask(
  id: string,
  completedById: StaffId | null,
  notes?: string
): FollowUpTask {
  const db = loadDatabase();
  const task = db.followUpTasks.find((t) => t.id === id);
  if (!task) {
    throw new Error(`completeFollowUpTask: task "${id}" not found`);
  }
  const timestamp = nowISO();
  task.status = "done";
  task.completed_at = timestamp;
  task.completed_by_id = completedById;
  if (notes !== undefined) task.notes = notes;
  task.updated_at = timestamp;
  persist(db);
  return task;
}

/** Cancel a follow-up task (e.g. unreachable or no longer needed). */
export function cancelFollowUpTask(id: string): FollowUpTask {
  const db = loadDatabase();
  const task = db.followUpTasks.find((t) => t.id === id);
  if (!task) {
    throw new Error(`cancelFollowUpTask: task "${id}" not found`);
  }
  task.status = "cancelled";
  task.updated_at = nowISO();
  persist(db);
  return task;
}

/**
 * Move a visit to a new care stage.
 *
 * Reaching a terminal stage ("discharged"/"followed_up") closes the visit
 * (stamps `closed_at`, sets `status="closed"` so it drops off the active board),
 * and — for an inpatient visit with an admission — is gated: it throws unless
 * all clearances are granted and the patient is reconciled. A terminal
 * transition also discharges the admission, frees the bed, and schedules the
 * post-discharge follow-up tasks (never for a death).
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
  // A death is exempt: recording a patient's death is never withheld over a
  // pending clearance (financial/pharmacy/medical) or an unreconciled identity.
  if (becomingTerminal && newStage !== "deceased" && admission && patient) {
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

  // Schedule the post-discharge follow-up tasks — but never for a death.
  // Added to the same snapshot so the persist below commits discharge +
  // follow-ups atomically.
  if (becomingTerminal && newStage !== "deceased") {
    createFollowUpTasksForDischarge(db, visit, patient, timestamp);
  }

  persist(db);

  return visit;
}
