/**
 * Patient register (Phase 19) — the hospital's line-by-line consultation /
 * hospitalisation register, modeled on the Cameroon MINSANTE paper register.
 *
 * Unlike the analytics in `reports.ts` (aggregates), this assembles one ROW per
 * visit/encounter, pulling the patient, latest vitals, entry diagnosis, ordered
 * tests, treatment, admission and outcome into a flat, exportable record.
 *
 * Like `visit-summary.ts`, this is a data-access module (it reads the mock
 * store), not a pure transform. The single `REGISTER_COLUMNS` descriptor array
 * is the one source of truth consumed by the on-screen table AND the PDF / Excel
 * / CSV exporters, so the register can never drift between screen and download.
 */

import {
  getVisits,
  getPatients,
  getDepartments,
  getStaff,
  getAllergiesForPatient,
  getTreatmentRecordsForVisit,
  getDiagnosesForVisit,
  getOrdersForVisit,
  getPrescriptionsForVisit,
  getAdmissionForVisit,
} from "@/services/mockStorage";
import type {
  CareStage,
  Sex,
  Visit,
  VisitStatus,
  VisitType,
} from "@/types/healthcare";
import { formatDate } from "@/i18n/format";
import type { Locale } from "@/i18n";
import {
  CARE_STAGE_LABEL,
  SEX_LABEL,
  VISIT_TYPE_LABEL,
  type DateRange,
  type Translate,
} from "./reports";

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Row shape — resolved primitives only (formatting happens in the columns so
// both screen and exports localize identically).
// ---------------------------------------------------------------------------

export interface PatientRegisterRow {
  rowNo: number;
  visitId: string;
  patientId: string;
  arrivedAtMs: number;
  /** First visit for this patient → "new" case; otherwise a returning "old" case. */
  caseNew: boolean;
  patientCode: string | null;
  fullName: string;
  sex: Sex;
  /** Age at the time of the visit. Months populated only for infants (< 2y). */
  ageYears: number | null;
  ageMonths: number | null;
  phone: string | null;
  residence: string | null;
  visitType: VisitType;
  departmentId: string | null;
  departmentName: string | null;
  triageLevel: number | null;
  chiefComplaint: string | null;
  /** Primary diagnosis description, falling back to the chief complaint. */
  entryDiagnosis: string | null;
  investigations: string | null;
  treatment: string | null;
  allergies: string | null;
  weightKg: number | null;
  bp: string | null;
  temperatureC: number | null;
  attendingDoctor: string | null;
  admittedAtMs: number | null;
  dischargedAtMs: number | null;
  losDays: number | null;
  dischargeDiagnosis: string | null;
  stage: CareStage;
  status: VisitStatus;
}

export interface RegisterFilters {
  /** "all" | "in_hospital" (active admission) | "open" | "discharged" */
  status: RegisterStatusFilter;
  visitType: VisitType | "all";
  departmentId: string | "all";
  sex: Sex | "all";
  /** Free-text match on name or patient code. */
  query: string;
}

export type RegisterStatusFilter = "all" | "in_hospital" | "open" | "discharged";

export const DEFAULT_REGISTER_FILTERS: RegisterFilters = {
  status: "all",
  visitType: "all",
  departmentId: "all",
  sex: "all",
  query: "",
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function ageAt(dobIso: string | null, atMs: number): { years: number | null; months: number | null } {
  if (!dobIso) return { years: null, months: null };
  const dob = new Date(dobIso);
  const at = new Date(atMs);
  if (Number.isNaN(dob.getTime())) return { years: null, months: null };
  let months =
    (at.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - dob.getUTCMonth());
  if (at.getUTCDate() < dob.getUTCDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  // Infants: surface months instead of "0y" (the paper register asks for the unit).
  return { years, months: years < 2 ? months : null };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Build the register for the given period. Rows are one-per-visit whose
 * arrival falls inside `range`, newest first, then filtered by `filters`.
 */
export function buildPatientRegister(
  range: DateRange,
  filters: RegisterFilters = DEFAULT_REGISTER_FILTERS,
): PatientRegisterRow[] {
  const patientById = new Map(getPatients().map((p) => [p.id, p]));
  const departmentById = new Map(getDepartments().map((d) => [d.id, d]));
  const staffById = new Map(getStaff().map((s) => [s.id, s]));

  // Earliest arrival per patient → "new vs old" case classification.
  const earliestArrival = new Map<string, number>();
  for (const v of getVisits()) {
    const ms = Date.parse(v.arrived_at);
    const prev = earliestArrival.get(v.patient_id);
    if (prev === undefined || ms < prev) earliestArrival.set(v.patient_id, ms);
  }

  const inRange = (v: Visit) => {
    const ms = Date.parse(v.arrived_at);
    return ms >= range.startMs && ms <= range.endMs;
  };

  const visits = getVisits()
    .filter(inRange)
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));

  const rows: PatientRegisterRow[] = [];
  for (const visit of visits) {
    const patient = patientById.get(visit.patient_id);
    if (!patient) continue;

    const arrivedAtMs = Date.parse(visit.arrived_at);
    const { years, months } = ageAt(patient.date_of_birth, arrivedAtMs);

    // Latest vitals snapshot for this visit.
    const vitals = [...getTreatmentRecordsForVisit(visit.id)].sort((a, b) =>
      a.recorded_at.localeCompare(b.recorded_at),
    );
    const latest = vitals[vitals.length - 1] ?? null;
    const bp =
      latest && latest.bp_systolic != null && latest.bp_diastolic != null
        ? `${latest.bp_systolic}/${latest.bp_diastolic}`
        : null;

    // Primary diagnosis (is_primary first).
    const diagnoses = [...getDiagnosesForVisit(visit.id)].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    const primaryDiagnosis = diagnoses[0]?.description ?? null;

    const orders = getOrdersForVisit(visit.id);
    const investigations = orders.length
      ? orders.map((o) => o.description).join("; ")
      : null;

    const prescriptions = getPrescriptionsForVisit(visit.id);
    const treatment = prescriptions.length
      ? prescriptions
          .map((p) => (p.dose ? `${p.drug_name} ${p.dose}` : p.drug_name))
          .join("; ")
      : null;

    const allergyList = getAllergiesForPatient(patient.id);
    const allergies = allergyList.length
      ? allergyList.map((a) => a.substance).join(", ")
      : patient.no_known_allergies
        ? "NKA"
        : null;

    const admission = getAdmissionForVisit(visit.id);
    const admittedAtMs = admission ? Date.parse(admission.admitted_at) : null;
    const dischargedAtMs =
      admission?.discharged_at
        ? Date.parse(admission.discharged_at)
        : visit.closed_at
          ? Date.parse(visit.closed_at)
          : null;
    let losDays: number | null = null;
    if (admission) {
      const end = admission.discharged_at
        ? Date.parse(admission.discharged_at)
        : range.endMs;
      losDays = Math.max(0, Math.round((end - Date.parse(admission.admitted_at)) / MS_PER_DAY));
    }

    rows.push({
      rowNo: 0, // assigned after filtering
      visitId: visit.id,
      patientId: patient.id,
      arrivedAtMs,
      caseNew: earliestArrival.get(patient.id) === arrivedAtMs,
      patientCode: nonEmpty(patient.mrn),
      fullName: patient.full_name,
      sex: patient.sex,
      ageYears: years,
      ageMonths: months,
      phone: nonEmpty(patient.phone),
      residence: nonEmpty(patient.address),
      visitType: visit.visit_type,
      departmentId: visit.department_id,
      departmentName: visit.department_id
        ? (departmentById.get(visit.department_id)?.name ?? null)
        : null,
      triageLevel: visit.triage_level,
      chiefComplaint: nonEmpty(visit.chief_complaint),
      entryDiagnosis: primaryDiagnosis ?? nonEmpty(visit.chief_complaint),
      investigations,
      treatment,
      allergies,
      weightKg: latest?.weight_kg ?? null,
      bp,
      temperatureC: latest?.temperature_c ?? null,
      attendingDoctor: visit.attending_doctor_id
        ? (staffById.get(visit.attending_doctor_id)?.full_name ?? null)
        : null,
      admittedAtMs,
      dischargedAtMs,
      losDays,
      dischargeDiagnosis: primaryDiagnosis,
      stage: visit.stage,
      status: visit.status,
    });
  }

  const filtered = rows.filter((r) => matchesFilters(r, filters));
  // Sequential register number (newest = 1), assigned after filtering.
  return filtered.map((r, i) => ({ ...r, rowNo: i + 1 }));
}

function matchesFilters(row: PatientRegisterRow, f: RegisterFilters): boolean {
  if (f.visitType !== "all" && row.visitType !== f.visitType) return false;
  if (f.sex !== "all" && row.sex !== f.sex) return false;
  if (f.departmentId !== "all" && row.departmentId !== f.departmentId) return false;
  if (f.status === "in_hospital" && !(row.admittedAtMs != null && row.dischargedAtMs == null)) {
    return false;
  }
  if (f.status === "open" && row.status !== "open") return false;
  if (f.status === "discharged" && row.dischargedAtMs == null) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${row.fullName} ${row.patientCode ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Outcome (Devenir / Future) — derived from the visit's terminal stage.
// ---------------------------------------------------------------------------

export function outcomeKey(row: PatientRegisterRow): string {
  if (row.stage === "deceased") return "reports.register.outcome.deceased";
  if (row.status === "cancelled") return "reports.register.outcome.cancelled";
  if (row.stage === "discharged" || row.stage === "followed_up") {
    return "reports.register.outcome.discharged";
  }
  return "reports.register.outcome.inCare";
}

// ---------------------------------------------------------------------------
// Column descriptors — one source of truth for screen + PDF + Excel + CSV.
// ---------------------------------------------------------------------------

export interface RegisterFmtCtx {
  t: Translate;
  locale: Locale;
}

export interface RegisterColumn {
  key: string;
  /** i18n key for the column header. */
  headerKey: string;
  /** Right-align + monospace on screen; numeric formatting in sheets. */
  numeric?: boolean;
  /** Included in the (legible, landscape) PDF. Long free-text columns are excluded. */
  essential?: boolean;
  value: (row: PatientRegisterRow, ctx: RegisterFmtCtx) => string;
}

const DASH = "—";

function fmtDay(ms: number | null, locale: Locale): string {
  if (ms == null) return DASH;
  return formatDate(ms, locale, { dateStyle: "medium" });
}

function ageText(row: PatientRegisterRow, t: Translate): string {
  if (row.ageMonths != null) return t("reports.register.ageMonths", { n: row.ageMonths });
  if (row.ageYears != null) return t("reports.register.ageYears", { n: row.ageYears });
  return DASH;
}

export const REGISTER_COLUMNS: RegisterColumn[] = [
  { key: "rowNo", headerKey: "reports.register.col.no", numeric: true, essential: true, value: (r) => String(r.rowNo) },
  { key: "date", headerKey: "reports.register.col.date", essential: true, value: (r, c) => fmtDay(r.arrivedAtMs, c.locale) },
  { key: "case", headerKey: "reports.register.col.case", essential: true, value: (r, c) => c.t(r.caseNew ? "reports.register.case.new" : "reports.register.case.old") },
  { key: "patientCode", headerKey: "reports.register.col.patientCode", essential: true, value: (r) => r.patientCode ?? DASH },
  { key: "name", headerKey: "reports.register.col.name", essential: true, value: (r) => r.fullName },
  { key: "sex", headerKey: "reports.register.col.sex", essential: true, value: (r, c) => c.t(SEX_LABEL[r.sex]) },
  { key: "age", headerKey: "reports.register.col.age", essential: true, value: (r, c) => ageText(r, c.t) },
  { key: "phone", headerKey: "reports.register.col.phone", value: (r) => r.phone ?? DASH },
  { key: "residence", headerKey: "reports.register.col.residence", value: (r) => r.residence ?? DASH },
  { key: "type", headerKey: "reports.register.col.type", essential: true, value: (r, c) => c.t(VISIT_TYPE_LABEL[r.visitType]) },
  { key: "department", headerKey: "reports.register.col.department", essential: true, value: (r) => r.departmentName ?? DASH },
  { key: "weight", headerKey: "reports.register.col.weight", numeric: true, value: (r) => (r.weightKg != null ? `${r.weightKg}` : DASH) },
  { key: "bp", headerKey: "reports.register.col.bp", value: (r) => r.bp ?? DASH },
  { key: "temp", headerKey: "reports.register.col.temp", numeric: true, value: (r) => (r.temperatureC != null ? `${r.temperatureC}` : DASH) },
  { key: "chiefComplaint", headerKey: "reports.register.col.chiefComplaint", value: (r) => r.chiefComplaint ?? DASH },
  { key: "entryDiagnosis", headerKey: "reports.register.col.entryDiagnosis", essential: true, value: (r) => r.entryDiagnosis ?? DASH },
  { key: "investigations", headerKey: "reports.register.col.investigations", value: (r) => r.investigations ?? DASH },
  { key: "treatment", headerKey: "reports.register.col.treatment", value: (r) => r.treatment ?? DASH },
  { key: "allergies", headerKey: "reports.register.col.allergies", value: (r) => r.allergies ?? DASH },
  { key: "doctor", headerKey: "reports.register.col.doctor", essential: true, value: (r) => r.attendingDoctor ?? DASH },
  { key: "admitDate", headerKey: "reports.register.col.admitDate", value: (r, c) => fmtDay(r.admittedAtMs, c.locale) },
  { key: "dischargeDate", headerKey: "reports.register.col.dischargeDate", essential: true, value: (r, c) => fmtDay(r.dischargedAtMs, c.locale) },
  { key: "los", headerKey: "reports.register.col.los", numeric: true, essential: true, value: (r) => (r.losDays != null ? String(r.losDays) : DASH) },
  { key: "outcome", headerKey: "reports.register.col.outcome", essential: true, value: (r, c) => c.t(outcomeKey(r)) },
  { key: "status", headerKey: "reports.register.col.status", essential: true, value: (r, c) => c.t(`reports.register.statusValue.${r.status}`) },
];
