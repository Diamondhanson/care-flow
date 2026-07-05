/**
 * Doctor↔nurse collaboration helpers (Phase 20) — pure, storage-agnostic, and
 * directly unit-testable (see collaboration.test.ts).
 *
 * These power the two worklists that make the doctor/nurse loop seamless:
 *
 *  1. The **nurse's "what this patient needs from me now"** list — a union of due
 *     medications (already driven by the MAR engine), due **monitoring orders**
 *     (e.g. "vitals every 1h", scheduled with the *same* engine), and open
 *     **doctor instructions** — sorted overdue-first.
 *  2. The **doctor's "needs you"** signal — unacknowledged nurse→doctor flags plus
 *     a concerning latest-vitals reading.
 *
 * Everything here is a pure function: the caller passes the data in, so there is
 * no storage access and the results are deterministic.
 */

import {
  computeDoseStatus,
  DOSE_STATE_ORDER,
  type DoseState,
  type DoseStatus,
} from "@/components/medications/prescriptions";
import type {
  CarePlanEntry,
  CarePlanItem,
  MedicationAdministration,
  Prescription,
  StaffRole,
  TreatmentRecord,
} from "@careflow/shared";

// ---------------------------------------------------------------------------
// Monitoring orders — reuse the MAR dosing engine
// ---------------------------------------------------------------------------

/**
 * Compute the due/overdue state of a **monitoring** care item (e.g. "vitals every
 * 1 hour") by reusing the exact medication-administration engine. `lastDoneAt` is
 * the ISO time the monitoring was last performed — the latest vitals reading for a
 * `monitors: "vitals"` order, or the latest care-log entry for the item otherwise.
 * A resolved item is `inactive`; an item with no parseable cadence is `prn`.
 */
export function monitoringDoseStatus(
  item: Pick<CarePlanItem, "frequency" | "status" | "created_at">,
  lastDoneAt: string | null,
  now: number = Date.now(),
): DoseStatus {
  return computeDoseStatus(
    {
      frequency: item.frequency,
      status: item.status === "active" ? "active" : "completed",
      created_at: item.created_at,
    },
    lastDoneAt ? [{ status: "given", administered_at: lastDoneAt }] : [],
    now,
  );
}

// ---------------------------------------------------------------------------
// The nurse's per-patient worklist
// ---------------------------------------------------------------------------

export type WorklistKind = "medication" | "monitoring" | "instruction";

export interface WorklistEntry {
  kind: WorklistKind;
  /** Originating row id (prescription id or care_plan_item id). */
  refId: string;
  /** Primary label — drug name / monitoring description / instruction text. */
  label: string;
  /** Secondary detail — dose+route / cadence / null. */
  detail: string | null;
  /** Scheduling state; instructions are always surfaced as `due`. */
  state: DoseState;
  /** When the next action is due, or null (PRN / instruction). */
  dueAt: string | null;
  /** Who raised it, for color-coding "who asked". */
  authoredRole: StaffRole | null;
}

export interface PatientCareInput {
  /** This admission/visit's prescriptions. */
  prescriptions: Prescription[];
  /** Administrations grouped by prescription id. */
  administrationsByRx: Record<string, MedicationAdministration[]>;
  /** This admission's care items (nursing needs, instructions, monitoring). */
  items: CarePlanItem[];
  /** This admission's care-log entries (used to time non-vitals monitoring). */
  entries: CarePlanEntry[];
  /** ISO time of the latest vitals reading, for `monitors: "vitals"` orders. */
  lastVitalsAt: string | null;
  now?: number;
}

/** ISO time of the most recent care-log entry tied to a given item, or null. */
function lastEntryAtForItem(entries: CarePlanEntry[], itemId: string): string | null {
  return (
    entries
      .filter((e) => e.care_plan_item_id === itemId)
      .map((e) => e.recorded_at)
      .sort((a, b) => b.localeCompare(a))[0] ?? null
  );
}

/**
 * Build a patient's "needs me now" worklist: due/overdue medications, due/overdue
 * monitoring orders, and open doctor instructions — sorted overdue-first. PRN,
 * upcoming and inactive items are intentionally excluded (nothing is owed yet).
 */
export function buildPatientWorklist(input: PatientCareInput): WorklistEntry[] {
  const now = input.now ?? Date.now();
  const out: WorklistEntry[] = [];

  // Due / overdue medications (reuse the MAR engine).
  for (const rx of input.prescriptions) {
    if (rx.status !== "active") continue;
    const status = computeDoseStatus(rx, input.administrationsByRx[rx.id] ?? [], now);
    if (status.state === "due" || status.state === "overdue") {
      out.push({
        kind: "medication",
        refId: rx.id,
        label: rx.drug_name,
        detail: [rx.dose, rx.route, rx.frequency].filter(Boolean).join(" · ") || null,
        state: status.state,
        dueAt: status.nextDueAt,
        authoredRole: "doctor",
      });
    }
  }

  // Due / overdue monitoring orders + open instructions.
  for (const item of input.items) {
    if (item.status !== "active") continue;

    if (item.kind === "monitoring") {
      const lastDone =
        item.monitors === "vitals"
          ? input.lastVitalsAt
          : lastEntryAtForItem(input.entries, item.id);
      const status = monitoringDoseStatus(item, lastDone, now);
      if (status.state === "due" || status.state === "overdue") {
        out.push({
          kind: "monitoring",
          refId: item.id,
          label: item.description,
          detail: item.frequency,
          state: status.state,
          dueAt: status.nextDueAt,
          authoredRole: item.authored_role,
        });
      }
    } else if (item.kind === "instruction") {
      // Open instructions have no schedule — they are "to do" until resolved.
      out.push({
        kind: "instruction",
        refId: item.id,
        label: item.description,
        detail: item.frequency,
        state: "due",
        dueAt: null,
        authoredRole: item.authored_role,
      });
    }
  }

  // Overdue first, then due; within a state, earliest due-time first (instructions,
  // which have no due-time, sort to the end of their group).
  return out.sort((a, b) => {
    const byState = DOSE_STATE_ORDER[a.state] - DOSE_STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
}

/** Count of items the nurse currently owes this patient (drives the "n due" badge). */
export function countDue(input: PatientCareInput): number {
  return buildPatientWorklist(input).length;
}

// ---------------------------------------------------------------------------
// The doctor's "needs you" signal
// ---------------------------------------------------------------------------

/** Open nurse→doctor flags: raised but not yet acknowledged by a doctor. */
export function openDoctorFlags(entries: CarePlanEntry[]): CarePlanEntry[] {
  return entries.filter((e) => e.needs_doctor && !e.acknowledged_at);
}

/**
 * Whether a vitals reading is concerning enough to warrant a doctor's eyes.
 * Deliberately a simple, legible "worth a look" rule — not a clinical alarm —
 * mirroring the app's "visible warning, not auto-blocking" philosophy.
 */
export function vitalsConcern(r: TreatmentRecord): boolean {
  return (
    (r.spo2 != null && r.spo2 < 92) ||
    (r.pulse != null && (r.pulse > 120 || r.pulse < 50)) ||
    (r.bp_systolic != null && (r.bp_systolic < 90 || r.bp_systolic > 180)) ||
    (r.temperature_c != null && (r.temperature_c > 38.5 || r.temperature_c < 35)) ||
    (r.gcs_score != null && r.gcs_score < 13)
  );
}

/**
 * Count of things needing the doctor's attention for a patient: open nurse flags
 * plus a concerning latest-vitals reading (counted once). Drives the doctor's
 * "n needs you" badge.
 */
export function doctorNeedsYouCount(
  entries: CarePlanEntry[],
  latestVitals: TreatmentRecord | null,
): number {
  return (
    openDoctorFlags(entries).length +
    (latestVitals && vitalsConcern(latestVitals) ? 1 : 0)
  );
}
