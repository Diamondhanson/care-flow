import { describe, expect, it } from "vitest";

import {
  abnormalRate,
  ageDistribution,
  ageOf,
  allergyPrevalence,
  bedStatusMix,
  buildReport,
  chartColor,
  CHART_COLORS,
  clearanceBottlenecks,
  computeKpis,
  departmentThroughput,
  lengthOfStay,
  medsByStatus,
  ordersByType,
  presetRange,
  stageDistribution,
  staffWorkload,
  topAllergens,
  topDiagnoses,
  topDrugs,
  visitsOverTime,
  visitTypeMix,
  wardOccupancy,
  type DateRange,
} from "@/components/reports/reports";
import type {
  Admission,
  Allergy,
  Bed,
  Department,
  Diagnosis,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  Staff,
  Visit,
  Ward,
} from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
// A fixed "now" aligned to midnight UTC keeps the day-bucket math deterministic.
const NOW = Date.UTC(2026, 4, 31, 12, 0, 0); // 2026-05-31T12:00:00Z

function daysAgoIso(days: number, hour = 9): string {
  return new Date(Date.UTC(2026, 4, 31, hour) - days * DAY_MS).toISOString();
}

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "vis_1",
    patient_id: "pat_1",
    visit_type: "outpatient",
    status: "closed",
    stage: "discharged",
    department_id: "dept_a",
    attending_doctor_id: "staff_1",
    registered_by_id: null,
    chief_complaint: null,
    triage_notes: null,
    arrived_at: daysAgoIso(1),
    closed_at: null,
    created_at: daysAgoIso(1),
    updated_at: daysAgoIso(1),
    ...overrides,
  };
}

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "pat_1",
    mrn: "CF-2026-000001",
    full_name: "Test Patient",
    date_of_birth: null,
    sex: "unknown",
    phone: null,
    address: null,
    national_id: null,
    is_emergency_anonymous: false,
    anonymous_identifier: null,
    no_known_allergies: false,
    created_at: daysAgoIso(1),
    updated_at: daysAgoIso(1),
    ...overrides,
  };
}

function makeAdmission(overrides: Partial<Admission> = {}): Admission {
  return {
    id: "adm_1",
    visit_id: "vis_1",
    patient_id: "pat_1",
    attending_doctor_id: "staff_1",
    ward_id: "ward_a",
    bed_id: "bed_1",
    status: "discharged",
    stage: "discharged",
    reason: null,
    is_medical_cleared: true,
    is_financial_cleared: true,
    is_pharmacy_ready: true,
    admitted_at: daysAgoIso(5),
    discharged_at: daysAgoIso(2),
    updated_at: daysAgoIso(2),
    ...overrides,
  };
}

function makeBed(id: string, ward_id: string, status: Bed["status"]): Bed {
  return {
    id,
    ward_id,
    label: id,
    status,
    current_admission_id: null,
    created_at: daysAgoIso(60),
    updated_at: daysAgoIso(60),
  };
}

function makeWard(id: string, name = id): Ward {
  return {
    id,
    department_id: null,
    name,
    floor_label: null,
    is_active: true,
    created_at: daysAgoIso(60),
    updated_at: daysAgoIso(60),
  };
}

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: "dx_1",
    visit_id: "vis_1",
    consultation_id: null,
    diagnosed_by_id: null,
    icd10_code: "B54",
    description: "Malaria",
    is_primary: true,
    created_at: daysAgoIso(1),
    ...overrides,
  };
}

// The range covering the whole fixture window.
const RANGE: DateRange = { startMs: 0, endMs: Date.UTC(2026, 4, 31, 23, 59, 59) };

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

describe("chartColor", () => {
  it("cycles through the 8-hue palette", () => {
    expect(chartColor(0)).toBe(CHART_COLORS[0]);
    expect(chartColor(7)).toBe(CHART_COLORS[7]);
    expect(chartColor(8)).toBe(CHART_COLORS[0]);
    expect(chartColor(9)).toBe(CHART_COLORS[1]);
  });
});

// ---------------------------------------------------------------------------
// presetRange
// ---------------------------------------------------------------------------

describe("presetRange", () => {
  it("spans exactly N days ending at end-of-day of now", () => {
    const r = presetRange("7d", NOW);
    expect(r.endMs - r.startMs + 1).toBe(7 * DAY_MS);
    // end-of-day is the last ms of NOW's UTC day
    expect(r.endMs).toBe(Math.floor(NOW / DAY_MS) * DAY_MS + DAY_MS - 1);
  });

  it("30d and 90d widen the window accordingly", () => {
    expect(presetRange("30d", NOW).endMs - presetRange("30d", NOW).startMs + 1).toBe(
      30 * DAY_MS,
    );
    expect(presetRange("90d", NOW).endMs - presetRange("90d", NOW).startMs + 1).toBe(
      90 * DAY_MS,
    );
  });

  it("all-time starts at the epoch", () => {
    expect(presetRange("all", NOW).startMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// inRange (exercised via visitTypeMix)
// ---------------------------------------------------------------------------

describe("range filtering", () => {
  it("excludes visits outside the window", () => {
    const visits = [
      makeVisit({ id: "in", arrived_at: daysAgoIso(2) }),
      makeVisit({ id: "out", arrived_at: daysAgoIso(40) }),
    ];
    const last7 = presetRange("7d", NOW);
    const mix = visitTypeMix(visits, last7);
    const outpatient = mix.find((s) => s.key === "outpatient")!;
    expect(outpatient.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeKpis
// ---------------------------------------------------------------------------

describe("computeKpis", () => {
  it("tallies visits by type, unique patients, and bed occupancy", () => {
    const visits = [
      makeVisit({ id: "v1", patient_id: "p1", visit_type: "outpatient" }),
      makeVisit({ id: "v2", patient_id: "p1", visit_type: "inpatient" }),
      makeVisit({ id: "v3", patient_id: "p2", visit_type: "emergency" }),
    ];
    const beds = [
      makeBed("b1", "ward_a", "occupied"),
      makeBed("b2", "ward_a", "reserved"),
      makeBed("b3", "ward_a", "free"),
      makeBed("b4", "ward_a", "free"),
    ];
    const admissions = [makeAdmission({ status: "active" })];
    const kpis = computeKpis(visits, admissions, beds, RANGE);

    expect(kpis.totalVisits).toBe(3);
    expect(kpis.uniquePatients).toBe(2);
    expect(kpis.outpatient).toBe(1);
    expect(kpis.inpatient).toBe(1);
    expect(kpis.emergency).toBe(1);
    expect(kpis.currentInpatients).toBe(1);
    expect(kpis.bedOccupancyPct).toBe(50); // 2 of 4
  });

  it("reports 0% occupancy when there are no beds", () => {
    const kpis = computeKpis([], [], [], RANGE);
    expect(kpis.bedOccupancyPct).toBe(0);
    expect(kpis.avgLosDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// visitsOverTime
// ---------------------------------------------------------------------------

describe("visitsOverTime", () => {
  it("produces continuous daily buckets and lands visits in the right day", () => {
    const range = presetRange("7d", NOW);
    const visits = [
      makeVisit({ id: "a", arrived_at: daysAgoIso(1), visit_type: "outpatient" }),
      makeVisit({ id: "b", arrived_at: daysAgoIso(1), visit_type: "emergency" }),
      makeVisit({ id: "c", arrived_at: daysAgoIso(3), visit_type: "inpatient" }),
    ];
    const buckets = visitsOverTime(visits, range);
    // 7-day window → 7 daily buckets, none dropped
    expect(buckets).toHaveLength(7);
    const total = buckets.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(3);
    const dayMinus1 = buckets.find((b) => b.key === new Date(
      Math.floor((Date.UTC(2026, 4, 31, 9) - 1 * DAY_MS) / DAY_MS) * DAY_MS,
    ).toISOString().slice(0, 10))!;
    expect(dayMinus1.outpatient).toBe(1);
    expect(dayMinus1.emergency).toBe(1);
    expect(dayMinus1.total).toBe(2);
  });

  it("switches to weekly buckets for spans beyond ~6 weeks", () => {
    const range = presetRange("90d", NOW);
    const visits = [makeVisit({ arrived_at: daysAgoIso(10) })];
    const buckets = visitsOverTime(visits, range);
    // 90 days / 7 ≈ 13-14 weekly buckets, far fewer than 90 daily
    expect(buckets.length).toBeLessThan(20);
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// visitTypeMix / departmentThroughput
// ---------------------------------------------------------------------------

describe("visitTypeMix", () => {
  it("returns all three types in fixed order", () => {
    const mix = visitTypeMix([makeVisit({ visit_type: "emergency" })], RANGE);
    expect(mix.map((s) => s.key)).toEqual(["outpatient", "inpatient", "emergency"]);
    expect(mix.find((s) => s.key === "emergency")!.value).toBe(1);
  });
});

describe("departmentThroughput", () => {
  it("resolves names, buckets unassigned, and sorts descending", () => {
    const departments: Department[] = [
      { id: "dept_a", name: "Cardiology", code: null, description: null, is_active: true, created_at: "", updated_at: "" },
      { id: "dept_b", name: "Surgery", code: null, description: null, is_active: true, created_at: "", updated_at: "" },
    ];
    const visits = [
      makeVisit({ id: "1", department_id: "dept_a" }),
      makeVisit({ id: "2", department_id: "dept_a" }),
      makeVisit({ id: "3", department_id: "dept_b" }),
      makeVisit({ id: "4", department_id: null }),
    ];
    const rows = departmentThroughput(visits, departments, RANGE);
    expect(rows[0]).toMatchObject({ label: "Cardiology", value: 2 });
    expect(rows.find((r) => r.key === "__none__")!.label).toBe("Unassigned");
  });
});

// ---------------------------------------------------------------------------
// topDiagnoses
// ---------------------------------------------------------------------------

describe("topDiagnoses", () => {
  it("groups by description, ranks by frequency, and labels with code", () => {
    const dx = [
      makeDiagnosis({ id: "1", icd10_code: "B54", description: "Malaria" }),
      makeDiagnosis({ id: "2", icd10_code: "B54", description: "Malaria" }),
      makeDiagnosis({ id: "3", icd10_code: "I10", description: "Hypertension" }),
    ];
    const top = topDiagnoses(dx, RANGE);
    expect(top[0]).toMatchObject({ value: 2, label: "B54 · Malaria" });
    expect(top[1]).toMatchObject({ value: 1, label: "I10 · Hypertension" });
  });

  it("honors the limit", () => {
    const dx = Array.from({ length: 12 }, (_, i) =>
      makeDiagnosis({ id: `d${i}`, icd10_code: `C${i}`, description: `Cond ${i}` }),
    );
    expect(topDiagnoses(dx, RANGE, 5)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// lengthOfStay
// ---------------------------------------------------------------------------

describe("lengthOfStay", () => {
  it("buckets stays and computes avg/median", () => {
    const admissions = [
      makeAdmission({ id: "a", admitted_at: daysAgoIso(5), discharged_at: daysAgoIso(3) }), // 2d
      makeAdmission({ id: "b", admitted_at: daysAgoIso(10), discharged_at: daysAgoIso(6) }), // 4d
      makeAdmission({ id: "c", admitted_at: daysAgoIso(20), discharged_at: daysAgoIso(5) }), // 15d
    ];
    const los = lengthOfStay(admissions, RANGE);
    expect(los.count).toBe(3);
    expect(los.avgDays).toBe(7);
    expect(los.medianDays).toBe(4);
    expect(los.buckets.find((b) => b.key === "1-2")!.value).toBe(1);
    expect(los.buckets.find((b) => b.key === "3-4")!.value).toBe(1);
    expect(los.buckets.find((b) => b.key === "15+")!.value).toBe(1);
  });

  it("ignores admissions still in-house (no discharge)", () => {
    const los = lengthOfStay([makeAdmission({ discharged_at: null })], RANGE);
    expect(los.count).toBe(0);
    expect(los.avgDays).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Occupancy / bed status / stage distribution
// ---------------------------------------------------------------------------

describe("wardOccupancy", () => {
  it("counts occupied + reserved against the ward total", () => {
    const wards = [makeWard("ward_a", "ICU")];
    const beds = [
      makeBed("b1", "ward_a", "occupied"),
      makeBed("b2", "ward_a", "reserved"),
      makeBed("b3", "ward_a", "free"),
    ];
    const [row] = wardOccupancy(wards, beds);
    expect(row).toMatchObject({ ward: "ICU", total: 3, occupied: 2, free: 1, pct: 67 });
  });
});

describe("bedStatusMix", () => {
  it("drops zero-count statuses", () => {
    const beds = [makeBed("b1", "w", "free"), makeBed("b2", "w", "occupied")];
    const mix = bedStatusMix(beds);
    expect(mix.map((s) => s.key).sort()).toEqual(["free", "occupied"]);
  });
});

describe("stageDistribution", () => {
  it("counts only open visits, in board order", () => {
    const visits = [
      makeVisit({ id: "1", status: "open", stage: "triage" }),
      makeVisit({ id: "2", status: "open", stage: "treatment" }),
      makeVisit({ id: "3", status: "open", stage: "triage" }),
      makeVisit({ id: "4", status: "closed", stage: "discharged" }),
    ];
    const dist = stageDistribution(visits);
    expect(dist.find((s) => s.key === "triage")!.value).toBe(2);
    expect(dist.find((s) => s.key === "treatment")!.value).toBe(1);
    expect(dist.some((s) => s.key === "discharged")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Meds & diagnostics
// ---------------------------------------------------------------------------

describe("medsByStatus", () => {
  it("counts MAR rows by status within the range", () => {
    const mar: MedicationAdministration[] = [
      { id: "1", prescription_id: "rx", administered_by_id: null, scheduled_for: null, administered_at: daysAgoIso(1), status: "given", notes: null, created_at: daysAgoIso(1) },
      { id: "2", prescription_id: "rx", administered_by_id: null, scheduled_for: null, administered_at: daysAgoIso(1), status: "given", notes: null, created_at: daysAgoIso(1) },
      { id: "3", prescription_id: "rx", administered_by_id: null, scheduled_for: null, administered_at: daysAgoIso(1), status: "held", notes: null, created_at: daysAgoIso(1) },
    ];
    const mix = medsByStatus(mar, RANGE);
    expect(mix.find((s) => s.key === "given")!.value).toBe(2);
    expect(mix.find((s) => s.key === "held")!.value).toBe(1);
  });
});

describe("topDrugs", () => {
  it("ranks prescriptions by drug name", () => {
    const rx = (id: string, drug_name: string): Prescription => ({
      id, visit_id: "v", prescribed_by_id: null, drug_name, dose: null, route: null,
      frequency: null, duration: null, instructions: null, status: "active",
      created_at: daysAgoIso(1), updated_at: daysAgoIso(1),
    });
    const top = topDrugs([rx("1", "Artemether"), rx("2", "Artemether"), rx("3", "Paracetamol")], RANGE);
    expect(top[0]).toMatchObject({ label: "Artemether", value: 2 });
  });
});

describe("ordersByType", () => {
  it("counts orders by type", () => {
    const ord = (id: string, order_type: Order["order_type"]): Order => ({
      id, visit_id: "v", ordered_by_id: null, order_type, description: "x",
      status: "completed", created_at: daysAgoIso(1), completed_at: null, updated_at: daysAgoIso(1),
    });
    const mix = ordersByType([ord("1", "lab"), ord("2", "lab"), ord("3", "imaging")], RANGE);
    expect(mix.find((s) => s.key === "lab")!.value).toBe(2);
    expect(mix.find((s) => s.key === "imaging")!.value).toBe(1);
  });
});

describe("abnormalRate", () => {
  it("computes the abnormal percentage", () => {
    const res = (id: string, is_abnormal: boolean): Result => ({
      id, order_id: "o", recorded_by_id: null, summary: null, value: null,
      reference_range: null, is_abnormal, attachment_path: null, recorded_at: daysAgoIso(1),
    });
    const rate = abnormalRate([res("1", true), res("2", false), res("3", false), res("4", false)], RANGE);
    expect(rate).toMatchObject({ abnormal: 1, normal: 3, total: 4, pct: 25 });
  });
});

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

describe("ageOf", () => {
  it("computes whole years from a DOB", () => {
    expect(ageOf("1990-05-31", Date.UTC(2026, 4, 31))).toBe(36);
    expect(ageOf(null, NOW)).toBeNull();
  });
});

describe("ageDistribution", () => {
  it("buckets ages of patients seen in the range", () => {
    const patients = [
      makePatient({ id: "p1", date_of_birth: "2020-01-01" }), // ~6 → 0-12
      makePatient({ id: "p2", date_of_birth: "2000-01-01" }), // ~26 → 19-35
      makePatient({ id: "p3", date_of_birth: "1950-01-01" }), // ~76 → 66+
    ];
    const visits = [
      makeVisit({ id: "v1", patient_id: "p1" }),
      makeVisit({ id: "v2", patient_id: "p2" }),
      makeVisit({ id: "v3", patient_id: "p3" }),
    ];
    const dist = ageDistribution(patients, visits, RANGE, NOW);
    expect(dist.find((b) => b.key === "0-12")!.value).toBe(1);
    expect(dist.find((b) => b.key === "19-35")!.value).toBe(1);
    expect(dist.find((b) => b.key === "66+")!.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Staff workload
// ---------------------------------------------------------------------------

describe("staffWorkload", () => {
  it("counts visits per attending doctor, sorted desc", () => {
    const staff: Staff[] = [
      { id: "staff_1", user_id: null, full_name: "Dr A", role: "doctor", department_id: null, email: null, phone: null, is_active: true, created_at: "", updated_at: "" },
      { id: "staff_2", user_id: null, full_name: "Dr B", role: "doctor", department_id: null, email: null, phone: null, is_active: true, created_at: "", updated_at: "" },
    ];
    const visits = [
      makeVisit({ id: "1", attending_doctor_id: "staff_1" }),
      makeVisit({ id: "2", attending_doctor_id: "staff_1" }),
      makeVisit({ id: "3", attending_doctor_id: "staff_2" }),
      makeVisit({ id: "4", attending_doctor_id: null }),
    ];
    const rows = staffWorkload(visits, staff, RANGE);
    expect(rows[0]).toMatchObject({ label: "Dr A", value: 2 });
    expect(rows[1]).toMatchObject({ label: "Dr B", value: 1 });
  });
});

// ---------------------------------------------------------------------------
// Allergies
// ---------------------------------------------------------------------------

describe("allergyPrevalence", () => {
  it("splits seen patients into documented / confirmed-none / not-assessed", () => {
    const patients = [
      makePatient({ id: "p1", no_known_allergies: false }), // has allergy
      makePatient({ id: "p2", no_known_allergies: true }), // confirmed none
      makePatient({ id: "p3", no_known_allergies: false }), // not assessed
    ];
    const visits = [
      makeVisit({ id: "v1", patient_id: "p1" }),
      makeVisit({ id: "v2", patient_id: "p2" }),
      makeVisit({ id: "v3", patient_id: "p3" }),
    ];
    const allergies: Allergy[] = [
      { id: "a1", patient_id: "p1", substance: "Penicillin", category: "drug", severity: "severe", reaction: null, noted_by_id: null, created_at: "", updated_at: "" },
    ];
    const prev = allergyPrevalence(patients, visits, allergies, RANGE);
    expect(prev.find((s) => s.key === "has")!.value).toBe(1);
    expect(prev.find((s) => s.key === "none")!.value).toBe(1);
    expect(prev.find((s) => s.key === "unassessed")!.value).toBe(1);
  });
});

describe("topAllergens", () => {
  it("ranks substances among seen patients", () => {
    const patients = [makePatient({ id: "p1" }), makePatient({ id: "p2" })];
    const visits = [makeVisit({ id: "v1", patient_id: "p1" }), makeVisit({ id: "v2", patient_id: "p2" })];
    const allergy = (id: string, patient_id: string, substance: string): Allergy => ({
      id, patient_id, substance, category: "drug", severity: "mild", reaction: null, noted_by_id: null, created_at: "", updated_at: "",
    });
    const top = topAllergens(patients, visits, [
      allergy("a1", "p1", "Penicillin"),
      allergy("a2", "p2", "Penicillin"),
      allergy("a3", "p1", "Sulfa"),
    ], RANGE);
    expect(top[0]).toMatchObject({ label: "Penicillin", value: 2 });
  });
});

// ---------------------------------------------------------------------------
// clearanceBottlenecks
// ---------------------------------------------------------------------------

describe("clearanceBottlenecks", () => {
  it("counts active admissions failing each gate", () => {
    const admissions = [
      makeAdmission({ id: "1", status: "active", is_medical_cleared: false, is_financial_cleared: true, is_pharmacy_ready: true }),
      makeAdmission({ id: "2", status: "active", is_medical_cleared: true, is_financial_cleared: false, is_pharmacy_ready: false }),
      makeAdmission({ id: "3", status: "discharged", is_medical_cleared: false, is_financial_cleared: false, is_pharmacy_ready: false }),
    ];
    const gates = clearanceBottlenecks(admissions);
    expect(gates.find((g) => g.key === "medical")!.value).toBe(1);
    expect(gates.find((g) => g.key === "financial")!.value).toBe(1);
    expect(gates.find((g) => g.key === "pharmacy")!.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
  it("assembles every section from one data bundle", () => {
    const report = buildReport(
      {
        visits: [makeVisit()],
        patients: [makePatient()],
        admissions: [makeAdmission()],
        diagnoses: [makeDiagnosis()],
        prescriptions: [],
        mar: [],
        orders: [],
        results: [],
        allergies: [],
        staff: [],
        departments: [],
        wards: [makeWard("ward_a")],
        beds: [makeBed("b1", "ward_a", "free")],
      },
      RANGE,
      NOW,
    );
    expect(report.generatedAtMs).toBe(NOW);
    expect(report.kpis.totalVisits).toBe(1);
    expect(report.topDiagnoses[0]?.label).toBe("B54 · Malaria");
    expect(report.wardOccupancy).toHaveLength(1);
    expect(Array.isArray(report.visitsOverTime)).toBe(true);
  });
});
