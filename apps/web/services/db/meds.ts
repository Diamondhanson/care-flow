/**
 * Medications — prescriptions and the Medication Administration Record
 * (MAR): the doctor's drug structure and the nurse's bedside outcomes.
 */

import type {
  DepartmentId,
  MarStatus,
  MealTiming,
  MedicationAdministration,
  MedicationAdministrationId,
  Prescription,
  PrescriptionId,
  PrescriptionStatus,
  StaffId,
  VisitId,
} from "@careflow/shared";
import { MedAdminSchema } from "@careflow/shared/validation/schemas";
import { emitUsage } from "@/services/telemetry";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped } from "./tenancy";
import { ALL_DEPARTMENTS } from "./visits";
import {
  nurseIdsForVisit,
  patientDisplayName,
  queueNotifications,
  staffIdsByRole,
} from "./notifications";

export interface AddPrescriptionInput {
  prescribed_by_id?: StaffId | null;
  drug_name: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  meal_timing?: MealTiming | null;
}

export interface RecordAdministrationInput {
  administered_by_id?: StaffId | null;
  status: MarStatus;
  /** When the dose was due; defaults to now. */
  scheduled_for?: string | null;
  /** When it was actually given; defaults to now for "given", else null. */
  administered_at?: string | null;
  notes?: string | null;
}

export function getPrescriptionsForVisit(visitId: VisitId): Prescription[] {
  return loadScoped()
    .prescriptions.filter((p) => p.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getMedicationAdministrationsForPrescription(
  prescriptionId: PrescriptionId
): MedicationAdministration[] {
  return loadScoped()
    .medicationAdministrations.filter((m) => m.prescription_id === prescriptionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Every active prescription belonging to a still-open visit — the working set
 * for the nurse Medication Administration Record (MAR). Oldest first so a stable
 * order; the MAR view re-sorts by dose urgency. Optionally narrowed to a single
 * department (for the per-unit / shift-handover view).
 */
export function getActivePrescriptions(
  departmentId?: DepartmentId | null
): Prescription[] {
  const db = loadScoped();
  const openVisitIds = new Set(
    db.visits
      .filter(
        (v) =>
          v.status === "open" &&
          (!departmentId ||
            departmentId === ALL_DEPARTMENTS ||
            v.department_id === departmentId)
      )
      .map((v) => v.id)
  );
  return db.prescriptions
    .filter((p) => p.status === "active" && openVisitIds.has(p.visit_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------------------
// Mutations — prescriptions & MAR (medication loop, Phase 10)
// ---------------------------------------------------------------------------

/**
 * Write a prescription against a visit — the doctor defining the *structure* of
 * the medication (drug, dose, route, frequency, duration, instructions). New
 * prescriptions are "active" and immediately generate doses on the nurse MAR.
 * `prescribed_by_id` falls back to the visit's attending doctor. Returns it.
 */
export function addPrescription(
  visitId: VisitId,
  input: AddPrescriptionInput
): Prescription {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addPrescription: visit "${visitId}" not found`);
  }
  const drugName = input.drug_name.trim();
  if (!drugName) {
    throw new Error("addPrescription: a drug name is required");
  }

  const timestamp = nowISO();
  const prescription: Prescription = {
    id: generateId() as PrescriptionId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    prescribed_by_id: input.prescribed_by_id ?? visit.attending_doctor_id ?? null,
    drug_name: drugName,
    dose: input.dose?.trim() || null,
    route: input.route?.trim() || null,
    frequency: input.frequency?.trim() || null,
    duration: input.duration?.trim() || null,
    instructions: input.instructions?.trim() || null,
    meal_timing: input.meal_timing ?? null,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prescriptions.push(prescription);
  visit.updated_at = timestamp;

  // New medication → nurses (to administer) and pharmacists (to dispense).
  const rxPatient = db.patients.find((p) => p.id === visit.patient_id);
  const rxAdmission = db.admissions.find(
    (a) => a.visit_id === visitId && a.status === "active",
  );
  queueNotifications(
    db,
    [...nurseIdsForVisit(db, visit, rxAdmission), ...staffIdsByRole(db, ["pharmacist"])],
    {
      type: "prescription.created",
      actorId: prescription.prescribed_by_id,
      title: `New prescription: ${prescription.drug_name}`,
      body: [prescription.dose, prescription.route, prescription.frequency]
        .filter(Boolean)
        .join(" · ") || patientDisplayName(rxPatient),
      entityType: "visit",
      entityId: visitId,
      patientId: visit.patient_id,
      patientName: patientDisplayName(rxPatient),
      link: "/medications",
      data: { drug_name: prescription.drug_name },
    },
  );

  persist(db);
  emitUsage("record_created", { kind: "prescription" });
  return prescription;
}

/**
 * Move a prescription along its lifecycle — the doctor/pharmacist marking it
 * "completed" (course finished) or "discontinued" (stopped early). An inactive
 * prescription stops generating doses on the MAR. Returns the updated row.
 */
export function updatePrescriptionStatus(
  prescriptionId: PrescriptionId,
  status: PrescriptionStatus
): Prescription {
  const db = loadDatabase();
  const prescription = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!prescription) {
    throw new Error(
      `updatePrescriptionStatus: prescription "${prescriptionId}" not found`
    );
  }
  prescription.status = status;
  prescription.updated_at = nowISO();
  persist(db);
  return prescription;
}

export interface UpdatePrescriptionInput {
  drug_name?: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  meal_timing?: MealTiming | null;
}

/**
 * Edit a prescription's structure in place — the doctor filling in dose / route
 * / frequency / duration / instructions on a row that was instant-added from a
 * drug pick. An empty drug name is rejected; the other fields normalise blanks
 * to null. Returns the updated row.
 */
export function updatePrescription(
  prescriptionId: PrescriptionId,
  input: UpdatePrescriptionInput
): Prescription {
  const db = loadDatabase();
  const prescription = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!prescription) {
    throw new Error(
      `updatePrescription: prescription "${prescriptionId}" not found`
    );
  }

  if (input.drug_name !== undefined) {
    const drugName = input.drug_name.trim();
    if (!drugName) {
      throw new Error("updatePrescription: a drug name is required");
    }
    prescription.drug_name = drugName;
  }
  if (input.dose !== undefined) prescription.dose = input.dose?.trim() || null;
  if (input.route !== undefined)
    prescription.route = input.route?.trim() || null;
  if (input.frequency !== undefined)
    prescription.frequency = input.frequency?.trim() || null;
  if (input.duration !== undefined)
    prescription.duration = input.duration?.trim() || null;
  if (input.instructions !== undefined)
    prescription.instructions = input.instructions?.trim() || null;
  if (input.meal_timing !== undefined)
    prescription.meal_timing = input.meal_timing ?? null;
  prescription.updated_at = nowISO();

  persist(db);
  return prescription;
}

/**
 * Delete a prescription outright (entered in error / instant-add undone).
 * Cascades to its MAR entries so no orphaned administrations survive
 * (order-rx-delete spec). Idempotent — deleting a missing row is a no-op.
 */
export function deletePrescription(prescriptionId: PrescriptionId): void {
  const db = loadDatabase();
  if (!db.prescriptions.some((p) => p.id === prescriptionId)) return;
  db.prescriptions = db.prescriptions.filter((p) => p.id !== prescriptionId);
  db.medicationAdministrations = db.medicationAdministrations.filter(
    (m) => m.prescription_id !== prescriptionId,
  );
  persist(db);
}

/**
 * Record a Medication Administration Record (MAR) entry — what actually
 * happened at the bedside for a scheduled dose: given / held / refused / missed,
 * by whom and when. This is how the next nurse knows what to give without going
 * back to the doctor, and the proof that care was delivered. For a "given" dose
 * `administered_at` defaults to now; for any other outcome it stays null unless
 * supplied. Returns the created record.
 */
export function recordMedicationAdministration(
  prescriptionId: PrescriptionId,
  input: RecordAdministrationInput
): MedicationAdministration {
  MedAdminSchema.parse(input); // status enum + notes cap
  const db = loadDatabase();
  const prescription = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!prescription) {
    throw new Error(
      `recordMedicationAdministration: prescription "${prescriptionId}" not found`
    );
  }

  const timestamp = nowISO();
  const administeredAt =
    input.administered_at !== undefined
      ? input.administered_at
      : input.status === "given"
        ? timestamp
        : null;

  const record: MedicationAdministration = {
    id: generateId() as MedicationAdministrationId,
    hospital_id: prescription.hospital_id,
    prescription_id: prescriptionId,
    administered_by_id: input.administered_by_id ?? null,
    scheduled_for: input.scheduled_for ?? timestamp,
    administered_at: administeredAt,
    status: input.status,
    notes: input.notes?.trim() || null,
    created_at: timestamp,
  };

  db.medicationAdministrations.push(record);

  // A dose that was NOT given (held/refused/missed) is a clinical exception the
  // prescriber and attending doctor need to see. A normal "given" is routine and
  // stays quiet, so the bell doesn't drown in medication noise. A "suspended"
  // dose is a deliberate pause on the prescription, not a bedside exception.
  if (record.status !== "given" && record.status !== "suspended") {
    const marVisit = db.visits.find((v) => v.id === prescription.visit_id);
    const marPatient = marVisit
      ? db.patients.find((p) => p.id === marVisit.patient_id)
      : undefined;
    queueNotifications(
      db,
      [prescription.prescribed_by_id, marVisit?.attending_doctor_id],
      {
        type: "mar.exception",
        actorId: record.administered_by_id,
        title: `Dose ${record.status}: ${prescription.drug_name}`,
        body: record.notes ?? patientDisplayName(marPatient),
        entityType: "visit",
        entityId: prescription.visit_id,
        patientId: marVisit?.patient_id ?? null,
        patientName: patientDisplayName(marPatient),
        link: "/medications",
        data: { status: record.status, drug_name: prescription.drug_name },
      },
    );
  }

  // Touch the parent prescription so consumers see fresh activity.
  prescription.updated_at = timestamp;
  persist(db);
  emitUsage("record_created", { kind: "mar" });
  return record;
}
