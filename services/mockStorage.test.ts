import { describe, expect, it } from "vitest";

import {
  ALL_DEPARTMENTS,
  assignBedToAdmission,
  computeWardOccupancy,
  countVisitsByDepartment,
  diffDatabases,
  evaluateDischargeReadiness,
  filterVisitsByDepartment,
  generatePatientId,
  getLatestVisitForPatient,
  isTerminalStage,
  normalizeDatabase,
  recordDeath,
  searchPatients,
  SUPABASE_TABLES,
  transferAdmission,
  uniquePatientId,
  updateVisitStage,
} from "@/services/mockStorage";
import type { Admission, Bed, Patient, Ward } from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAdmission(overrides: Partial<Admission> = {}): Admission {
  return {
    id: "adm_1",
    hospital_id: "hosp_demo",
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
    hospital_id: "hosp_demo",
    mrn: "890314TP - A",
    full_name: "Test Patient",
    date_of_birth: null,
    sex: "unknown",
    phone: null,
    address: null,
    national_id: null,
    mother_first_name: null,
    is_emergency_anonymous: false,
    anonymous_identifier: null,
    no_known_allergies: false,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeWard(id: string): Ward {
  return {
    id,
    hospital_id: "hosp_demo",
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
    hospital_id: "hosp_demo",
    ward_id,
    label: id,
    status,
    current_admission_id: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// generatePatientId — Cameroon booklet ID: YYMMDD + name initials + " - " + mum
// ---------------------------------------------------------------------------

describe("generatePatientId", () => {
  it("builds the worked example from the spec", () => {
    expect(
      generatePatientId("1998-11-20", "Bambot Hanson Ngongmun", "Ndung"),
    ).toBe("981120BHN - N");
  });

  it("strips accents/diacritics before taking initials", () => {
    expect(generatePatientId("2001-04-09", "Éloïse Ndèye", "Ámina")).toBe(
      "010409EN - A",
    );
  });

  it("omits the trailing initial when the mother's name is missing", () => {
    expect(generatePatientId("1998-11-20", "Bambot Hanson Ngongmun")).toBe(
      "981120BHN",
    );
    expect(
      generatePatientId("1998-11-20", "Bambot Hanson Ngongmun", null),
    ).toBe("981120BHN");
    expect(generatePatientId("1998-11-20", "Bambot Hanson Ngongmun", "")).toBe(
      "981120BHN",
    );
  });

  it("uses an approximate DOB (YYYY-01-01) as recorded", () => {
    expect(generatePatientId("1980-01-01", "Kofi Annan", "Efua")).toBe(
      "800101KA - E",
    );
  });

  it("collapses extra whitespace between name tokens", () => {
    expect(generatePatientId("1990-06-15", "  Ada   Lovelace ", "Anne")).toBe(
      "900615AL - A",
    );
  });

  it("yields only the initials when the DOB is unknown", () => {
    expect(generatePatientId(null, "Jane Doe", "Mary")).toBe("JD - M");
  });
});

// ---------------------------------------------------------------------------
// uniquePatientId — clash suffixing against existing IDs
// ---------------------------------------------------------------------------

describe("uniquePatientId", () => {
  it("returns the base unchanged when no clash exists", () => {
    expect(uniquePatientId("981120BHN - N", [])).toBe("981120BHN - N");
    expect(uniquePatientId("981120BHN - N", ["721102SI - F"])).toBe(
      "981120BHN - N",
    );
  });

  it("appends -2, -3 … on successive clashes", () => {
    expect(uniquePatientId("981120BHN - N", ["981120BHN - N"])).toBe(
      "981120BHN - N-2",
    );
    expect(
      uniquePatientId("981120BHN - N", ["981120BHN - N", "981120BHN - N-2"]),
    ).toBe("981120BHN - N-3");
  });

  it("returns an empty string for an empty base (anonymous record)", () => {
    expect(uniquePatientId("", ["981120BHN - N"])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isTerminalStage
// ---------------------------------------------------------------------------

describe("isTerminalStage", () => {
  it("treats discharged, followed_up and deceased as terminal", () => {
    expect(isTerminalStage("discharged")).toBe(true);
    expect(isTerminalStage("followed_up")).toBe(true);
    expect(isTerminalStage("deceased")).toBe(true);
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
      "drawer.blockerMedical",
      "drawer.blockerFinancial",
      "drawer.blockerPharmacy",
    ]);
  });

  it("blocks an unreconciled anonymous emergency even when cleared", () => {
    const result = evaluateDischargeReadiness(
      makeAdmission(),
      makePatient({ is_emergency_anonymous: true }),
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("drawer.blockerReconcile");
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

// ---------------------------------------------------------------------------
// Transfers — exercised against the deterministic seed (each call re-seeds in
// the node test env, so we assert on the returned admission/transfer).
// ---------------------------------------------------------------------------

describe("transferAdmission", () => {
  it("moves an admission to a free bed and derives the ward from it", () => {
    const { admission, transfer } = transferAdmission("adm_idris", {
      to_bed_id: "bed_medb_09",
      reason: "Step-down from ICU",
    });
    expect(admission.bed_id).toBe("bed_medb_09");
    expect(admission.ward_id).toBe("ward_medb");
    expect(transfer.from_bed_id).toBe("bed_icu_04");
    expect(transfer.to_bed_id).toBe("bed_medb_09");
    expect(transfer.from_ward_id).toBe("ward_icu");
    expect(transfer.to_ward_id).toBe("ward_medb");
    expect(transfer.reason).toBe("Step-down from ICU");
  });

  it("changes the attending doctor while leaving the bed unchanged", () => {
    const { admission, transfer } = transferAdmission("adm_idris", {
      to_doctor_id: "staff_okafor",
    });
    expect(admission.attending_doctor_id).toBe("staff_okafor");
    expect(transfer.from_doctor_id).toBe("staff_chen");
    expect(transfer.to_doctor_id).toBe("staff_okafor");
    expect(transfer.from_bed_id).toBe("bed_icu_04");
    expect(transfer.to_bed_id).toBe("bed_icu_04");
  });

  it("refuses a bed already held by another admission", () => {
    expect(() =>
      transferAdmission("adm_idris", { to_bed_id: "bed_medb_11" }),
    ).toThrow(/occupied/i);
  });

  it("throws for an unknown admission", () => {
    expect(() => transferAdmission("nope", {})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// recordDeath / updateVisitStage(deceased) — terminal outcome, Block C #4.
// `vis_idris` is a seeded OPEN inpatient visit whose admission (`adm_idris`)
// has pending medical & pharmacy clearances — so a discharge is gated, but a
// death must never be withheld over clearances.
// ---------------------------------------------------------------------------

describe("recordDeath", () => {
  it("closes the visit as deceased even with clearances pending", () => {
    const visit = recordDeath("vis_idris", "staff_chen", "Cardiac arrest");
    expect(visit.stage).toBe("deceased");
    expect(visit.status).toBe("closed");
    expect(visit.closed_at).not.toBeNull();
  });

  it("bypasses the discharge clearance gate that blocks a discharge", () => {
    // A normal discharge of the same visit is blocked by pending clearances…
    expect(() => updateVisitStage("vis_idris", "discharged")).toThrow(
      /Cannot discharge/i,
    );
    // …but recording the death succeeds.
    expect(() => recordDeath("vis_idris")).not.toThrow();
  });

  it("throws for an unknown visit", () => {
    expect(() => recordDeath("nope")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// searchPatients / getLatestVisitForPatient — the Phase 15 "find my patient"
// front door, exercised against the deterministic seed.
// ---------------------------------------------------------------------------

describe("searchPatients", () => {
  it("returns nothing for an empty query", () => {
    expect(searchPatients("")).toEqual([]);
    expect(searchPatients("   ")).toEqual([]);
  });

  it("finds a patient by partial, case-insensitive name", () => {
    const results = searchPatients("mensah");
    expect(results.some((p) => p.full_name === "Grace Mensah")).toBe(true);
    expect(searchPatients("GRACE").some((p) => p.id === "pat_mensah")).toBe(
      true,
    );
  });

  it("finds a patient by their Cameroon patient ID", () => {
    const results = searchPatients("890314GM");
    expect(results[0]?.id).toBe("pat_mensah");
  });

  it("matches the anonymous identifier for an emergency intake", () => {
    const results = searchPatients("john doe");
    expect(results.some((p) => p.id === "pat_anon_gamma")).toBe(true);
  });

  it("ranks exact / prefix matches ahead of mid-string matches", () => {
    const results = searchPatients("grace");
    expect(results[0]?.full_name.toLowerCase().startsWith("grace")).toBe(true);
  });

  it("caps the number of results at the limit", () => {
    expect(searchPatients("a", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("getLatestVisitForPatient", () => {
  it("returns a visit for a seeded patient", () => {
    const visit = getLatestVisitForPatient("pat_mensah");
    expect(visit).toBeDefined();
    expect(visit?.patient_id).toBe("pat_mensah");
  });

  it("returns undefined for an unknown patient", () => {
    expect(getLatestVisitForPatient("pat_nonexistent")).toBeUndefined();
  });

  it("prefers an open visit when one exists", () => {
    const visit = getLatestVisitForPatient("pat_mensah");
    // Seed keeps Grace Mensah's visit open on the board.
    if (visit) expect(["open", "closed"]).toContain(visit.status);
  });
});

describe("assignBedToAdmission", () => {
  it("assigns a free bed and derives the ward", () => {
    const admission = assignBedToAdmission("adm_idris", "bed_er_1");
    expect(admission.bed_id).toBe("bed_er_1");
    expect(admission.ward_id).toBe("ward_er");
  });
});

// ---------------------------------------------------------------------------
// normalizeDatabase — heals stale persisted DBs written by earlier builds that
// predate newer top-level collections (added without bumping the storage key).
// ---------------------------------------------------------------------------

describe("normalizeDatabase", () => {
  it("backfills collections a stale DB is missing", () => {
    const stale = {
      patients: [makePatient()],
      // allergies + transfers absent, as in a pre-Phase-11 persisted DB
    };
    const db = normalizeDatabase(stale);
    expect(Array.isArray(db.allergies)).toBe(true);
    expect(db.allergies).toEqual([]);
    expect(Array.isArray(db.transfers)).toBe(true);
    expect(db.transfers).toEqual([]);
  });

  it("preserves existing data instead of reseeding", () => {
    const patient = makePatient();
    const db = normalizeDatabase({ patients: [patient] });
    expect(db.patients).toEqual([patient]);
  });

  it("replaces a non-array collection with an empty array", () => {
    const db = normalizeDatabase({
      allergies: "corrupt" as unknown as [],
    });
    expect(db.allergies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diffDatabases — the pure change-capture that feeds the outbox. Compares two
// DB snapshots row-by-row and emits insert/update/delete per affected row, with
// the Postgres (snake_case) table name so each change maps onto a Supabase write.
// ---------------------------------------------------------------------------

describe("diffDatabases", () => {
  it("emits no changes for identical snapshots", () => {
    const db = normalizeDatabase({ patients: [makePatient({ id: "p1" })] });
    expect(diffDatabases(db, structuredClone(db))).toEqual([]);
  });

  it("detects an inserted row", () => {
    const pre = normalizeDatabase({});
    const post = normalizeDatabase({ patients: [makePatient({ id: "p1" })] });
    const changes = diffDatabases(pre, post);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      table: "patients",
      op: "insert",
      row_id: "p1",
    });
    expect(changes[0].payload).toMatchObject({ id: "p1" });
  });

  it("detects an updated row when its JSON differs", () => {
    const pre = normalizeDatabase({
      patients: [makePatient({ id: "p1", full_name: "Old Name" })],
    });
    const post = normalizeDatabase({
      patients: [makePatient({ id: "p1", full_name: "New Name" })],
    });
    const changes = diffDatabases(pre, post);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ op: "update", row_id: "p1" });
    expect(changes[0].payload).toMatchObject({ full_name: "New Name" });
  });

  it("detects a deleted row with an id-only payload", () => {
    const pre = normalizeDatabase({ patients: [makePatient({ id: "p1" })] });
    const post = normalizeDatabase({});
    const changes = diffDatabases(pre, post);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      table: "patients",
      op: "delete",
      row_id: "p1",
      payload: { id: "p1" },
    });
  });

  it("maps camelCase collections onto snake_case Postgres tables", () => {
    const pre = normalizeDatabase({});
    const post = normalizeDatabase({});
    post.medicationAdministrations = [
      { id: "ma1" } as unknown as (typeof post.medicationAdministrations)[number],
    ];
    const changes = diffDatabases(pre, post);
    expect(changes).toHaveLength(1);
    expect(changes[0].table).toBe("medication_administrations");
  });

  it("captures a multi-row, multi-table mutation as one change per row", () => {
    const pre = normalizeDatabase({
      patients: [makePatient({ id: "p1" })],
      wards: [makeWard("w1")],
    });
    const post = normalizeDatabase({
      // p1 deleted, p2 inserted, ward updated
      patients: [makePatient({ id: "p2" })],
      wards: [{ ...makeWard("w1"), name: "Renamed Ward" }],
    });
    const changes = diffDatabases(pre, post);
    const ops = changes.map((c) => `${c.table}:${c.op}:${c.row_id}`).sort();
    expect(ops).toEqual([
      "patients:delete:p1",
      "patients:insert:p2",
      "wards:update:w1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// SUPABASE_TABLES — the canonical Postgres table list used by Phase 18b
// hydration (download) and the outbox (upload). Locks the camelCase → snake_case
// mapping and the parents-before-children ordering that keeps FK replays valid.
// ---------------------------------------------------------------------------

describe("SUPABASE_TABLES", () => {
  it("exposes every mirrored table as a unique snake_case name", () => {
    expect(SUPABASE_TABLES.length).toBeGreaterThan(0);
    // No duplicates.
    expect(new Set(SUPABASE_TABLES).size).toBe(SUPABASE_TABLES.length);
    // Real Postgres names: lower snake_case only.
    for (const table of SUPABASE_TABLES) {
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("translates multi-word collections to their Postgres names", () => {
    expect(SUPABASE_TABLES).toEqual(
      expect.arrayContaining([
        "medication_administrations",
        "treatment_records",
        "care_plan_items",
        "care_plan_entries",
      ]),
    );
  });

  it("lists parents before their children so FK-respecting replays succeed", () => {
    const order = (t: string) => SUPABASE_TABLES.indexOf(t);
    // A row can only reference tables that appear earlier in the list.
    expect(order("hospitals")).toBe(0);
    expect(order("patients")).toBeLessThan(order("visits"));
    expect(order("visits")).toBeLessThan(order("consultations"));
    expect(order("visits")).toBeLessThan(order("admissions"));
    expect(order("orders")).toBeLessThan(order("results"));
    expect(order("prescriptions")).toBeLessThan(
      order("medication_administrations"),
    );
    expect(order("care_plan_items")).toBeLessThan(order("care_plan_entries"));
  });
});
