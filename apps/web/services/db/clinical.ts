/**
 * Clinical record — consultations, diagnoses, disposition decisions,
 * diagnostic orders & results, and treatment records (vitals / GCS).
 */

import type {
  BedId,
  CareStage,
  Consultation,
  ConsultationId,
  Diagnosis,
  DiagnosisId,
  Order,
  OrderId,
  OrderStatus,
  OrderType,
  Result,
  ResultId,
  StaffId,
  TreatmentRecord,
  TreatmentRecordId,
  Visit,
  VisitId,
  WardId,
} from "@careflow/shared";
import {
  ResultEntrySchema,
  VitalsSchema,
} from "@careflow/shared/validation/schemas";
import { emitUsage } from "@/services/telemetry";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped } from "./tenancy";
import { updateVisitStage } from "./visits";
import { createAdmissionForVisit, getAdmissionForVisit } from "./admissions";
import {
  nurseIdsForVisit,
  patientDisplayName,
  queueNotifications,
  staffIdsByRole,
} from "./notifications";

export interface AddTreatmentLogInput {
  recorded_by_id?: StaffId | null;
  spo2?: number | null;
  pulse?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  temperature_c?: number | null;
  weight_kg?: number | null;
  gcs_score?: number | null;
  notes?: string | null;
  recorded_at?: string;
}

export interface AddConsultationInput {
  doctor_id?: StaffId | null;
  subjective?: string | null;
  examination?: string | null;
  assessment?: string | null;
  plan?: string | null;
  /**
   * Compiled ROS narrative (Phase 21) — derived by the UI from the visit's
   * `ros_responses` rows via `compileRosNarrative` at save time. Saving also
   * links the visit's unlinked ROS rows to this consultation.
   */
  ros_summary?: string | null;
}

export interface AddDiagnosisInput {
  consultation_id?: ConsultationId | null;
  diagnosed_by_id?: StaffId | null;
  icd10_code?: string | null;
  description: string;
  is_primary?: boolean;
}

export interface AddOrderInput {
  ordered_by_id?: StaffId | null;
  order_type: OrderType;
  description: string;
}

export interface AddResultInput {
  recorded_by_id?: StaffId | null;
  summary?: string | null;
  value?: string | null;
  reference_range?: string | null;
  is_abnormal?: boolean;
  /** Mock attachment reference (filename); no binary is stored in this phase. */
  attachment_path?: string | null;
}

// ---------------------------------------------------------------------------
// Read queries — clinical record (hang off a visit)
// ---------------------------------------------------------------------------

export function getConsultationsForVisit(visitId: VisitId): Consultation[] {
  return loadScoped()
    .consultations.filter((c) => c.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getDiagnosesForVisit(visitId: VisitId): Diagnosis[] {
  return loadScoped()
    .diagnoses.filter((d) => d.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getOrdersForVisit(visitId: VisitId): Order[] {
  return loadScoped()
    .orders.filter((o) => o.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getResultsForOrder(orderId: OrderId): Result[] {
  return loadScoped()
    .results.filter((r) => r.order_id === orderId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/** All results recorded against any order belonging to a visit. */
export function getResultsForVisit(visitId: VisitId): Result[] {
  const db = loadScoped();
  const orderIds = new Set(
    db.orders.filter((o) => o.visit_id === visitId).map((o) => o.id)
  );
  return db.results
    .filter((r) => orderIds.has(r.order_id))
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/**
 * The diagnostics work queue — every order still awaiting a result
 * ("requested" or "in_progress"), oldest first so the longest-waiting test is
 * actioned next. Optionally narrowed to a single order type (lab / imaging).
 */
export function getOpenOrders(orderType?: OrderType): Order[] {
  return loadScoped()
    .orders.filter(
      (o) =>
        (o.status === "requested" || o.status === "in_progress") &&
        (orderType ? o.order_type === orderType : true)
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getTreatmentRecordsForVisit(visitId: VisitId): TreatmentRecord[] {
  return loadScoped()
    .treatmentRecords.filter((r) => r.visit_id === visitId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

// ---------------------------------------------------------------------------
// Whole-collection reads — used by the reporting/analytics layer, which needs
// every row (not just the per-visit/per-patient slices above) to aggregate.
// ---------------------------------------------------------------------------

export function getAllDiagnoses(): Diagnosis[] {
  return loadScoped().diagnoses;
}

export function getAllResults(): Result[] {
  return loadScoped().results;
}

export function getAllTreatmentRecords(): TreatmentRecord[] {
  return loadScoped().treatmentRecords;
}

// ---------------------------------------------------------------------------
// Mutations — clinical logging
// ---------------------------------------------------------------------------

/** Append a vitals / GCS checkpoint to a visit. */
export function addTreatmentLog(
  visitId: VisitId,
  logData: AddTreatmentLogInput
): TreatmentRecord {
  VitalsSchema.parse(logData); // bounded clinical ranges + caps
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addTreatmentLog: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const record: TreatmentRecord = {
    id: generateId() as TreatmentRecordId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    recorded_by_id: logData.recorded_by_id ?? null,
    spo2: logData.spo2 ?? null,
    pulse: logData.pulse ?? null,
    bp_systolic: logData.bp_systolic ?? null,
    bp_diastolic: logData.bp_diastolic ?? null,
    temperature_c: logData.temperature_c ?? null,
    weight_kg: logData.weight_kg ?? null,
    gcs_score: logData.gcs_score ?? null,
    notes: logData.notes ?? null,
    recorded_at: logData.recorded_at ?? timestamp,
  };

  db.treatmentRecords.push(record);

  // Nurse logged vitals → let the attending doctor know (they may need to act on
  // an abnormal reading). Actor (the recording nurse) is excluded.
  const vitalsPatient = db.patients.find((p) => p.id === visit.patient_id);
  queueNotifications(db, [visit.attending_doctor_id], {
    type: "vitals.recorded",
    actorId: record.recorded_by_id,
    title: `Vitals recorded: ${patientDisplayName(vitalsPatient) ?? "patient"}`,
    body: [
      record.bp_systolic && record.bp_diastolic
        ? `BP ${record.bp_systolic}/${record.bp_diastolic}`
        : null,
      record.pulse ? `HR ${record.pulse}` : null,
      record.spo2 ? `SpO₂ ${record.spo2}%` : null,
      record.temperature_c ? `T ${record.temperature_c}°C` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null,
    entityType: "visit",
    entityId: visitId,
    patientId: visit.patient_id,
    patientName: patientDisplayName(vitalsPatient),
    link: "/worklist",
    data: {
      spo2: record.spo2,
      pulse: record.pulse,
      bp_systolic: record.bp_systolic,
      bp_diastolic: record.bp_diastolic,
      temperature_c: record.temperature_c,
      gcs_score: record.gcs_score,
    },
  });

  // Touch the parent visit so consumers see fresh activity.
  visit.updated_at = timestamp;
  persist(db);

  emitUsage("record_created", { kind: "vitals" });
  return record;
}

// ---------------------------------------------------------------------------
// Mutations — clinical encounter (doctor consultation, Phase 8)
// ---------------------------------------------------------------------------

/**
 * Record a doctor's SOAP-style consultation note against a visit. Advances the
 * visit to the "consultation" stage if it has not progressed past triage yet, so
 * the encounter is reflected on the board. Returns the created consultation.
 */
export function addConsultation(
  visitId: VisitId,
  input: AddConsultationInput
): Consultation {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addConsultation: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const consultation: Consultation = {
    id: generateId() as ConsultationId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    doctor_id: input.doctor_id ?? visit.attending_doctor_id ?? null,
    subjective: input.subjective?.trim() || null,
    examination: input.examination?.trim() || null,
    assessment: input.assessment?.trim() || null,
    plan: input.plan?.trim() || null,
    ros_summary: input.ros_summary?.trim() || null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.consultations.push(consultation);

  // Phase 21: adopt the visit's not-yet-linked ROS answers (recorded per tap,
  // before any consultation row existed) into this encounter's record.
  for (const r of db.rosResponses) {
    if (r.visit_id === visitId && r.consultation_id === null) {
      r.consultation_id = consultation.id;
      r.updated_at = timestamp;
    }
  }

  // Surface the encounter on the board: a freshly-triaged patient who has just
  // been seen moves into "consultation".
  if (visit.stage === "registration" || visit.stage === "triage") {
    visit.stage = "consultation";
  }
  visit.updated_at = timestamp;

  // Doctor wrote a note → alert the nursing team caring for this patient.
  const consultPatient = db.patients.find((p) => p.id === visit.patient_id);
  const admissionForConsult = db.admissions.find(
    (a) => a.visit_id === visitId && a.status === "active",
  );
  queueNotifications(db, nurseIdsForVisit(db, visit, admissionForConsult), {
    type: "consultation.created",
    actorId: consultation.doctor_id,
    title: `Consultation note: ${patientDisplayName(consultPatient) ?? "patient"}`,
    body: consultation.plan ?? consultation.assessment,
    entityType: "visit",
    entityId: visitId,
    patientId: visit.patient_id,
    patientName: patientDisplayName(consultPatient),
    link: "/worklist",
    data: { has_plan: Boolean(consultation.plan) },
  });

  persist(db);
  emitUsage("record_created", { kind: "consultation" });
  return consultation;
}

/**
 * Record a structured diagnosis against a visit (ICD-10 where known). Marking a
 * new diagnosis as primary demotes any existing primary for the same visit so
 * exactly one diagnosis is flagged primary at a time. Returns the created row.
 */
export function addDiagnosis(
  visitId: VisitId,
  input: AddDiagnosisInput
): Diagnosis {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addDiagnosis: visit "${visitId}" not found`);
  }
  const description = input.description.trim();
  if (!description) {
    throw new Error("addDiagnosis: a diagnosis description is required");
  }

  const isPrimary = input.is_primary ?? false;
  if (isPrimary) {
    for (const existing of db.diagnoses) {
      if (existing.visit_id === visitId && existing.is_primary) {
        existing.is_primary = false;
      }
    }
  }

  const timestamp = nowISO();
  const diagnosis: Diagnosis = {
    id: generateId() as DiagnosisId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    consultation_id: input.consultation_id ?? null,
    diagnosed_by_id: input.diagnosed_by_id ?? visit.attending_doctor_id ?? null,
    icd10_code: input.icd10_code?.trim() || null,
    description,
    is_primary: isPrimary,
    created_at: timestamp,
  };

  db.diagnoses.push(diagnosis);
  visit.updated_at = timestamp;
  persist(db);
  return diagnosis;
}

/**
 * Disposition — the doctor's end-of-consultation decision on where the patient
 * goes next. Modeled as an orchestration over the existing stage/admission
 * mutations (no new schema field) plus an audit note in the treatment record so
 * the choice is visible in history and survives a reload.
 */
export type Disposition =
  | "discharge_home"
  | "admit"
  | "observation"
  | "refer"
  | "deceased";

const DISPOSITION_PLAN: Record<
  Disposition,
  { note: string; stage: CareStage; admit: boolean }
> = {
  discharge_home: {
    note: "Disposition: Discharge home",
    stage: "discharge_planning",
    admit: false,
  },
  admit: {
    note: "Disposition: Admit to inpatient ward",
    stage: "treatment",
    admit: true,
  },
  observation: {
    note: "Disposition: Keep under observation",
    stage: "treatment",
    admit: false,
  },
  refer: {
    note: "Disposition: Refer to specialist / external facility",
    stage: "discharge_planning",
    admit: false,
  },
  // A death recorded at the consultation (e.g. brought in deceased / died during
  // the encounter). Terminal: closes the visit without admitting.
  deceased: {
    note: "Disposition: Patient deceased",
    stage: "deceased",
    admit: false,
  },
};

/** Optional structured details captured with a disposition decision. */
export interface DispositionDetails {
  // admit → placement
  ward_id?: WardId | null;
  bed_id?: BedId | null;
  attending_doctor_id?: StaffId | null;
  reason?: string | null;
  // observation
  observation_reason?: string | null;
  observation_duration?: string | null;
  observation_location?: string | null;
  // referral
  referral_reason?: string | null;
  referral_facility?: string | null;
  referral_recipient?: string | null;
}

const clean = (s?: string | null): string | null => s?.trim() || null;

/**
 * Apply a disposition decision to a visit. For "admit" an inpatient admission is
 * created if one does not yet exist (with the chosen ward / bed / reason /
 * doctor). Observation / referral details are persisted onto the visit's
 * dedicated columns. The decision is logged as a treatment-record note and the
 * visit is moved to the corresponding care stage. Returns the visit.
 */
export function recordDisposition(
  visitId: VisitId,
  disposition: Disposition,
  decidedById?: StaffId | null,
  details?: DispositionDetails
): Visit {
  const plan = DISPOSITION_PLAN[disposition];
  if (!plan) {
    throw new Error(`recordDisposition: unknown disposition "${disposition}"`);
  }

  // Admit → create the admission with the chosen ward / bed / reason / doctor.
  if (plan.admit && !getAdmissionForVisit(visitId)) {
    createAdmissionForVisit(visitId, {
      attending_doctor_id:
        details?.attending_doctor_id ?? decidedById ?? null,
      ward_id: details?.ward_id ?? null,
      bed_id: details?.bed_id ?? null,
      reason: clean(details?.reason),
      stage: plan.stage,
    });
  }

  // Observation / referral → persist details onto the visit's dedicated fields.
  if (
    (disposition === "observation" || disposition === "refer") &&
    details
  ) {
    const db = loadDatabase();
    const visit = db.visits.find((v) => v.id === visitId);
    if (visit) {
      if (disposition === "observation") {
        visit.observation_reason = clean(details.observation_reason);
        visit.observation_duration = clean(details.observation_duration);
        visit.observation_location = clean(details.observation_location);
      } else {
        visit.referral_reason = clean(details.referral_reason);
        visit.referral_facility = clean(details.referral_facility);
        visit.referral_recipient = clean(details.referral_recipient);
      }
      visit.updated_at = nowISO();
      persist(db);
    }
  }

  addTreatmentLog(visitId, {
    recorded_by_id: decidedById ?? null,
    notes: composeDispositionNote(disposition, plan.note, details),
  });

  return updateVisitStage(visitId, plan.stage);
}

/** Build an informative audit note from the disposition + captured details. */
function composeDispositionNote(
  disposition: Disposition,
  baseNote: string,
  details?: DispositionDetails
): string {
  if (!details) return baseNote;
  const parts: string[] = [];
  if (disposition === "observation") {
    if (clean(details.observation_reason)) parts.push(`for ${details.observation_reason!.trim()}`);
    if (clean(details.observation_duration)) parts.push(`duration ${details.observation_duration!.trim()}`);
    if (clean(details.observation_location)) parts.push(`at ${details.observation_location!.trim()}`);
  } else if (disposition === "refer") {
    if (clean(details.referral_facility)) parts.push(`to ${details.referral_facility!.trim()}`);
    if (clean(details.referral_recipient)) parts.push(`attn ${details.referral_recipient!.trim()}`);
    if (clean(details.referral_reason)) parts.push(`reason: ${details.referral_reason!.trim()}`);
  } else if (disposition === "admit") {
    if (clean(details.reason)) parts.push(`reason: ${details.reason!.trim()}`);
  }
  return parts.length ? `${baseNote} — ${parts.join("; ")}` : baseNote;
}

/**
 * Record that a patient died in care — a terminal outcome reachable at any
 * stage (not only at the consultation disposition). Logs a respectful,
 * timestamped audit note (with an optional cause/circumstances), then moves the
 * visit to the `deceased` terminal stage. Unlike a discharge this is never
 * blocked by pending clearances; `updateVisitStage` frees the bed and closes
 * the admission. Returns the closed visit.
 */
export function recordDeath(
  visitId: VisitId,
  recordedById?: StaffId | null,
  note?: string | null
): Visit {
  const detail = note?.trim();
  addTreatmentLog(visitId, {
    recorded_by_id: recordedById ?? null,
    notes: detail
      ? `Patient deceased — ${detail}`
      : "Patient deceased",
  });

  return updateVisitStage(visitId, "deceased");
}

// ---------------------------------------------------------------------------
// Mutations — orders & results (diagnostics loop, Phase 9)
// ---------------------------------------------------------------------------

/**
 * Order a diagnostic test (lab / imaging / procedure) against a visit. New
 * orders start "requested" and surface in the diagnostics queue. Ordering a
 * test nudges a still-in-consultation visit into the "diagnostics" stage so the
 * board reflects that a workup is pending. Returns the created order.
 */
export function addOrder(visitId: VisitId, input: AddOrderInput): Order {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addOrder: visit "${visitId}" not found`);
  }
  const description = input.description.trim();
  if (!description) {
    throw new Error("addOrder: an order description is required");
  }

  const timestamp = nowISO();
  const order: Order = {
    id: generateId() as OrderId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    ordered_by_id: input.ordered_by_id ?? visit.attending_doctor_id ?? null,
    order_type: input.order_type,
    description,
    status: "requested",
    created_at: timestamp,
    completed_at: null,
    updated_at: timestamp,
  };

  db.orders.push(order);

  // A pending workup belongs in diagnostics — advance from consultation only.
  if (visit.stage === "consultation") {
    visit.stage = "diagnostics";
  }
  visit.updated_at = timestamp;

  // Route to whoever fulfils the order: lab/imaging → lab techs; a bedside
  // procedure → the nursing team. Actor (ordering clinician) excluded.
  const orderPatient = db.patients.find((p) => p.id === visit.patient_id);
  const orderRecipients =
    order.order_type === "procedure"
      ? nurseIdsForVisit(db, visit)
      : staffIdsByRole(db, ["lab_tech"]);
  queueNotifications(db, orderRecipients, {
    type: "order.created",
    actorId: order.ordered_by_id,
    title: `New ${order.order_type} order: ${order.description}`,
    body: patientDisplayName(orderPatient),
    entityType: "visit",
    entityId: visitId,
    patientId: visit.patient_id,
    patientName: patientDisplayName(orderPatient),
    link: "/diagnostics",
    data: { order_type: order.order_type, description: order.description },
  });

  persist(db);
  emitUsage("record_created", { kind: "order", order_type: order.order_type });
  return order;
}

/**
 * Move an order along its lifecycle. Setting it "completed" stamps
 * `completed_at`; any other status clears it. Used by the lab tech to "start"
 * (in_progress) or cancel an order. Returns the updated order.
 */
export function updateOrderStatus(
  orderId: OrderId,
  status: OrderStatus
): Order {
  const db = loadDatabase();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error(`updateOrderStatus: order "${orderId}" not found`);
  }

  const timestamp = nowISO();
  order.status = status;
  order.completed_at = status === "completed" ? timestamp : null;
  order.updated_at = timestamp;

  persist(db);
  return order;
}

export interface UpdateOrderInput {
  order_type?: OrderType;
  description?: string;
}

/**
 * Edit an order's content in place — the doctor adjusting the test or its type
 * after instant-adding it to the list. Empty descriptions are rejected so a row
 * never loses its label. Returns the updated order.
 */
export function updateOrder(orderId: OrderId, input: UpdateOrderInput): Order {
  const db = loadDatabase();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error(`updateOrder: order "${orderId}" not found`);
  }

  if (input.order_type !== undefined) order.order_type = input.order_type;
  if (input.description !== undefined) {
    const description = input.description.trim();
    if (!description) {
      throw new Error("updateOrder: an order description is required");
    }
    order.description = description;
  }
  order.updated_at = nowISO();

  persist(db);
  return order;
}

/**
 * Delete an order outright (entered in error / instant-add undone). Cascades to
 * its recorded results so no orphaned result rows survive (order-rx-delete
 * spec). Idempotent — deleting a missing order is a no-op.
 */
export function deleteOrder(orderId: OrderId): void {
  const db = loadDatabase();
  if (!db.orders.some((o) => o.id === orderId)) return;
  db.orders = db.orders.filter((o) => o.id !== orderId);
  db.results = db.results.filter((r) => r.order_id !== orderId);
  persist(db);
}

/**
 * Record a result against an order — the lab tech closing the loop. The parent
 * order is marked "completed" (with `completed_at`) so it leaves the queue and
 * the result surfaces back on the visit for doctor review. Returns the result.
 */
export function addResult(orderId: OrderId, input: AddResultInput): Result {
  ResultEntrySchema.parse(input); // caps on value/summary/reference range
  const db = loadDatabase();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error(`addResult: order "${orderId}" not found`);
  }

  const timestamp = nowISO();
  const result: Result = {
    id: generateId() as ResultId,
    hospital_id: order.hospital_id,
    order_id: orderId,
    recorded_by_id: input.recorded_by_id ?? null,
    summary: input.summary?.trim() || null,
    value: input.value?.trim() || null,
    reference_range: input.reference_range?.trim() || null,
    is_abnormal: input.is_abnormal ?? false,
    attachment_path: input.attachment_path?.trim() || null,
    recorded_at: timestamp,
  };

  db.results.push(result);

  // Closing the loop: the order is now complete.
  order.status = "completed";
  order.completed_at = timestamp;
  order.updated_at = timestamp;

  // Result is back → notify the clinician who ordered it and the attending
  // doctor (they may differ). Abnormal results carry a flag for emphasis.
  const resultVisit = db.visits.find((v) => v.id === order.visit_id);
  const resultPatient = resultVisit
    ? db.patients.find((p) => p.id === resultVisit.patient_id)
    : undefined;
  queueNotifications(
    db,
    [order.ordered_by_id, resultVisit?.attending_doctor_id],
    {
      type: "result.recorded",
      actorId: result.recorded_by_id,
      title: `${result.is_abnormal ? "Abnormal result" : "Result ready"}: ${order.description}`,
      body: result.value ?? result.summary,
      entityType: "visit",
      entityId: order.visit_id,
      patientId: resultVisit?.patient_id ?? null,
      patientName: patientDisplayName(resultPatient),
      link: "/diagnostics",
      data: { is_abnormal: result.is_abnormal, description: order.description },
    },
  );

  persist(db);
  emitUsage("record_created", { kind: "result" });
  return result;
}
