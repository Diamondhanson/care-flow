import { describe, expect, it } from "vitest";

import {
  ALL_DEPARTMENTS,
  computeWardOccupancy,
  countVisitsByDepartment,
  evaluateDischargeReadiness,
  filterVisitsByDepartment,
  generateMrn,
  isTerminalStage,
} from "@/services/mockStorage";
import type { Admission, Bed, Patient, Ward } from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAdmission(overrides: Partial<Admission> = {}): Admission {
  return {
    id: "adm_1",
    visit_id: "vis_1",
    patient_id: "pat_1",
    attending_doctor_id: null,
    ward_id: null,
    bed_id: null,
    status: "active",
    stage: "discharge_planning",
    reason: null,
    is_medical_cleared: true,
    is_financial_cleared: true,
    is_pharmacy_ready: true,
    admitted_at: "2026-05-01T00:00:00.000Z",
    discharged_at: null,
    updated_at: "2026-05-01T00:00:00.000Z",
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
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWard(id: string): Ward {
  return {
    id,
    department_id: null,
    name: id,
    floor_label: null,
    is_active: true,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };
}

function makeBed(id: string, ward_id: string, status: Bed["status"]): Bed {
  return {
    id,
    ward_id,
    label: id,
    status,
    current_admission_id: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// generateMrn
// ---------------------------------------------------------------------------

describe("generateMrn", () => {
  it("pads the sequence to six digits with the CF-YYYY- prefix", () => {
    expect(generateMrn(2026, 1)).toBe("CF-2026-000001");
    expect(generateMrn(2026, 123)).toBe("CF-2026-000123");
  });

  it("uses the supplied year", () => {
    expect(generateMrn(2030, 42)).toBe("CF-2030-000042");
  });

  it("does not truncate sequences beyond six digits", () => {
    expect(generateMrn(2026, 1234567)).toBe("CF-2026-1234567");
  });
});

// ---------------------------------------------------------------------------
// isTerminalStage
// ---------------------------------------------------------------------------

describe("isTerminalStage", () => {
  it("treats discharged and followed_up as terminal", () => {
    expect(isTerminalStage("discharged")).toBe(true);
    expect(isTerminalStage("followed_up")).toBe(true);
  });

  it("treats all in-progress stages as non-terminal", () => {
    for (const stage of [
      "registration",
      "triage",
      "consultation",
      "diagnostics",
      "treatment",
      "discharge_planning",
    ] as const) {
      expect(isTerminalStage(stage)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateDischargeReadiness
// ---------------------------------------------------------------------------

describe("evaluateDischargeReadiness", () => {
  it("is ready when all clearances pass and the patient is identified", () => {
    const result = evaluateDischargeReadiness(makeAdmission(), makePatient());
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks on each missing clearance", () => {
    const result = evaluateDischargeReadiness(
      makeAdmission({
        is_medical_cleared: false,
        is_financial_cleared: false,
        is_pharmacy_ready: false,
      }),
      makePatient(),
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "Medical clearance pending",
      "Financial clearance pending",
      "Pharmacy not ready",
    ]);
  });

  it("blocks an unreconciled anonymous emergency even when cleared", () => {
    const result = evaluateDischargeReadiness(
      makeAdmission(),
      makePatient({ is_emergency_anonymous: true }),
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain(
      "Anonymous emergency profile must be reconciled first",
    );
  });
});

// ---------------------------------------------------------------------------
// computeWardOccupancy
// ---------------------------------------------------------------------------

describe("computeWardOccupancy", () => {
  it("counts occupied and reserved beds against the total per ward", () => {
    const wards = [makeWard("ward_a"), makeWard("ward_b")];
    const beds = [
      makeBed("a1", "ward_a", "occupied"),
      makeBed("a2", "ward_a", "reserved"),
      makeBed("a3", "ward_a", "free"),
      makeBed("a4", "ward_a", "cleaning"),
      makeBed("b1", "ward_b", "free"),
    ];

    const occupancy = computeWardOccupancy(wards, beds);

    const a = occupancy.find((o) => o.ward.id === "ward_a")!;
    expect(a.total).toBe(4);
    expect(a.occupied).toBe(2); // occupied + reserved
    expect(a.free).toBe(2);

    const b = occupancy.find((o) => o.ward.id === "ward_b")!;
    expect(b.total).toBe(1);
    expect(b.occupied).toBe(0);
    expect(b.free).toBe(1);
  });

  it("reports zero totals for a ward with no beds", () => {
    const occupancy = computeWardOccupancy([makeWard("empty")], []);
    expect(occupancy[0]).toMatchObject({ total: 0, occupied: 0, free: 0 });
  });
});

// ---------------------------------------------------------------------------
// Department routing helpers
// ---------------------------------------------------------------------------

const VISITS: { id: string; department_id: string | null }[] = [
  { id: "v1", department_id: "dept_a" },
  { id: "v2", department_id: "dept_a" },
  { id: "v3", department_id: "dept_b" },
  { id: "v4", department_id: null },
];

describe("filterVisitsByDepartment", () => {
  it("narrows to a single department", () => {
    expect(filterVisitsByDepartment(VISITS, "dept_a").map((v) => v.id)).toEqual([
      "v1",
      "v2",
    ]);
    expect(filterVisitsByDepartment(VISITS, "dept_b").map((v) => v.id)).toEqual([
      "v3",
    ]);
  });

  it("returns everything for the all-departments sentinel or nullish filter", () => {
    expect(filterVisitsByDepartment(VISITS, ALL_DEPARTMENTS)).toHaveLength(4);
    expect(filterVisitsByDepartment(VISITS, null)).toHaveLength(4);
    expect(filterVisitsByDepartment(VISITS, undefined)).toHaveLength(4);
  });

  it("returns an empty list for a department with no visits", () => {
    expect(filterVisitsByDepartment(VISITS, "dept_unknown")).toEqual([]);
  });
});

describe("countVisitsByDepartment", () => {
  it("tallies visits per department and buckets unrouted under the sentinel", () => {
    const counts = countVisitsByDepartment(VISITS);
    expect(counts).toEqual({
      dept_a: 2,
      dept_b: 1,
      [ALL_DEPARTMENTS]: 1,
    });
  });

  it("returns an empty tally for no visits", () => {
    expect(countVisitsByDepartment([])).toEqual({});
  });
});
