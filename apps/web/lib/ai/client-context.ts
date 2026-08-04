/**
 * On-device Patient Context Bundle assembler (Phase 22, spec §6).
 *
 * Runs in the BROWSER against the on-device store (`services/mockStorage`) —
 * deliberately not against the server. CareFlow is offline-first: the doctor
 * clicks "Suggest next steps" seconds after saving the subjective/ROS, and
 * those rows may still be sitting in the outbox, unsynced. The device is the
 * source of freshest truth; a server-side read could be stale.
 *
 * The bundle carries NO direct identifiers: initials + age instead of the
 * name, and no phone/email/national ID/address. The server re-validates the
 * shape (zod), verifies tenant scope through RLS, and runs its own redaction
 * pass before anything reaches the model.
 *
 * `buildPatientContextFromRows` is the pure, unit-testable core; the
 * `buildPatientContext(visitId)` wrapper just feeds it from the store.
 */

import type {
  Allergy,
  Consultation,
  Diagnosis,
  Order,
  Patient,
  PatientHistory,
  Prescription,
  Result,
  RosResponse,
  TreatmentRecord,
  Visit,
} from "@careflow/shared";
import type { PatientContext } from "@careflow/shared/types/ai";

import {
  getAllergiesForPatient,
  getConsultationsForVisit,
  getDiagnosesForVisit,
  getHistoryForPatient,
  getOrdersForVisit,
  getPatientById,
  getPrescriptionsForVisit,
  getResultsForVisit,
  getRosResponsesForVisit,
  getTreatmentRecordsForVisit,
  getVisitById,
} from "@/services/mockStorage";

// Keep the bundle compact (spec §6 / §13): most recent + relevant, never the
// whole history. These sit at or under the zod caps in PatientContextSchema.
const MAX_HISTORY = 20;
const MAX_ALLERGIES = 30;
const MAX_ROS = 20;
const MAX_ORDERS = 20;
const MAX_RESULTS = 10;
const MAX_DIAGNOSES = 10;
const MAX_MEDICATIONS = 20;

const trunc = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
};

/** "Jean Paul Biya" → "JPB"; anonymous records fall back to "PT". */
function initialsOf(patient: Patient): string {
  const source = patient.is_emergency_anonymous
    ? (patient.anonymous_identifier ?? "")
    : patient.full_name;
  const initials = source
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z]/.test(w))
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return initials || "PT";
}

function ageYearsOf(patient: Patient, nowMs: number): number | null {
  if (!patient.date_of_birth) return null;
  const dob = new Date(patient.date_of_birth).getTime();
  if (Number.isNaN(dob) || dob > nowMs) return null;
  return Math.min(130, Math.floor((nowMs - dob) / (365.25 * 24 * 3600 * 1000)));
}

export interface PatientContextRows {
  visit: Visit;
  patient: Patient;
  allergies: Allergy[];
  history: PatientHistory[];
  /** Newest first (the store's order from getConsultationsForVisit). */
  consultations: Consultation[];
  ros: RosResponse[];
  vitals: TreatmentRecord[];
  orders: Order[];
  results: Result[];
  diagnoses: Diagnosis[];
  prescriptions: Prescription[];
  nowMs: number;
}

export function buildPatientContextFromRows(rows: PatientContextRows): PatientContext {
  const latestConsultation = rows.consultations[0] ?? null;

  const latestVitals =
    [...rows.vitals].sort(
      (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
    )[0] ?? null;

  const orderById = new Map(rows.orders.map((o) => [o.id as string, o]));

  return {
    patient: {
      id: rows.patient.id,
      initials: initialsOf(rows.patient),
      ageYears: ageYearsOf(rows.patient, rows.nowMs),
      sex: rows.patient.sex ?? null,
    },
    history: rows.history.slice(0, MAX_HISTORY).map((h) => ({
      type: h.type,
      description: trunc(h.description, 500) ?? "",
      onset: trunc(h.onset, 80),
      isActive: h.is_active,
    })),
    allergies: rows.allergies.slice(0, MAX_ALLERGIES).map((a) => ({
      substance: trunc(a.substance, 200) ?? "",
      category: a.category ?? null,
      reaction: trunc(a.reaction, 300),
      severity: a.severity ?? null,
    })),
    visit: {
      id: rows.visit.id,
      type: rows.visit.visit_type,
      stage: rows.visit.stage,
      chiefComplaint: trunc(rows.visit.chief_complaint, 1000),
      triageLevel: rows.visit.triage_level ?? null,
    },
    subjective: trunc(latestConsultation?.subjective, 8000),
    examination: trunc(latestConsultation?.examination, 8000),
    // Most recent answers win when the bank is long.
    ros: rows.ros.slice(-MAX_ROS).map((r) => ({
      system: r.system,
      question: trunc(r.question_text, 300) ?? "",
      answer: trunc(r.answer_label, 300) ?? "",
    })),
    vitals: latestVitals
      ? {
          spo2: latestVitals.spo2,
          pulse: latestVitals.pulse,
          bpSystolic: latestVitals.bp_systolic,
          bpDiastolic: latestVitals.bp_diastolic,
          temperatureC: latestVitals.temperature_c,
          weightKg: latestVitals.weight_kg,
          gcs: latestVitals.gcs_score,
          recordedAt: latestVitals.recorded_at,
        }
      : null,
    orders: rows.orders.slice(-MAX_ORDERS).map((o) => ({
      id: o.id,
      type: o.order_type,
      description: trunc(o.description, 500) ?? "",
      status: o.status,
    })),
    results: rows.results.slice(-MAX_RESULTS).map((r) => ({
      orderId: r.order_id ?? null,
      orderDescription:
        trunc(orderById.get(r.order_id as string)?.description, 500) ?? "(unknown order)",
      value: trunc(r.value, 1000),
      referenceRange: trunc(r.reference_range, 300),
      isAbnormal: r.is_abnormal,
      summary: trunc(r.summary, 2000),
      attachmentPath: r.attachment_path ?? null,
    })),
    existingDiagnoses: rows.diagnoses.slice(-MAX_DIAGNOSES).map((d) => ({
      description: trunc(d.description, 500) ?? "",
      icd10: trunc(d.icd10_code, 20),
      isPrimary: d.is_primary,
    })),
    currentMedications: rows.prescriptions
      .filter((p) => p.status === "active")
      .slice(-MAX_MEDICATIONS)
      .map((p) => ({
        drug: trunc(p.drug_name, 200) ?? "",
        dose: trunc(p.dose, 100),
        route: trunc(p.route, 60),
        frequency: trunc(p.frequency, 100),
      })),
  };
}

/** Assemble the bundle for a visit from the on-device store. */
export function buildPatientContext(visitId: string): PatientContext | null {
  const visit = getVisitById(visitId as Visit["id"]);
  if (!visit) return null;
  const patient = getPatientById(visit.patient_id);
  if (!patient) return null;

  return buildPatientContextFromRows({
    visit,
    patient,
    allergies: getAllergiesForPatient(visit.patient_id),
    history: getHistoryForPatient(visit.patient_id),
    consultations: getConsultationsForVisit(visit.id),
    ros: getRosResponsesForVisit(visit.id),
    vitals: getTreatmentRecordsForVisit(visit.id),
    orders: getOrdersForVisit(visit.id),
    results: getResultsForVisit(visit.id),
    diagnoses: getDiagnosesForVisit(visit.id),
    prescriptions: getPrescriptionsForVisit(visit.id),
    nowMs: Date.now(),
  });
}

/**
 * Cheap stable hash of a bundle (djb2 over its JSON) — the panel re-shows the
 * cached suggestion when nothing changed instead of paying for a new call.
 */
export function hashContext(ctx: PatientContext): string {
  const json = JSON.stringify(ctx);
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
