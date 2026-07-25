/**
 * Patient background & Review of Systems (Phase 21) — the patient-level
 * clinical-background record (`patient_history`) and the per-visit answered
 * ROS questions (`ros_responses`). History persists across encounters
 * (review-and-update, not re-enter); ROS rows are visit-scoped and adopted by
 * the consultation that closes the encounter (see db/clinical.ts).
 */

import type {
  BodySystem,
  PatientHistory,
  PatientHistoryId,
  PatientHistoryType,
  PatientId,
  RosAnswerType,
  RosAnswerValue,
  RosQuestionKind,
  RosResponse,
  RosResponseId,
  StaffId,
  VisitId,
} from "@careflow/shared";
import {
  AddPatientHistoryInputSchema,
  UpsertRosInputSchema,
} from "@careflow/shared/validation/schemas";
import { validateAnswerAgainstBank } from "@/lib/ros";
import { emitUsage } from "@/services/telemetry";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped } from "./tenancy";

export interface AddPatientHistoryInput {
  type: PatientHistoryType;
  /** e.g. "Type 2 diabetes", "Appendectomy 2015", "Mother — breast cancer". */
  description: string;
  /** Type-specific structured fields (see HISTORY_DETAIL_SHAPES in validation). */
  detail?: Record<string, unknown> | null;
  /** Coarse timing: "2015", "childhood", "since 2020". */
  onset?: string | null;
  /** past_medical: still active? Omit when not applicable. */
  is_active?: boolean | null;
  noted_by_id?: StaffId | null;
}

export interface UpsertRosInput {
  system: BodySystem;
  /** Stable bank key, e.g. "cardiac.chest_pain.character". */
  question_key: string;
  kind: RosQuestionKind;
  /** Snapshot of the prompt at answer time (history-safe). */
  question_text: string;
  answer_type: RosAnswerType;
  answer_value: RosAnswerValue;
  /** Localized human-readable answer for the report. */
  answer_label: string;
  note?: string | null;
  recorded_by_id?: StaffId | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * A patient's clinical background (Phase 21), grouped for the drawer: sorted by
 * history type (in PATIENT_HISTORY_TYPE_ORDER), then most-recently noted first
 * within each type. Patient-level — persists and pre-fills across visits.
 */
export const PATIENT_HISTORY_TYPE_ORDER: readonly PatientHistoryType[] = [
  "past_medical",
  "past_surgical",
  "family",
  "social",
  "obstetric_gynae",
  "medication",
  "immunization",
];

export function getHistoryForPatient(patientId: PatientId): PatientHistory[] {
  const order = new Map(PATIENT_HISTORY_TYPE_ORDER.map((t, i) => [t, i]));
  return loadScoped()
    .patientHistory.filter((h) => h.patient_id === patientId)
    .sort(
      (a, b) =>
        (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99) ||
        b.created_at.localeCompare(a.created_at),
    );
}

/** One visit's answered ROS questions (Phase 21), in answer order. */
export function getRosResponsesForVisit(visitId: VisitId): RosResponse[] {
  return loadScoped()
    .rosResponses.filter((r) => r.visit_id === visitId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------------------
// Mutations — patient background
// ---------------------------------------------------------------------------

/** Record one clinical-background item (patient-level; persists across visits). */
export function addPatientHistory(
  patientId: PatientId,
  input: AddPatientHistoryInput
): PatientHistory {
  AddPatientHistoryInputSchema.parse(input);
  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`addPatientHistory: patient "${patientId}" not found`);
  }

  const timestamp = nowISO();
  const history: PatientHistory = {
    id: generateId() as PatientHistoryId,
    hospital_id: patient.hospital_id,
    patient_id: patientId,
    type: input.type,
    description: input.description.trim(),
    detail: input.detail ?? null,
    onset: input.onset?.trim() || null,
    is_active: input.is_active ?? null,
    noted_by_id: input.noted_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.patientHistory.push(history);
  persist(db);
  // Bare counter only — family/social/genetic content is sensitive PII and
  // never reaches telemetry.
  emitUsage("record_created", { kind: "patient_history" });
  return history;
}

/** Review-and-update an existing background item (type is immutable). */
export function updatePatientHistory(
  historyId: PatientHistoryId,
  updates: Partial<Omit<AddPatientHistoryInput, "type">>
): PatientHistory {
  const db = loadDatabase();
  const history = db.patientHistory.find((h) => h.id === historyId);
  if (!history) {
    throw new Error(`updatePatientHistory: record "${historyId}" not found`);
  }
  AddPatientHistoryInputSchema.parse({
    type: history.type,
    description: updates.description ?? history.description,
    detail: updates.detail !== undefined ? updates.detail : history.detail,
    onset: updates.onset !== undefined ? updates.onset : history.onset,
    is_active:
      updates.is_active !== undefined ? updates.is_active : history.is_active,
    noted_by_id:
      updates.noted_by_id !== undefined
        ? updates.noted_by_id
        : history.noted_by_id,
  });

  if (updates.description !== undefined) {
    history.description = updates.description.trim();
  }
  if (updates.detail !== undefined) history.detail = updates.detail ?? null;
  if (updates.onset !== undefined) history.onset = updates.onset?.trim() || null;
  if (updates.is_active !== undefined) history.is_active = updates.is_active;
  if (updates.noted_by_id !== undefined) {
    history.noted_by_id = updates.noted_by_id ?? null;
  }
  history.updated_at = nowISO();
  persist(db);
  return history;
}

/** Remove a background item (e.g. entered in error). */
export function deletePatientHistory(historyId: PatientHistoryId): void {
  const db = loadDatabase();
  const history = db.patientHistory.find((h) => h.id === historyId);
  if (!history) return;
  db.patientHistory = db.patientHistory.filter((h) => h.id !== historyId);
  persist(db);
}

// ---------------------------------------------------------------------------
// Mutations — Review of Systems
// ---------------------------------------------------------------------------

/**
 * Record (or re-record) one answered ROS question for a visit. Unique on
 * (visit_id, question_key): re-answering updates the row in place, mirroring
 * the DB constraint, so a question never appears twice in an encounter.
 * Validates the answer shape (zod) AND the bank contract (known key, matching
 * answer type, option membership).
 */
export function upsertRosResponse(
  visitId: VisitId,
  input: UpsertRosInput
): RosResponse {
  UpsertRosInputSchema.parse(input);
  const bankError = validateAnswerAgainstBank(
    input.question_key,
    input.answer_type,
    input.answer_value
  );
  if (bankError) throw new Error(`upsertRosResponse: ${bankError}`);

  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`upsertRosResponse: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const existing = db.rosResponses.find(
    (r) => r.visit_id === visitId && r.question_key === input.question_key
  );
  if (existing) {
    existing.answer_value = input.answer_value;
    existing.answer_label = input.answer_label.trim();
    existing.note = input.note?.trim() || null;
    if (input.recorded_by_id !== undefined) {
      existing.recorded_by_id = input.recorded_by_id ?? null;
    }
    existing.updated_at = timestamp;
    persist(db);
    return existing;
  }

  const response: RosResponse = {
    id: generateId() as RosResponseId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    consultation_id: null,
    system: input.system,
    question_key: input.question_key,
    kind: input.kind,
    question_text: input.question_text.trim(),
    answer_type: input.answer_type,
    answer_value: input.answer_value,
    answer_label: input.answer_label.trim(),
    note: input.note?.trim() || null,
    recorded_by_id: input.recorded_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.rosResponses.push(response);
  persist(db);
  emitUsage("record_created", { kind: "ros_response" });
  return response;
}

/** Clear an answer — absence of a row means "not asked". */
export function clearRosResponse(visitId: VisitId, questionKey: string): void {
  const db = loadDatabase();
  const existing = db.rosResponses.find(
    (r) => r.visit_id === visitId && r.question_key === questionKey
  );
  if (!existing) return;
  db.rosResponses = db.rosResponses.filter((r) => r !== existing);
  persist(db);
}
