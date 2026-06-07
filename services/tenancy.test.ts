import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Browser polyfill
//
// mockStorage's write path only runs when a localStorage exists (`isBrowser`).
// The vitest "node" environment has none, so loadDatabase would return a fresh
// seed on every call and writes would never persist — making cross-tenant
// behaviour untestable. We install a minimal in-memory localStorage + window
// BEFORE importing the module so its browser branch (persist + reload) runs.
// mockStorage only checks `typeof window` at call time, never at import time,
// so installing the globals here is sufficient.
// ---------------------------------------------------------------------------

class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

const memoryStorage = new MemoryStorage();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage: memoryStorage };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = memoryStorage;

import {
  DEMO_HOSPITAL_ID,
  addBedsToWard,
  createDepartment,
  createHospital,
  createNewVisit,
  createStaff,
  createWard,
  getActiveAdmissions,
  getActiveHospitalId,
  getActiveVisits,
  getBeds,
  getCurrentHospital,
  getDepartments,
  getHospitalById,
  getHospitals,
  getOpenOrders,
  getPatients,
  getStaff,
  getVisits,
  getWards,
  resetDatabase,
  setActiveHospitalId,
} from "@/services/mockStorage";

beforeEach(() => {
  memoryStorage.clear();
  setActiveHospitalId(null);
  resetDatabase();
});

describe("hospital account directory (control-plane, cross-tenant)", () => {
  it("seeds exactly the demo hospital", () => {
    const hospitals = getHospitals();
    expect(hospitals).toHaveLength(1);
    expect(hospitals[0].id).toBe(DEMO_HOSPITAL_ID);
  });

  it("resolves the active hospital, defaulting to the demo tenant", () => {
    expect(getCurrentHospital()?.id).toBe(DEMO_HOSPITAL_ID);
  });

  it("registers a new tenant on a trial subscription", () => {
    const created = createHospital({ name: "  Yaoundé Central  " });
    expect(created.name).toBe("Yaoundé Central");
    expect(created.subscription_status).toBe("trial");
    expect(getHospitalById(created.id)).toEqual(created);
    // The directory now sees both tenants — it is deliberately not scoped.
    expect(getHospitals().map((h) => h.id)).toContain(created.id);
    expect(getHospitals().map((h) => h.id)).toContain(DEMO_HOSPITAL_ID);
  });

  it("rejects a blank hospital name", () => {
    expect(() => createHospital({ name: "   " })).toThrow(/name is required/);
  });
});

describe("tenant isolation (read scoping + write stamping)", () => {
  it("stamps every seeded domain row with the demo tenant", () => {
    setActiveHospitalId(DEMO_HOSPITAL_ID);
    const patients = getPatients();
    expect(patients.length).toBeGreaterThan(0);
    expect(patients.every((p) => p.hospital_id === DEMO_HOSPITAL_ID)).toBe(true);
  });

  it("falls back to the demo tenant for SSR / pre-login reads", () => {
    // No active hospital set — reads must still resolve to a real tenant so
    // server-rendered pages and the pre-auth shell render data.
    expect(getActiveHospitalId()).toBeNull();
    expect(getPatients().length).toBeGreaterThan(0);
    expect(getCurrentHospital()?.id).toBe(DEMO_HOSPITAL_ID);
  });

  it("hides one tenant's records from another and back again", () => {
    const seedCount = getPatients().length;
    expect(seedCount).toBeGreaterThan(0);

    // Stand up a second tenant and act as it.
    const other = createHospital({ name: "Bamenda Regional" });
    setActiveHospitalId(other.id);

    // The new tenant starts empty — none of the demo patients leak through.
    expect(getPatients()).toHaveLength(0);
    expect(getVisits()).toHaveLength(0);

    // A write made while acting as the new tenant is stamped to it.
    const { patient, visit } = createNewVisit(
      { full_name: "Aïsha Tenant-Two" },
      { visit_type: "outpatient" },
    );
    expect(patient.hospital_id).toBe(other.id);
    expect(visit.hospital_id).toBe(other.id);

    // The new tenant sees only its own single patient...
    const tenantTwoPatients = getPatients();
    expect(tenantTwoPatients).toHaveLength(1);
    expect(tenantTwoPatients[0].id).toBe(patient.id);

    // ...and switching back to the demo tenant shows the original caseload,
    // with the new tenant's patient invisible.
    setActiveHospitalId(DEMO_HOSPITAL_ID);
    const demoPatients = getPatients();
    expect(demoPatients).toHaveLength(seedCount);
    expect(demoPatients.some((p) => p.id === patient.id)).toBe(false);
    expect(demoPatients.every((p) => p.hospital_id === DEMO_HOSPITAL_ID)).toBe(
      true,
    );
  });

  it("scopes the board/queue reads that drive the dashboard", () => {
    // Regression: getActiveVisits/getOpenOrders/getActiveAdmissions once read
    // the unscoped store, so a brand-new tenant saw the demo caseload on the
    // Live Board. They must be tenant-scoped like every other read.
    setActiveHospitalId(DEMO_HOSPITAL_ID);
    expect(getActiveVisits().length).toBeGreaterThan(0);
    expect(
      getActiveVisits().every((v) => v.hospital_id === DEMO_HOSPITAL_ID),
    ).toBe(true);

    const other = createHospital({ name: "Garoua Clinic" });
    setActiveHospitalId(other.id);

    // A freshly registered hospital's board is empty — nothing leaks through.
    expect(getActiveVisits()).toHaveLength(0);
    expect(getOpenOrders()).toHaveLength(0);
    expect(getActiveAdmissions()).toHaveLength(0);
  });
});

describe("admin provisioning (write stamping for setup mutators)", () => {
  it("stamps a newly registered tenant's staff, department, ward and beds to it", () => {
    // Onboarding flow: a fresh hospital provisions its own org structure via the
    // admin UIs (staff directory, departments, floor map). Every such write must
    // be stamped to the acting tenant and stay invisible to the demo tenant.
    const other = createHospital({ name: "Limbe Cottage" });
    setActiveHospitalId(other.id);

    const staff = createStaff({ full_name: "Dr. New Tenant", role: "doctor" });
    const department = createDepartment({ name: "Cardiology" });
    const ward = createWard({ name: "Ward A", bed_count: 2 });
    const moreBeds = addBedsToWard(ward.id, 3);

    expect(staff.hospital_id).toBe(other.id);
    expect(department.hospital_id).toBe(other.id);
    expect(ward.hospital_id).toBe(other.id);
    expect(moreBeds.every((b) => b.hospital_id === other.id)).toBe(true);

    // Scoped reads as the new tenant see exactly what it created.
    expect(getStaff()).toHaveLength(1);
    expect(getDepartments()).toHaveLength(1);
    expect(getWards()).toHaveLength(1);
    expect(getBeds()).toHaveLength(5); // 2 seeded + 3 appended
    expect(getStaff().every((s) => s.hospital_id === other.id)).toBe(true);
    expect(getBeds().every((b) => b.hospital_id === other.id)).toBe(true);
  });

  it("keeps the new tenant's provisioning invisible to the demo tenant", () => {
    const demoStaffCount = (() => {
      setActiveHospitalId(DEMO_HOSPITAL_ID);
      return getStaff().length;
    })();
    const demoDeptCount = getDepartments().length;

    const other = createHospital({ name: "Kribi Health" });
    setActiveHospitalId(other.id);
    const staff = createStaff({ full_name: "Nurse Two", role: "nurse" });
    const department = createDepartment({ name: "Maternity" });

    // Back to demo: counts unchanged, and the new rows are absent.
    setActiveHospitalId(DEMO_HOSPITAL_ID);
    expect(getStaff()).toHaveLength(demoStaffCount);
    expect(getDepartments()).toHaveLength(demoDeptCount);
    expect(getStaff().some((s) => s.id === staff.id)).toBe(false);
    expect(getDepartments().some((d) => d.id === department.id)).toBe(false);
  });
});
