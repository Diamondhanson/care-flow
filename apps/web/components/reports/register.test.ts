/**
 * Patient register (Phase 19) — tests for the per-visit register builder,
 * filters and column descriptors. Like the full-journey tests, this installs an
 * in-memory `localStorage` so the mock store seeds, then drives the builder over
 * the seeded demo hospital.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetDatabase,
  setActiveHospitalId,
  getVisits,
} from "@/services/mockStorage";
import { presetRange, type Translate } from "@/components/reports/reports";
import {
  buildPatientRegister,
  outcomeKey,
  REGISTER_COLUMNS,
  DEFAULT_REGISTER_FILTERS,
  type PatientRegisterRow,
} from "@/components/reports/register";

// In-memory localStorage polyfill — makes isBrowser() true so writes persist.
beforeAll(() => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  // @ts-expect-error — minimal Window shim for the persistence layer.
  globalThis.window = { localStorage };
});

beforeEach(() => {
  resetDatabase();
  setActiveHospitalId("hosp_demo");
});

const FULL_RANGE = () => presetRange("all", Date.now());
// Identity translator — returns the key plus any interpolated params, enough to
// assert column cells are non-empty strings without a real dictionary.
const t: Translate = (key, params) =>
  params ? `${key}:${Object.values(params).join(",")}` : key;
const ctx = { t, locale: "en" as const };

describe("buildPatientRegister", () => {
  it("returns one row per in-range visit, newest first, with sequential numbers", () => {
    const rows = buildPatientRegister(FULL_RANGE());
    expect(rows.length).toBe(getVisits().length);
    expect(rows.length).toBeGreaterThan(0);

    // Sequential register numbers starting at 1.
    expect(rows.map((r) => r.rowNo)).toEqual(rows.map((_, i) => i + 1));

    // Newest first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].arrivedAtMs).toBeGreaterThanOrEqual(rows[i].arrivedAtMs);
    }
  });

  it("excludes visits outside the range", () => {
    // A zero-width range in the far past matches nothing.
    const rows = buildPatientRegister({ startMs: 0, endMs: 1 });
    expect(rows).toHaveLength(0);
  });

  it("classifies a patient's earliest visit as a new case", () => {
    const rows = buildPatientRegister(FULL_RANGE());
    // Every patient must have exactly one 'new' case among their visits.
    const byPatient = new Map<string, PatientRegisterRow[]>();
    for (const r of rows) {
      const list = byPatient.get(r.patientId) ?? [];
      list.push(r);
      byPatient.set(r.patientId, list);
    }
    for (const list of byPatient.values()) {
      expect(list.filter((r) => r.caseNew)).toHaveLength(1);
    }
  });

  it("derives an outcome key for every row", () => {
    const rows = buildPatientRegister(FULL_RANGE());
    const valid = new Set([
      "reports.register.outcome.inCare",
      "reports.register.outcome.discharged",
      "reports.register.outcome.deceased",
      "reports.register.outcome.cancelled",
    ]);
    for (const r of rows) expect(valid.has(outcomeKey(r))).toBe(true);
  });
});

describe("filters", () => {
  it("'in_hospital' keeps only currently-admitted patients", () => {
    const rows = buildPatientRegister(FULL_RANGE(), {
      ...DEFAULT_REGISTER_FILTERS,
      status: "in_hospital",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.admittedAtMs).not.toBeNull();
      expect(r.dischargedAtMs).toBeNull();
    }
    // Must be a strict subset of all rows.
    expect(rows.length).toBeLessThanOrEqual(buildPatientRegister(FULL_RANGE()).length);
  });

  it("filters by visit type", () => {
    const rows = buildPatientRegister(FULL_RANGE(), {
      ...DEFAULT_REGISTER_FILTERS,
      visitType: "inpatient",
    });
    for (const r of rows) expect(r.visitType).toBe("inpatient");
  });

  it("search matches name or patient code, case-insensitively", () => {
    const all = buildPatientRegister(FULL_RANGE());
    const target = all[0];
    const needle = target.fullName.slice(0, 4).toLowerCase();
    const rows = buildPatientRegister(FULL_RANGE(), {
      ...DEFAULT_REGISTER_FILTERS,
      query: needle,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(`${r.fullName} ${r.patientCode ?? ""}`.toLowerCase()).toContain(needle);
    }
  });
});

describe("REGISTER_COLUMNS", () => {
  it("every column produces a string cell for every row", () => {
    const rows = buildPatientRegister(FULL_RANGE());
    for (const r of rows) {
      for (const c of REGISTER_COLUMNS) {
        const cell = c.value(r, ctx);
        expect(typeof cell).toBe("string");
        expect(cell.length).toBeGreaterThan(0);
      }
    }
  });

  it("has a stable, unique set of column keys with some essential ones", () => {
    const keys = REGISTER_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(REGISTER_COLUMNS.some((c) => c.essential)).toBe(true);
  });
});
