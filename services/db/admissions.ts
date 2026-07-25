/**
 * Admissions — inpatient stays: creation & clearance gates, ward/bed
 * transfers with occupancy sync, transfer history, and the nursing care
 * plan (needs, care log and shift handovers).
 */

import type {
  Admission,
  AdmissionId,
  Bed,
  BedId,
  CareNeedCategory,
  CarePlanEntry,
  CarePlanEntryId,
  CarePlanItem,
  CarePlanItemId,
  CareStage,
  Patient,
  PatientId,
  StaffId,
  Transfer,
  TransferId,
  Visit,
  VisitId,
  Ward,
  WardId,
} from "@/types/healthcare";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped } from "./tenancy";

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

export interface TransferAdmissionInput {
  to_ward_id?: WardId | null;
  to_bed_id?: BedId | null;
  to_doctor_id?: StaffId | null;
  reason?: string | null;
  transferred_by_id?: StaffId | null;
}

export interface AddCarePlanItemInput {
  category: CareNeedCategory;
  description: string;
  frequency?: string | null;
  goal?: string | null;
  created_by_id?: StaffId | null;
}

export interface AddCarePlanEntryInput {
  note: string;
  /** Tie the note to a specific care need, when applicable. */
  care_plan_item_id?: CarePlanItemId | null;
  /** Mark as a shift-handover message for the next nurse. */
  is_handover?: boolean;
  recorded_by_id?: StaffId | null;
}

// ---------------------------------------------------------------------------
// Read queries — admissions (inpatient only)
// ---------------------------------------------------------------------------

export function getAdmissions(): Admission[] {
  return loadScoped().admissions;
}

export function getAdmissionById(id: AdmissionId): Admission | undefined {
  return loadScoped().admissions.find((a) => a.id === id);
}

/** The admission for a visit, if it became an inpatient stay. */
export function getAdmissionForVisit(visitId: VisitId): Admission | undefined {
  return loadScoped().admissions.find((a) => a.visit_id === visitId);
}

/** Admissions still occupying a bed (status "active"). */
export function getActiveAdmissions(): Admission[] {
  return loadScoped()
    .admissions.filter((a) => a.status === "active")
    .sort((a, b) => b.admitted_at.localeCompare(a.admitted_at));
}

/** The move history for an admission, most recent first. */
export function getTransfersForAdmission(admissionId: AdmissionId): Transfer[] {
  return loadScoped()
    .transfers.filter((t) => t.admission_id === admissionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The move history for a patient across all admissions, most recent first. */
export function getTransfersForPatient(patientId: PatientId): Transfer[] {
  return loadScoped()
    .transfers.filter((t) => t.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Reads — nursing care plan
// ---------------------------------------------------------------------------

/** Care-plan needs for an admission. Active first, then by creation order. */
export function getCarePlanItemsForAdmission(
  admissionId: AdmissionId
): CarePlanItem[] {
  return loadScoped()
    .carePlanItems.filter((i) => i.admission_id === admissionId)
    .sort((a, b) => {
      // Active needs lead; within a status, oldest-first keeps the plan stable.
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });
}

/** The care log + handover notes for an admission, most recent first. */
export function getCarePlanEntriesForAdmission(
  admissionId: AdmissionId
): CarePlanEntry[] {
  return loadScoped()
    .carePlanEntries.filter((e) => e.admission_id === admissionId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/**
 * The currently admitted patients a nurse manages a care plan for: each active
 * admission joined to its visit, patient, ward and bed, plus the count of active
 * care needs and whether a handover note is waiting. Sorted by ward then bed so
 * the list reads like a ward round.
 */
export interface CarePlanPatient {
  admission: Admission;
  visit: Visit | undefined;
  patient: Patient | undefined;
  ward: Ward | undefined;
  bed: Bed | undefined;
  activeNeeds: number;
  /** The most recent handover note, if any (drives the "handover waiting" cue). */
  latestHandover: CarePlanEntry | null;
}

export function getAdmittedPatientsForCarePlan(): CarePlanPatient[] {
  const db = loadScoped();
  return db.admissions
    .filter((a) => a.status === "active")
    .map((admission) => {
      const visit = db.visits.find((v) => v.id === admission.visit_id);
      const patient = db.patients.find((p) => p.id === admission.patient_id);
      const ward = admission.ward_id
        ? db.wards.find((w) => w.id === admission.ward_id)
        : undefined;
      const bed = admission.bed_id
        ? db.beds.find((b) => b.id === admission.bed_id)
        : undefined;
      const activeNeeds = db.carePlanItems.filter(
        (i) => i.admission_id === admission.id && i.status === "active"
      ).length;
      const latestHandover =
        db.carePlanEntries
          .filter((e) => e.admission_id === admission.id && e.is_handover)
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
      return { admission, visit, patient, ward, bed, activeNeeds, latestHandover };
    })
    .sort((a, b) => {
      const wardCmp = (a.ward?.name ?? "").localeCompare(b.ward?.name ?? "");
      if (wardCmp !== 0) return wardCmp;
      return (a.bed?.label ?? "").localeCompare(b.bed?.label ?? "");
    });
}

export function getAllTransfers(): Transfer[] {
  return loadScoped().transfers;
}

/**
 * Move an active admission to a new ward, bed, and/or attending doctor, logging
 * the change as an append-only Transfer event. Frees the previously-occupied bed
 * and occupies the new one (mirrors the `sync_bed_occupancy` trigger on a bed
 * change). A provided bed implies its ward unless a ward is given explicitly.
 *
 * `undefined` on a field means "leave unchanged"; an explicit `null` clears it.
 * Throws if the admission is not active or the target bed is taken by someone
 * else. Also used for the initial bed assignment of a bedless admission.
 */
export function transferAdmission(
  admissionId: AdmissionId,
  input: TransferAdmissionInput
): { admission: Admission; transfer: Transfer } {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`transferAdmission: admission "${admissionId}" not found`);
  }
  if (admission.status !== "active") {
    throw new Error("Cannot transfer a discharged admission");
  }

  const timestamp = nowISO();
  const fromWard = admission.ward_id;
  const fromBed = admission.bed_id;
  const fromDoctor = admission.attending_doctor_id;

  const bedProvided = input.to_bed_id !== undefined;
  const toBed = bedProvided ? input.to_bed_id ?? null : fromBed;
  const toDoctor =
    input.to_doctor_id !== undefined ? input.to_doctor_id : fromDoctor;
  let toWard: WardId | null;
  if (input.to_ward_id !== undefined) {
    toWard = input.to_ward_id;
  } else if (bedProvided && toBed) {
    toWard = db.beds.find((b) => b.id === toBed)?.ward_id ?? fromWard;
  } else {
    toWard = fromWard;
  }

  // Validate the target bed before mutating anything.
  if (toBed && toBed !== fromBed) {
    const target = db.beds.find((b) => b.id === toBed);
    if (!target) throw new Error(`transferAdmission: bed "${toBed}" not found`);
    if (
      target.current_admission_id &&
      target.current_admission_id !== admissionId
    ) {
      throw new Error("Target bed is already occupied");
    }
  }

  // Free the old bed when the bed changed.
  if (fromBed && fromBed !== toBed) {
    const old = db.beds.find((b) => b.id === fromBed);
    if (old) {
      old.status = "free";
      old.current_admission_id = null;
      old.updated_at = timestamp;
    }
  }
  // Occupy the new bed.
  if (toBed && toBed !== fromBed) {
    const next = db.beds.find((b) => b.id === toBed);
    if (next) {
      next.status = "occupied";
      next.current_admission_id = admissionId;
      next.updated_at = timestamp;
    }
  }

  admission.ward_id = toWard;
  admission.bed_id = toBed;
  admission.attending_doctor_id = toDoctor ?? null;
  admission.updated_at = timestamp;

  // Keep the visit's attending doctor in lock-step on a doctor change.
  if (toDoctor !== fromDoctor) {
    const visit = db.visits.find((v) => v.id === admission.visit_id);
    if (visit) {
      visit.attending_doctor_id = toDoctor ?? null;
      visit.updated_at = timestamp;
    }
  }

  const transfer: Transfer = {
    id: generateId() as TransferId,
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    patient_id: admission.patient_id,
    from_ward_id: fromWard,
    to_ward_id: toWard,
    from_bed_id: fromBed,
    to_bed_id: toBed,
    from_doctor_id: fromDoctor,
    to_doctor_id: toDoctor ?? null,
    reason: input.reason?.trim() || null,
    transferred_by_id: input.transferred_by_id ?? null,
    created_at: timestamp,
  };
  db.transfers.push(transfer);

  persist(db);
  return { admission, transfer };
}

/** Assign a free bed to an admission that doesn't have one yet (logs a Transfer). */
export function assignBedToAdmission(
  admissionId: AdmissionId,
  bedId: BedId,
  byId: StaffId | null = null
): Admission {
  const { admission } = transferAdmission(admissionId, {
    to_bed_id: bedId,
    reason: "Bed assignment",
    transferred_by_id: byId,
  });
  return admission;
}

// ---------------------------------------------------------------------------
// Mutations — nursing care plan
// ---------------------------------------------------------------------------

/** Add a care need to an admission's plan. Returns the created item. */
export function addCarePlanItem(
  admissionId: AdmissionId,
  input: AddCarePlanItemInput
): CarePlanItem {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`addCarePlanItem: admission "${admissionId}" not found`);
  }
  const timestamp = nowISO();
  const item: CarePlanItem = {
    id: generateId() as CarePlanItemId,
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    patient_id: admission.patient_id,
    category: input.category,
    description: input.description.trim(),
    frequency: input.frequency?.trim() || null,
    goal: input.goal?.trim() || null,
    status: "active",
    created_by_id: input.created_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.carePlanItems.push(item);
  persist(db);
  return item;
}

/** Mark a care need as resolved (kept on the record, not deleted). */
export function resolveCarePlanItem(itemId: CarePlanItemId): CarePlanItem {
  const db = loadDatabase();
  const item = db.carePlanItems.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`resolveCarePlanItem: item "${itemId}" not found`);
  }
  item.status = "resolved";
  item.updated_at = nowISO();
  persist(db);
  return item;
}

/**
 * Append a care-log note or a shift-handover message to an admission. Append-only
 * (never overwritten), mirroring transfers — so the handover trail is durable.
 */
export function addCarePlanEntry(
  admissionId: AdmissionId,
  input: AddCarePlanEntryInput
): CarePlanEntry {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`addCarePlanEntry: admission "${admissionId}" not found`);
  }
  const entry: CarePlanEntry = {
    id: generateId() as CarePlanEntryId,
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    care_plan_item_id: input.care_plan_item_id ?? null,
    note: input.note.trim(),
    is_handover: input.is_handover ?? false,
    recorded_by_id: input.recorded_by_id ?? null,
    recorded_at: nowISO(),
  };
  db.carePlanEntries.push(entry);
  persist(db);
  return entry;
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
    id: generateId() as AdmissionId,
    hospital_id: visit.hospital_id,
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
