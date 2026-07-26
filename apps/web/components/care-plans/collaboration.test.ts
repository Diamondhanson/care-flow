import { describe, expect, it } from "vitest";

import {
  buildPatientWorklist,
  countDue,
  doctorNeedsYouCount,
  monitoringDoseStatus,
  openDoctorFlags,
  vitalsConcern,
  type PatientCareInput,
} from "@/components/care-plans/collaboration";
import type {
  CarePlanEntry,
  CarePlanItem,
  HospitalId,
  MedicationAdministration,
  MedicationAdministrationId,
  Prescription,
  PrescriptionId,
  StaffId,
  TreatmentRecord,
  Unbranded,
} from "@careflow/shared";

/** Test sugar: brand a seeded string id at a typed call boundary. */
const brand = <T extends string>(v: string): T => v as T;


const NOW = Date.parse("2026-06-29T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function item(p: Partial<Unbranded<CarePlanItem>> = {}): CarePlanItem {
  return {
    id: "cpi_1",
    hospital_id: "h1",
    admission_id: "adm_1",
    patient_id: "pat_1",
    kind: "monitoring",
    authored_role: "doctor",
    category: null,
    description: "Vitals",
    frequency: "every 1 hour",
    monitors: "vitals",
    goal: null,
    status: "active",
    created_by_id: "doc",
    created_at: hoursAgo(24),
    updated_at: hoursAgo(24),
    ...p,
  } as CarePlanItem;
}

function rx(p: Partial<Unbranded<Prescription>> = {}): Prescription {
  return {
    id: "rx_1",
    hospital_id: "h1",
    visit_id: "vis_1",
    prescribed_by_id: "doc",
    drug_name: "Amoxicillin",
    dose: "500 mg",
    route: "oral",
    frequency: "every 8 hours",
    duration: "5 days",
    instructions: null,
    status: "active",
    created_at: hoursAgo(24),
    updated_at: hoursAgo(24),
    ...p,
  } as Prescription;
}

function admin(givenAt: string): MedicationAdministration {
  return {
    id: brand<MedicationAdministrationId>("ma_" + givenAt),
    hospital_id: brand<HospitalId>("h1"),
    prescription_id: brand<PrescriptionId>("rx_1"),
    administered_by_id: brand<StaffId>("nurse"),
    scheduled_for: null,
    administered_at: givenAt,
    status: "given",
    notes: null,
    created_at: givenAt,
  };
}

function vitals(p: Partial<Unbranded<TreatmentRecord>> = {}): TreatmentRecord {
  return {
    id: "trec_1",
    hospital_id: "h1",
    visit_id: "vis_1",
    recorded_by_id: "nurse",
    spo2: 98,
    pulse: 80,
    bp_systolic: 120,
    bp_diastolic: 78,
    temperature_c: 37,
    weight_kg: 70,
    gcs_score: 15,
    notes: null,
    recorded_at: hoursAgo(1),
    ...p,
  } as TreatmentRecord;
}

function entry(p: Partial<Unbranded<CarePlanEntry>> = {}): CarePlanEntry {
  return {
    id: "cpe_1",
    hospital_id: "h1",
    admission_id: "adm_1",
    care_plan_item_id: null,
    note: "note",
    is_handover: false,
    needs_doctor: false,
    acknowledged_by_id: null,
    acknowledged_at: null,
    recorded_by_id: "nurse",
    recorded_at: hoursAgo(2),
    ...p,
  } as CarePlanEntry;
}

const baseInput = (p: Partial<Unbranded<PatientCareInput>> = {}): PatientCareInput => ({
  prescriptions: [],
  administrationsByRx: {},
  items: [],
  entries: [],
  lastVitalsAt: null,
  now: NOW,
  ...p,
});

describe("monitoringDoseStatus", () => {
  it("is overdue when vitals are older than the cadence", () => {
    const s = monitoringDoseStatus(item(), hoursAgo(3), NOW); // q1h, last 3h ago
    expect(s.state).toBe("overdue");
  });

  it("is upcoming right after it was just done", () => {
    const s = monitoringDoseStatus(item(), hoursAgo(0), NOW);
    expect(s.state).toBe("upcoming");
  });

  it("is prn when the cadence cannot be parsed", () => {
    const s = monitoringDoseStatus(item({ frequency: "as needed" }), null, NOW);
    expect(s.state).toBe("prn");
  });

  it("is inactive once resolved", () => {
    const s = monitoringDoseStatus(item({ status: "resolved" }), hoursAgo(5), NOW);
    expect(s.state).toBe("inactive");
  });
});

describe("buildPatientWorklist", () => {
  it("unions due meds, due monitoring and open instructions, overdue-first", () => {
    const input = baseInput({
      prescriptions: [rx()], // q8h, never given, created 24h ago -> overdue
      administrationsByRx: {},
      items: [
        item({ id: "mon", description: "Vitals q1h" }), // overdue (no vitals yet)
        item({ id: "instr", kind: "instruction", description: "Encourage fluids", frequency: "Today", monitors: null }),
        item({ id: "need", kind: "nursing_need", description: "Bed bath", monitors: null }), // excluded
      ],
      lastVitalsAt: null,
    });
    const wl = buildPatientWorklist(input);
    const kinds = wl.map((w) => w.kind).sort();
    expect(kinds).toEqual(["instruction", "medication", "monitoring"]);
    // overdue items come before the instruction (which is surfaced as "due")
    expect(wl[wl.length - 1].kind).toBe("instruction");
    // nursing_need is never on the worklist
    expect(wl.find((w) => w.refId === "need")).toBeUndefined();
  });

  it("excludes monitoring that was done recently", () => {
    const input = baseInput({
      items: [item({ id: "mon" })],
      lastVitalsAt: hoursAgo(0), // just taken -> upcoming, not due
    });
    expect(countDue(input)).toBe(0);
  });

  it("treats a freshly given medication as not yet due", () => {
    const input = baseInput({
      prescriptions: [rx()],
      administrationsByRx: { rx_1: [admin(hoursAgo(0))] },
    });
    expect(countDue(input)).toBe(0);
  });
});

describe("vitalsConcern", () => {
  it("flags low SpO2, brady/tachycardia, hypo/hypertension, fever, low GCS", () => {
    expect(vitalsConcern(vitals({ spo2: 88 }))).toBe(true);
    expect(vitalsConcern(vitals({ pulse: 130 }))).toBe(true);
    expect(vitalsConcern(vitals({ pulse: 44 }))).toBe(true);
    expect(vitalsConcern(vitals({ bp_systolic: 85 }))).toBe(true);
    expect(vitalsConcern(vitals({ temperature_c: 39 }))).toBe(true);
    expect(vitalsConcern(vitals({ gcs_score: 10 }))).toBe(true);
  });

  it("passes a normal reading", () => {
    expect(vitalsConcern(vitals())).toBe(false);
  });
});

describe("doctor attention", () => {
  it("counts only unacknowledged nurse flags", () => {
    const entries = [
      entry({ id: "a", needs_doctor: true }),
      entry({ id: "b", needs_doctor: true, acknowledged_at: hoursAgo(1), acknowledged_by_id: "doc" }),
      entry({ id: "c", needs_doctor: false }),
    ];
    expect(openDoctorFlags(entries).map((e) => e.id)).toEqual(["a"]);
  });

  it("adds one for a concerning latest vitals reading", () => {
    const entries = [entry({ needs_doctor: true })];
    expect(doctorNeedsYouCount(entries, vitals({ spo2: 85 }))).toBe(2);
    expect(doctorNeedsYouCount(entries, vitals())).toBe(1);
    expect(doctorNeedsYouCount([], null)).toBe(0);
  });
});
