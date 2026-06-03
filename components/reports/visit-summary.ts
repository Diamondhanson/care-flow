/**
 * Visit summary aggregation (Phase 16, pulled forward) — gathers everything
 * recorded during a single hospital encounter into one structured object so it
 * can be rendered as a comprehensive, take-home patient report.
 *
 * This is a data-access module (it reads the mock store), not a pure function;
 * the PDF builder in `visit-summary-export.ts` consumes its output. Keeping the
 * gathering here means the report can never drift from the clinical record.
 */

import {
  getVisitById,
  getVisitsForPatient,
  getPatientById,
  getDepartmentById,
  getStaff,
  getWards,
  getBeds,
  getAllergiesForPatient,
  getTreatmentRecordsForVisit,
  getConsultationsForVisit,
  getDiagnosesForVisit,
  getOrdersForVisit,
  getResultsForOrder,
  getPrescriptionsForVisit,
  getMedicationAdministrationsForPrescription,
  getAdmissionForVisit,
  getTransfersForAdmission,
} from "@/services/mockStorage";
import type {
  Admission,
  Allergy,
  Consultation,
  Department,
  Diagnosis,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  Staff,
  TreatmentRecord,
  Transfer,
  Visit,
} from "@/types/healthcare";

export interface OrderWithResults {
  order: Order;
  results: Result[];
}

export interface PrescriptionWithAdministrations {
  prescription: Prescription;
  administrations: MedicationAdministration[];
}

export interface VisitSummaryData {
  patient: Patient;
  visit: Visit;
  department: Department | null;
  attendingDoctor: Staff | null;
  registeredBy: Staff | null;
  allergies: Allergy[];
  vitals: TreatmentRecord[];
  consultations: Consultation[];
  diagnoses: Diagnosis[];
  orders: OrderWithResults[];
  prescriptions: PrescriptionWithAdministrations[];
  admission: Admission | null;
  transfers: Transfer[];
  /** Resolved display-name lookups so the renderer stays free of joins. */
  staffName: (id: string | null | undefined) => string | null;
  wardName: (id: string | null | undefined) => string | null;
  bedName: (id: string | null | undefined) => string | null;
  /** Whole days between admission and discharge (or now, if still admitted). */
  lengthOfStayDays: number | null;
  generatedAtMs: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Assemble the full record for one visit. Returns `null` if the visit (or its
 * patient) cannot be found — the caller should treat that as "nothing to print".
 */
export function buildVisitSummary(visitId: string): VisitSummaryData | null {
  const visit = getVisitById(visitId);
  if (!visit) return null;
  const patient = getPatientById(visit.patient_id);
  if (!patient) return null;
  return buildSummaryFromVisit(visit, patient);
}

function buildSummaryFromVisit(visit: Visit, patient: Patient): VisitSummaryData {
  const staffById = new Map(getStaff().map((s) => [s.id, s]));
  const wardById = new Map(getWards().map((w) => [w.id, w]));
  const bedById = new Map(getBeds().map((b) => [b.id, b]));

  const staffName = (id: string | null | undefined) =>
    id ? (staffById.get(id)?.full_name ?? null) : null;
  const wardName = (id: string | null | undefined) =>
    id ? (wardById.get(id)?.name ?? null) : null;
  const bedName = (id: string | null | undefined) =>
    id ? (bedById.get(id)?.label ?? null) : null;

  const admission = getAdmissionForVisit(visit.id) ?? null;
  const transfers = admission ? getTransfersForAdmission(admission.id) : [];

  let lengthOfStayDays: number | null = null;
  if (admission) {
    const start = new Date(admission.admitted_at).getTime();
    const end = admission.discharged_at
      ? new Date(admission.discharged_at).getTime()
      : Date.now();
    lengthOfStayDays = Math.max(0, Math.round((end - start) / MS_PER_DAY));
  }

  const orders: OrderWithResults[] = getOrdersForVisit(visit.id).map((order) => ({
    order,
    results: getResultsForOrder(order.id),
  }));

  const prescriptions: PrescriptionWithAdministrations[] =
    getPrescriptionsForVisit(visit.id).map((prescription) => ({
      prescription,
      administrations: getMedicationAdministrationsForPrescription(
        prescription.id,
      ),
    }));

  return {
    patient,
    visit,
    department: visit.department_id
      ? (getDepartmentById(visit.department_id) ?? null)
      : null,
    attendingDoctor: visit.attending_doctor_id
      ? (staffById.get(visit.attending_doctor_id) ?? null)
      : null,
    registeredBy: visit.registered_by_id
      ? (staffById.get(visit.registered_by_id) ?? null)
      : null,
    allergies: getAllergiesForPatient(patient.id),
    vitals: [...getTreatmentRecordsForVisit(visit.id)].sort((a, b) =>
      a.recorded_at.localeCompare(b.recorded_at),
    ),
    consultations: getConsultationsForVisit(visit.id),
    diagnoses: [...getDiagnosesForVisit(visit.id)].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    ),
    orders,
    prescriptions,
    admission,
    transfers,
    staffName,
    wardName,
    bedName,
    lengthOfStayDays,
    generatedAtMs: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Full patient history — every visit, for a longitudinal "take to another
// hospital" record. Reuses the per-visit aggregation above.
// ---------------------------------------------------------------------------

export interface PatientHistoryData {
  patient: Patient;
  /** Patient-level allergies, shown once at the top of the history. */
  allergies: Allergy[];
  /** One full summary per visit, oldest → newest (chronological timeline). */
  visits: VisitSummaryData[];
  totalVisits: number;
  firstArrivedAt: string | null;
  lastArrivedAt: string | null;
  generatedAtMs: number;
}

/**
 * Assemble every visit for a patient into a chronological history. Returns
 * `null` if the patient cannot be found. A patient with no visits yields an
 * empty `visits` array (the renderer shows a "no visits" note).
 */
export function buildPatientHistory(patientId: string): PatientHistoryData | null {
  const patient = getPatientById(patientId);
  if (!patient) return null;

  // Oldest → newest so the document reads as a timeline.
  const visits = getVisitsForPatient(patientId)
    .slice()
    .sort((a, b) => a.arrived_at.localeCompare(b.arrived_at));

  const summaries = visits.map((v) => buildSummaryFromVisit(v, patient));

  return {
    patient,
    allergies: getAllergiesForPatient(patient.id),
    visits: summaries,
    totalVisits: summaries.length,
    firstArrivedAt: visits.length ? visits[0].arrived_at : null,
    lastArrivedAt: visits.length ? visits[visits.length - 1].arrived_at : null,
    generatedAtMs: Date.now(),
  };
}
