/**
 * Phase 20 — proves the doctor↔nurse care-collaboration writes round-trip through
 * the Supabase sync layer WITHOUT any per-field plumbing, because the layer is
 * generic: `diffDatabases` emits a full-row insert/update/delete per changed row
 * across every table, and `pushChangeToServer` upserts the whole row (only
 * `version` is stripped). This test asserts the *client→server contract* — the
 * exact outbox changes the drain will upload — plus the hydrate (read) mapping.
 *
 * The live end-to-end against Postgres is covered structurally by the existing
 * `*.integration.test.ts` suites (same generic upsert path); here we stay pure so
 * it runs in plain `npm test`.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  acknowledgeCarePlanEntry,
  addCarePlanEntry,
  addCarePlanItem,
  getCarePlanItemsForAdmission,
  replaceDatabaseFromTables,
  resetDatabase,
  resolveCarePlanItem,
  setActiveHospitalId,
} from "@/services/mockStorage";
import { readOutbox, type OutboxChange } from "@/services/syncQueue";
import type { AdmissionId, HospitalId, StaffId } from "@careflow/shared";

/** Test sugar: brand a seeded string id at a typed call boundary. */
const brand = <T extends string>(v: string): T => v as T;


// A seeded inpatient admission + staff in the demo tenant.
const ADM = "adm_idris";
const DR = "staff_chen";
const NURSE = "staff_patel";

const items = () => readOutbox().filter((c) => c.table === "care_plan_items");
const entries = () => readOutbox().filter((c) => c.table === "care_plan_entries");
const payload = (c: OutboxChange) => c.payload as Record<string, unknown>;

beforeAll(() => {
  const store = new Map<string, string>();
  // @ts-expect-error minimal localStorage shim for the node test env
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  };
});

beforeEach(() => {
  resetDatabase();
  setActiveHospitalId(brand<HospitalId>("hosp_demo"));
});

describe("care-collaboration writes are captured for Supabase sync", () => {
  it("queues a doctor instruction as an insert carrying the new columns", () => {
    addCarePlanItem(brand<AdmissionId>(ADM), {
      kind: "instruction",
      authored_role: "doctor",
      description: "Encourage oral fluids",
      created_by_id: brand<StaffId>(DR),
    });
    const change = items().find((c) => payload(c).kind === "instruction");
    expect(change?.op).toBe("insert");
    expect(payload(change!).authored_role).toBe("doctor");
    expect(payload(change!).kind).toBe("instruction");
  });

  it("queues a monitoring order with its vitals anchor + cadence", () => {
    addCarePlanItem(brand<AdmissionId>(ADM), {
      kind: "monitoring",
      authored_role: "doctor",
      monitors: "vitals",
      frequency: "every 1 hour",
      description: "Vitals + GCS",
      created_by_id: brand<StaffId>(DR),
    });
    const change = items().find((c) => payload(c).kind === "monitoring");
    expect(change?.op).toBe("insert");
    expect(payload(change!).monitors).toBe("vitals");
    expect(payload(change!).frequency).toBe("every 1 hour");
  });

  it("queues a nurse→doctor flag as an insert with needs_doctor", () => {
    addCarePlanEntry(brand<AdmissionId>(ADM), {
      note: "Wound edge looks red — please review.",
      needs_doctor: true,
      recorded_by_id: brand<StaffId>(NURSE),
    });
    const change = entries().find((c) => payload(c).needs_doctor === true);
    expect(change?.op).toBe("insert");
    expect(payload(change!).acknowledged_at).toBeNull();
  });

  it("captures the doctor acknowledgement as an UPDATE on the append-only entries table", () => {
    const entry = addCarePlanEntry(brand<AdmissionId>(ADM), {
      note: "?DVT — new calf pain",
      needs_doctor: true,
      recorded_by_id: brand<StaffId>(NURSE),
    });
    acknowledgeCarePlanEntry(entry.id, brand<StaffId>(DR));

    // The append-only table still gets a generic row-level UPDATE in the outbox,
    // which pushChangeToServer uploads as a last-write-wins upsert.
    const ack = entries().find(
      (c) => c.op === "update" && c.row_id === entry.id,
    );
    expect(ack).toBeTruthy();
    expect(payload(ack!).acknowledged_by_id).toBe(DR);
    expect(payload(ack!).acknowledged_at).not.toBeNull();
  });

  it("captures marking an order done as a versioned UPDATE", () => {
    const item = addCarePlanItem(brand<AdmissionId>(ADM), {
      kind: "instruction",
      authored_role: "doctor",
      description: "Daily weights",
      created_by_id: brand<StaffId>(DR),
    });
    resolveCarePlanItem(item.id);
    const done = items().find(
      (c) => c.op === "update" && c.row_id === item.id,
    );
    expect(done).toBeTruthy();
    expect(payload(done!).status).toBe("resolved");
  });

  it("hydrates the new columns back from a server snapshot", () => {
    replaceDatabaseFromTables({
      hospitals: [{ id: "hosp_demo", name: "Demo" }],
      care_plan_items: [
        {
          id: "cpi_srv",
          hospital_id: "hosp_demo",
          admission_id: "adm_srv",
          patient_id: "pat_srv",
          kind: "monitoring",
          authored_role: "doctor",
          category: null,
          description: "Hourly vitals",
          frequency: "every 1 hour",
          monitors: "vitals",
          goal: null,
          status: "active",
          created_by_id: DR,
          created_at: "2026-06-29T00:00:00.000Z",
          updated_at: "2026-06-29T00:00:00.000Z",
        },
      ],
    });
    const got = getCarePlanItemsForAdmission(brand<AdmissionId>("adm_srv"));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("monitoring");
    expect(got[0].monitors).toBe("vitals");
  });
});
