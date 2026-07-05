/**
 * deleteOrder / deletePrescription — a doctor removing a mistaken test or
 * medication. Both cascade (order → results, prescription → MAR doses) so no
 * child row is left orphaned.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetDatabase,
  setActiveHospitalId,
  createNewVisit,
  addOrder,
  addResult,
  deleteOrder,
  getOrdersForVisit,
  getResultsForOrder,
  addPrescription,
  recordMedicationAdministration,
  deletePrescription,
  getPrescriptionsForVisit,
  getMedicationAdministrationsForPrescription,
} from "@/services/mockStorage";

beforeAll(() => {
  const store = new Map<string, string>();
  // @ts-expect-error minimal shim
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
  };
});
beforeEach(() => { resetDatabase(); setActiveHospitalId("hosp_demo"); });

function newVisit() {
  return createNewVisit(
    { full_name: "Delete Probe", date_of_birth: "1990-01-01", sex: "female" },
    { visit_type: "outpatient" },
  ).visit;
}

describe("deleteOrder", () => {
  it("removes the order and cascades to its results", () => {
    const visit = newVisit();
    const order = addOrder(visit.id, { order_type: "lab", description: "FBC" });
    addResult(order.id, { value: "12.1" });
    expect(getOrdersForVisit(visit.id)).toHaveLength(1);
    expect(getResultsForOrder(order.id)).toHaveLength(1);

    deleteOrder(order.id);

    expect(getOrdersForVisit(visit.id)).toHaveLength(0);
    expect(getResultsForOrder(order.id)).toHaveLength(0);
  });

  it("is a no-op for an unknown order id", () => {
    expect(() => deleteOrder("nope" as never)).not.toThrow();
  });
});

describe("deletePrescription", () => {
  it("removes the prescription and cascades to its MAR doses", () => {
    const visit = newVisit();
    const rx = addPrescription(visit.id, { drug_name: "Paracetamol" });
    recordMedicationAdministration(rx.id, { status: "given" });
    expect(getPrescriptionsForVisit(visit.id).some((p) => p.id === rx.id)).toBe(true);
    expect(getMedicationAdministrationsForPrescription(rx.id)).toHaveLength(1);

    deletePrescription(rx.id);

    expect(getPrescriptionsForVisit(visit.id).some((p) => p.id === rx.id)).toBe(false);
    expect(getMedicationAdministrationsForPrescription(rx.id)).toHaveLength(0);
  });
});
