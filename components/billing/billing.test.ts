import { describe, expect, it } from "vitest";

import {
  BILLING_CATALOG_SEED,
  buildWardSegments,
  catalogByRef,
  computeAutoChargeLines,
  nightsBetween,
  nursingDays,
  resolveBedItem,
  resolveOrderItem,
  resolvePrescriptionItem,
  summarizeBill,
} from "@/components/billing/billing";
import type {
  Admission,
  BillableItem,
  Charge,
  Consultation,
  Order,
  Prescription,
  Transfer,
  Visit,
  Ward,
} from "@/types/healthcare";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

/** Resolve the seed catalog into full BillableItem rows (tenant + timestamps). */
const CATALOG: BillableItem[] = BILLING_CATALOG_SEED.map((it) => ({
  ...it,
  hospital_id: "hosp_demo",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}));

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

const ward = (id: string, name: string): Ward =>
  ({ id, hospital_id: "hosp_demo", department_id: null, name, floor_label: null, is_active: true, created_at: "", updated_at: "" }) as Ward;

const WARDS: Ward[] = [
  ward("ward_icu", "ICU"),
  ward("ward_medb", "Medical Ward B"),
  ward("ward_mat", "Maternity"),
];

const baseVisit: Visit = {
  id: "vis_x",
  hospital_id: "hosp_demo",
  patient_id: "pat_x",
  visit_type: "inpatient",
  status: "open",
  stage: "treatment",
  department_id: null,
  attending_doctor_id: null,
  registered_by_id: null,
  chief_complaint: null,
  triage_notes: null,
  triage_level: null,
  arrived_at: isoDaysAgo(5),
  closed_at: null,
  created_at: isoDaysAgo(5),
  updated_at: isoDaysAgo(5),
};

// ---------------------------------------------------------------------------
// Catalog lookup
// ---------------------------------------------------------------------------

describe("catalog resolution", () => {
  it("matches lab/imaging orders by description keyword", () => {
    const fbc = { order_type: "lab", description: "Full Blood Count" } as Order;
    const mal = { order_type: "lab", description: "Malaria RDT" } as Order;
    const cxr = { order_type: "imaging", description: "Chest X-ray (PA)" } as Order;
    const other = { order_type: "lab", description: "Widal test" } as Order;
    expect(resolveOrderItem(fbc, CATALOG)?.ref_code).toBe("lab_fbc");
    expect(resolveOrderItem(mal, CATALOG)?.ref_code).toBe("lab_malaria");
    expect(resolveOrderItem(cxr, CATALOG)?.ref_code).toBe("img_cxr");
    expect(resolveOrderItem(other, CATALOG)?.ref_code).toBe("lab_other");
  });

  it("matches prescriptions by drug name, falling back to generic", () => {
    expect(resolvePrescriptionItem({ drug_name: "Paracetamol" } as Prescription, CATALOG)?.ref_code).toBe("drug_paracetamol");
    expect(resolvePrescriptionItem({ drug_name: "Artemether-lumefantrine" } as Prescription, CATALOG)?.ref_code).toBe("drug_al");
    expect(resolvePrescriptionItem({ drug_name: "Mystery tonic" } as Prescription, CATALOG)?.ref_code).toBe("drug_other");
  });

  it("resolves bed price by ward name", () => {
    expect(resolveBedItem(WARDS[0], CATALOG)?.unit_price).toBe(20_000); // ICU
    expect(resolveBedItem(WARDS[1], CATALOG)?.unit_price).toBe(6_000); // general
    expect(resolveBedItem(WARDS[2], CATALOG)?.unit_price).toBe(10_000); // maternity
    expect(resolveBedItem(undefined, CATALOG)?.unit_price).toBe(6_000); // default general
  });

  it("catalogByRef returns undefined for unknown codes", () => {
    expect(catalogByRef(CATALOG, "nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Time-based math
// ---------------------------------------------------------------------------

describe("time-based computation", () => {
  it("counts whole nights, minimum 1", () => {
    expect(nightsBetween(0, 0)).toBe(1);
    expect(nightsBetween(0, DAY_MS)).toBe(1);
    expect(nightsBetween(0, DAY_MS * 3)).toBe(3);
    expect(nightsBetween(0, DAY_MS * 2.5)).toBe(3); // ceil
  });

  it("nursing days span the whole admission", () => {
    const adm = { admitted_at: isoDaysAgo(3), discharged_at: null } as Admission;
    expect(nursingDays(adm, NOW)).toBe(3);
    const discharged = { admitted_at: isoDaysAgo(10), discharged_at: isoDaysAgo(6) } as Admission;
    expect(nursingDays(discharged, NOW)).toBe(4);
  });

  it("splits the stay into ward segments at each transfer", () => {
    const adm = { id: "adm_x", ward_id: "ward_icu", admitted_at: isoDaysAgo(5), discharged_at: null } as Admission;
    const transfers: Transfer[] = [
      { id: "t1", from_ward_id: "ward_medb", to_ward_id: "ward_icu", created_at: isoDaysAgo(2) } as Transfer,
    ];
    const segs = buildWardSegments(adm, transfers, NOW);
    expect(segs).toHaveLength(2);
    // Initial ward is the transfer's from_ward (where the patient was first).
    expect(segs[0].wardId).toBe("ward_medb");
    expect(segs[0].nights).toBe(3); // days 5→2 ago
    expect(segs[1].wardId).toBe("ward_icu");
    expect(segs[1].nights).toBe(2); // days 2→0 ago
  });

  it("single segment when there are no transfers", () => {
    const adm = { id: "adm_x", ward_id: "ward_icu", admitted_at: isoDaysAgo(4), discharged_at: null } as Admission;
    const segs = buildWardSegments(adm, [], NOW);
    expect(segs).toHaveLength(1);
    expect(segs[0].wardId).toBe("ward_icu");
    expect(segs[0].nights).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Auto-charge derivation
// ---------------------------------------------------------------------------

describe("computeAutoChargeLines", () => {
  it("bills consultations, orders, drugs, beds and nursing; skips cancelled orders", () => {
    const adm = { id: "adm_x", ward_id: "ward_icu", admitted_at: isoDaysAgo(3), discharged_at: null } as Admission;
    const lines = computeAutoChargeLines({
      visit: baseVisit,
      consultations: [{ id: "con_1", visit_id: "vis_x" } as Consultation],
      orders: [
        { id: "ord_1", visit_id: "vis_x", order_type: "lab", description: "Malaria RDT", status: "completed" } as Order,
        { id: "ord_2", visit_id: "vis_x", order_type: "imaging", description: "Chest X-ray", status: "cancelled" } as Order,
      ],
      prescriptions: [{ id: "rx_1", visit_id: "vis_x", drug_name: "Paracetamol" } as Prescription],
      admission: adm,
      transfers: [],
      wards: WARDS,
      catalog: CATALOG,
      nowMs: NOW,
    });

    const bySource = (s: string) => lines.filter((l) => l.source === s);
    expect(bySource("consultation")).toHaveLength(1);
    expect(bySource("order")).toHaveLength(1); // cancelled imaging excluded
    expect(bySource("order")[0].amount).toBe(1_500); // Malaria RDT
    expect(bySource("prescription")[0].amount).toBe(500); // Paracetamol
    expect(bySource("bed")).toHaveLength(1);
    expect(bySource("bed")[0].amount).toBe(3 * 20_000); // 3 nights ICU
    expect(bySource("nursing")[0].amount).toBe(3 * 3_000);
  });

  it("produces no bed/nursing lines for an outpatient visit", () => {
    const lines = computeAutoChargeLines({
      visit: { ...baseVisit, visit_type: "outpatient" },
      consultations: [{ id: "con_1", visit_id: "vis_x" } as Consultation],
      orders: [],
      prescriptions: [],
      admission: null,
      transfers: [],
      wards: WARDS,
      catalog: CATALOG,
      nowMs: NOW,
    });
    expect(lines.every((l) => l.source !== "bed" && l.source !== "nursing")).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it("uses a stable idempotency key per origin", () => {
    const lines = computeAutoChargeLines({
      visit: baseVisit,
      consultations: [{ id: "con_1", visit_id: "vis_x" } as Consultation],
      orders: [],
      prescriptions: [],
      admission: null,
      transfers: [],
      wards: WARDS,
      catalog: CATALOG,
      nowMs: NOW,
    });
    expect(lines[0].source_ref_id).toBe("con_1");
  });
});

// ---------------------------------------------------------------------------
// Bill summary
// ---------------------------------------------------------------------------

const charge = (over: Partial<Charge>): Charge =>
  ({
    id: "c", hospital_id: "hosp_demo", visit_id: "vis_x", billable_item_id: null,
    source: "manual", source_ref_id: null, description: "x", quantity: 1,
    unit_price: 0, amount: 0, status: "pending", created_by_id: null,
    created_at: "", updated_at: "", ...over,
  }) as Charge;

describe("summarizeBill", () => {
  it("groups items, subtracts discounts, and computes the grand total", () => {
    const charges: Charge[] = [
      charge({ id: "a", source: "consultation", billable_item_id: "bil_consult_general", amount: 5_000 }),
      charge({ id: "b", source: "bed", amount: 20_000 }),
      charge({ id: "c", source: "discount", amount: -2_000 }),
    ];
    const s = summarizeBill(charges, CATALOG);
    expect(s.itemsSubtotal).toBe(25_000);
    expect(s.discountTotal).toBe(2_000);
    expect(s.grandTotal).toBe(23_000);
    expect(s.discounts).toHaveLength(1);
    expect(s.isEmpty).toBe(false);
  });

  it("never goes below zero and flags full settlement", () => {
    const charges: Charge[] = [
      charge({ id: "a", source: "consultation", amount: 1_000, status: "paid" }),
      charge({ id: "b", source: "discount", amount: -5_000, status: "waived" }),
    ];
    const s = summarizeBill(charges, CATALOG);
    expect(s.grandTotal).toBe(0);
    expect(s.isFullySettled).toBe(true);
  });

  it("reports an empty bill", () => {
    const s = summarizeBill([], CATALOG);
    expect(s.isEmpty).toBe(true);
    expect(s.isFullySettled).toBe(false);
    expect(s.grandTotal).toBe(0);
  });
});
