/**
 * Billing & invoicing — pure computation layer (Phase 16.9).
 *
 * Every function here is a pure transform: catalog + clinical records in, bill
 * lines / totals out. No persistence, no React, no DOM — so the whole module is
 * unit-testable in node and reused verbatim by the service layer (auto-charge
 * reconciliation + sample-data seeding), the on-screen bill, and the PDF export
 * (one source of truth, the numbers never drift).
 *
 * Money is whole XAF (West African CFA franc has no minor unit) — integers only,
 * never floats.
 */

import type {
  Admission,
  BillableItem,
  BillingCategory,
  Charge,
  ChargeSource,
  Consultation,
  Order,
  Prescription,
  Transfer,
  Visit,
  Ward,
} from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Price catalog seed — the per-tenant starting price list (whole XAF).
//
// `ref_code` is a stable semantic key that auto-charge resolution matches
// against (not the ward/order id), so the catalog drives auto-pricing while
// staying decoupled from any specific seeded row. Numbers are the Phase 16.9
// locked figures from ROADMAP.md.
// ---------------------------------------------------------------------------

/** A catalog row before its tenant `hospital_id` and timestamps are stamped on. */
export interface BillingCatalogSeed {
  id: string;
  category: BillingCategory;
  name: string;
  unit: BillableItem["unit"];
  unit_price: number;
  ref_code: string | null;
  is_active: boolean;
}

export const BILLING_CATALOG_SEED: readonly BillingCatalogSeed[] = [
  // Consultations (flat, per encounter).
  { id: "bil_consult_general", category: "consultation", name: "Consultation — General Medicine", unit: "per_item", unit_price: 5_000, ref_code: "consultation_general", is_active: true },
  { id: "bil_consult_ophth", category: "consultation", name: "Consultation — Ophthalmology", unit: "per_item", unit_price: 7_000, ref_code: "consultation_ophthalmology", is_active: true },
  // Beds (time-based, per night) — resolved from the ward a patient occupies.
  { id: "bil_bed_icu", category: "bed_per_night", name: "Bed — ICU (per night)", unit: "per_night", unit_price: 20_000, ref_code: "bed_icu", is_active: true },
  { id: "bil_bed_maternity", category: "bed_per_night", name: "Bed — Maternity (per night)", unit: "per_night", unit_price: 10_000, ref_code: "bed_maternity", is_active: true },
  { id: "bil_bed_general", category: "bed_per_night", name: "Bed — General ward (per night)", unit: "per_night", unit_price: 6_000, ref_code: "bed_general", is_active: true },
  // Nursing (time-based, per day of admission).
  { id: "bil_nursing", category: "nursing_per_day", name: "Nursing care (per day)", unit: "per_day", unit_price: 3_000, ref_code: "nursing", is_active: true },
  // Lab tests.
  { id: "bil_lab_fbc", category: "lab_test", name: "Lab — Full Blood Count", unit: "per_item", unit_price: 3_000, ref_code: "lab_fbc", is_active: true },
  { id: "bil_lab_malaria", category: "lab_test", name: "Lab — Malaria RDT", unit: "per_item", unit_price: 1_500, ref_code: "lab_malaria", is_active: true },
  { id: "bil_lab_glucose", category: "lab_test", name: "Lab — Blood sugar", unit: "per_item", unit_price: 2_000, ref_code: "lab_glucose", is_active: true },
  { id: "bil_lab_other", category: "lab_test", name: "Lab — Other test", unit: "per_item", unit_price: 3_000, ref_code: "lab_other", is_active: true },
  // Imaging.
  { id: "bil_img_cxr", category: "imaging", name: "Imaging — Chest X-ray", unit: "per_item", unit_price: 12_000, ref_code: "img_cxr", is_active: true },
  { id: "bil_img_other", category: "imaging", name: "Imaging — Other scan", unit: "per_item", unit_price: 12_000, ref_code: "img_other", is_active: true },
  // Procedures.
  { id: "bil_proc_delivery", category: "procedure", name: "Procedure — Delivery (Maternity)", unit: "per_item", unit_price: 50_000, ref_code: "proc_delivery", is_active: true },
  { id: "bil_proc_other", category: "procedure", name: "Procedure — Other", unit: "per_item", unit_price: 15_000, ref_code: "proc_other", is_active: true },
  // Drugs / medication.
  { id: "bil_drug_paracetamol", category: "medication", name: "Drug — Paracetamol", unit: "per_item", unit_price: 500, ref_code: "drug_paracetamol", is_active: true },
  { id: "bil_drug_amoxicillin", category: "medication", name: "Drug — Amoxicillin", unit: "per_item", unit_price: 2_500, ref_code: "drug_amoxicillin", is_active: true },
  { id: "bil_drug_al", category: "medication", name: "Drug — Artemether-Lumefantrine", unit: "per_item", unit_price: 3_500, ref_code: "drug_al", is_active: true },
  { id: "bil_drug_other", category: "medication", name: "Drug — Other medication", unit: "per_item", unit_price: 1_000, ref_code: "drug_other", is_active: true },
];

/** Stable display order for grouped bill sections. */
export const BILLING_CATEGORY_ORDER: readonly BillingCategory[] = [
  "consultation",
  "lab_test",
  "imaging",
  "procedure",
  "medication",
  "bed_per_night",
  "nursing_per_day",
  "other",
];

const MS_PER_DAY = 24 * 3_600_000;

// ---------------------------------------------------------------------------
// Catalog lookup helpers
// ---------------------------------------------------------------------------

/** Find a catalog item by its semantic `ref_code` (first active match wins). */
export function catalogByRef(
  catalog: readonly BillableItem[],
  refCode: string
): BillableItem | undefined {
  return catalog.find((c) => c.ref_code === refCode);
}

/** Resolve the catalog item for a consultation. General medicine by default. */
export function resolveConsultationItem(
  catalog: readonly BillableItem[]
): BillableItem | undefined {
  return catalogByRef(catalog, "consultation_general");
}

/** Resolve the catalog item for an ordered test, by description keywords. */
export function resolveOrderItem(
  order: Order,
  catalog: readonly BillableItem[]
): BillableItem | undefined {
  const d = order.description.toLowerCase();
  if (order.order_type === "lab") {
    if (/full blood count|\bfbc\b/.test(d)) return catalogByRef(catalog, "lab_fbc");
    if (/malaria/.test(d)) return catalogByRef(catalog, "lab_malaria");
    if (/glucose|blood sugar/.test(d)) return catalogByRef(catalog, "lab_glucose");
    return catalogByRef(catalog, "lab_other");
  }
  if (order.order_type === "imaging") {
    if (/chest x-?ray|\bcxr\b/.test(d)) return catalogByRef(catalog, "img_cxr");
    return catalogByRef(catalog, "img_other");
  }
  // procedure
  if (/deliver/.test(d)) return catalogByRef(catalog, "proc_delivery");
  return catalogByRef(catalog, "proc_other");
}

/** Resolve the catalog item for a prescription, by drug-name keywords. */
export function resolvePrescriptionItem(
  rx: Prescription,
  catalog: readonly BillableItem[]
): BillableItem | undefined {
  const d = rx.drug_name.toLowerCase();
  if (/paracetamol/.test(d)) return catalogByRef(catalog, "drug_paracetamol");
  if (/amoxicillin/.test(d)) return catalogByRef(catalog, "drug_amoxicillin");
  if (/artemether|lumefantrine/.test(d)) return catalogByRef(catalog, "drug_al");
  return catalogByRef(catalog, "drug_other");
}

/** Resolve the per-night bed item for a ward, by ward name. */
export function resolveBedItem(
  ward: Ward | undefined,
  catalog: readonly BillableItem[]
): BillableItem | undefined {
  const name = (ward?.name ?? "").toLowerCase();
  if (/icu|intensive|critical/.test(name)) return catalogByRef(catalog, "bed_icu");
  if (/matern|labou?r|delivery/.test(name)) return catalogByRef(catalog, "bed_maternity");
  return catalogByRef(catalog, "bed_general");
}

/** The nursing per-day item. */
export function resolveNursingItem(
  catalog: readonly BillableItem[]
): BillableItem | undefined {
  return catalogByRef(catalog, "nursing");
}

// ---------------------------------------------------------------------------
// Time-based computation (beds + nursing) from the admission/transfers timeline
// ---------------------------------------------------------------------------

/** A contiguous stretch the patient spent in one ward. */
export interface WardSegment {
  wardId: string | null;
  startMs: number;
  endMs: number;
  nights: number;
}

/** Whole nights between two instants, minimum 1 for any non-empty stay. */
export function nightsBetween(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 1;
  return Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));
}

/**
 * Reconstruct the ward-by-ward timeline of an admission from its transfers.
 * The initial ward is the first transfer's `from_ward_id` (the patient was
 * there before being moved); with no transfers it is the admission's own ward.
 * Each transfer closes the current segment and opens the next. The final
 * segment ends at discharge, or at `nowMs` for a still-active stay.
 */
export function buildWardSegments(
  admission: Admission,
  transfers: readonly Transfer[],
  nowMs: number
): WardSegment[] {
  const ordered = [...transfers].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  const startMs = Date.parse(admission.admitted_at);
  const endMs = admission.discharged_at ? Date.parse(admission.discharged_at) : nowMs;

  const initialWard = ordered.length > 0 ? ordered[0].from_ward_id : admission.ward_id;
  const segments: WardSegment[] = [];
  let cursorMs = startMs;
  let currentWard = initialWard;

  for (const t of ordered) {
    const boundaryMs = Date.parse(t.created_at);
    segments.push({
      wardId: currentWard,
      startMs: cursorMs,
      endMs: boundaryMs,
      nights: nightsBetween(cursorMs, boundaryMs),
    });
    cursorMs = boundaryMs;
    currentWard = t.to_ward_id;
  }

  segments.push({
    wardId: currentWard,
    startMs: cursorMs,
    endMs,
    nights: nightsBetween(cursorMs, endMs),
  });

  return segments;
}

/** Whole days of nursing care across the whole admission (min 1). */
export function nursingDays(admission: Admission, nowMs: number): number {
  const startMs = Date.parse(admission.admitted_at);
  const endMs = admission.discharged_at ? Date.parse(admission.discharged_at) : nowMs;
  if (endMs <= startMs) return 1;
  return Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));
}

// ---------------------------------------------------------------------------
// Auto-charge derivation
// ---------------------------------------------------------------------------

/** A computed charge line, before it is persisted as a {@link Charge}. */
export interface AutoChargeLine {
  source: ChargeSource;
  /** Idempotency key — the originating record / segment. */
  source_ref_id: string;
  billable_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface ComputeAutoChargesInput {
  visit: Visit;
  consultations: readonly Consultation[];
  orders: readonly Order[];
  prescriptions: readonly Prescription[];
  /** The inpatient stay, if any (drives bed + nursing charges). */
  admission: Admission | null;
  /** Transfers for that admission (ward timeline). */
  transfers: readonly Transfer[];
  /** All wards, to resolve ward names → bed price. */
  wards: readonly Ward[];
  catalog: readonly BillableItem[];
  /** Reference "now" for an active stay's running duration (ms). */
  nowMs: number;
}

/**
 * Derive the full set of *auto-generated* charge lines a visit should carry,
 * keyed idempotently by `(source, source_ref_id)`. Manual lines and discounts
 * are out of scope here — the service layer preserves those across reconcile.
 *
 * - Consultation: one line per consultation record.
 * - Order: one line per order that resolves to a catalog item (cancelled orders
 *   are skipped — a test that was never run isn't billed).
 * - Prescription: one line per prescription (the drug dispensed).
 * - Bed: one line per ward segment (nights × that ward's per-night rate).
 * - Nursing: one line for the whole stay (days × nursing rate).
 */
export function computeAutoChargeLines(input: ComputeAutoChargesInput): AutoChargeLine[] {
  const { catalog, wards } = input;
  const lines: AutoChargeLine[] = [];

  // Consultations.
  for (const c of input.consultations) {
    const item = resolveConsultationItem(catalog);
    if (!item) continue;
    lines.push({
      source: "consultation",
      source_ref_id: c.id,
      billable_item_id: item.id,
      description: item.name,
      quantity: 1,
      unit_price: item.unit_price,
      amount: item.unit_price,
    });
  }

  // Ordered tests / imaging / procedures (skip cancelled).
  for (const o of input.orders) {
    if (o.status === "cancelled") continue;
    const item = resolveOrderItem(o, catalog);
    if (!item) continue;
    lines.push({
      source: "order",
      source_ref_id: o.id,
      billable_item_id: item.id,
      description: `${item.name} — ${o.description}`,
      quantity: 1,
      unit_price: item.unit_price,
      amount: item.unit_price,
    });
  }

  // Prescribed drugs.
  for (const rx of input.prescriptions) {
    const item = resolvePrescriptionItem(rx, catalog);
    if (!item) continue;
    lines.push({
      source: "prescription",
      source_ref_id: rx.id,
      billable_item_id: item.id,
      description: `${item.name} — ${rx.drug_name}`,
      quantity: 1,
      unit_price: item.unit_price,
      amount: item.unit_price,
    });
  }

  // Time-based: beds (per ward segment) + nursing (whole stay).
  if (input.admission) {
    const segments = buildWardSegments(input.admission, input.transfers, input.nowMs);
    segments.forEach((seg, idx) => {
      const ward = seg.wardId ? wards.find((w) => w.id === seg.wardId) : undefined;
      const item = resolveBedItem(ward, catalog);
      if (!item) return;
      const wardLabel = ward?.name ?? "Ward";
      lines.push({
        source: "bed",
        source_ref_id: `${input.admission!.id}:seg${idx}`,
        billable_item_id: item.id,
        description: `Bed — ${wardLabel} (${seg.nights} night${seg.nights === 1 ? "" : "s"})`,
        quantity: seg.nights,
        unit_price: item.unit_price,
        amount: seg.nights * item.unit_price,
      });
    });

    const nursing = resolveNursingItem(catalog);
    if (nursing) {
      const days = nursingDays(input.admission, input.nowMs);
      lines.push({
        source: "nursing",
        source_ref_id: input.admission.id,
        billable_item_id: nursing.id,
        description: `Nursing care (${days} day${days === 1 ? "" : "s"})`,
        quantity: days,
        unit_price: nursing.unit_price,
        amount: days * nursing.unit_price,
      });
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Bill summary
// ---------------------------------------------------------------------------

export interface BillCategoryGroup {
  category: BillingCategory;
  lines: Charge[];
  subtotal: number;
}

export interface BillSummary {
  /** Non-discount charges, grouped by category in display order. */
  groups: BillCategoryGroup[];
  /** Discount lines (negative amounts), kept separate from the grouped items. */
  discounts: Charge[];
  /** Sum of all non-discount line amounts. */
  itemsSubtotal: number;
  /** Total discount magnitude (a positive number). */
  discountTotal: number;
  /** itemsSubtotal − discountTotal (never below zero). */
  grandTotal: number;
  /** True when the visit carries no charges at all. */
  isEmpty: boolean;
  /** True when every charge is settled (paid or waived). */
  isFullySettled: boolean;
}

/** Which category bucket a charge falls into for grouping (by its catalog item). */
function categoryForCharge(charge: Charge, catalog: readonly BillableItem[]): BillingCategory {
  if (charge.billable_item_id) {
    const item = catalog.find((c) => c.id === charge.billable_item_id);
    if (item) return item.category;
  }
  // Map source → category for items without a catalog link (manual lines).
  switch (charge.source) {
    case "bed":
      return "bed_per_night";
    case "nursing":
      return "nursing_per_day";
    case "consultation":
      return "consultation";
    default:
      return "other";
  }
}

/**
 * Summarize a visit's charges into grouped sections + totals. Pure. Discounts
 * (negative amounts / `source === "discount"`) are separated from the itemised
 * groups and subtracted from the grand total. `catalog` is optional and only
 * sharpens category grouping for catalog-linked lines.
 */
export function summarizeBill(
  charges: readonly Charge[],
  catalog: readonly BillableItem[] = []
): BillSummary {
  const discounts = charges.filter((c) => c.source === "discount" || c.amount < 0);
  const items = charges.filter((c) => c.source !== "discount" && c.amount >= 0);

  const byCategory = new Map<BillingCategory, Charge[]>();
  for (const c of items) {
    const cat = categoryForCharge(c, catalog);
    const bucket = byCategory.get(cat);
    if (bucket) bucket.push(c);
    else byCategory.set(cat, [c]);
  }

  const groups: BillCategoryGroup[] = [];
  for (const category of BILLING_CATEGORY_ORDER) {
    const lines = byCategory.get(category);
    if (!lines || lines.length === 0) continue;
    groups.push({
      category,
      lines,
      subtotal: lines.reduce((s, c) => s + c.amount, 0),
    });
  }

  const itemsSubtotal = items.reduce((s, c) => s + c.amount, 0);
  const discountTotal = discounts.reduce((s, c) => s + Math.abs(c.amount), 0);
  const grandTotal = Math.max(0, itemsSubtotal - discountTotal);
  const isEmpty = charges.length === 0;
  const isFullySettled =
    !isEmpty && charges.every((c) => c.status === "paid" || c.status === "waived");

  return {
    groups,
    discounts,
    itemsSubtotal,
    discountTotal,
    grandTotal,
    isEmpty,
    isFullySettled,
  };
}
