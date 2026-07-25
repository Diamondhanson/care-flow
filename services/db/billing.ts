/**
 * Billing & invoicing (Phase 16.9) — the per-tenant price catalog
 * (`billableItems`) and the per-visit charge ledger (`charges`), including
 * idempotent auto-charge reconciliation, manual lines, discounts and
 * settlement.
 */

import type {
  BillableItem,
  BillableItemId,
  BillingCategory,
  BillingUnit,
  Charge,
  ChargeId,
  ChargeStatus,
  StaffId,
  VisitId,
} from "@/types/healthcare";
import { computeAutoChargeLines } from "@/components/billing/billing";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped, tenantId } from "./tenancy";

export interface CreateBillableItemInput {
  category: BillingCategory;
  name: string;
  unit: BillingUnit;
  unit_price: number;
  ref_code?: string | null;
  is_active?: boolean;
}

export interface UpdateBillableItemInput {
  category?: BillingCategory;
  name?: string;
  unit?: BillingUnit;
  unit_price?: number;
  ref_code?: string | null;
  is_active?: boolean;
}

export interface AddManualChargeInput {
  /** Optional catalog item to price from (snapshots its price + links it). */
  billable_item_id?: BillableItemId | null;
  description: string;
  quantity?: number;
  /** Required when no catalog item is given; snapshotted onto the charge. */
  unit_price?: number;
  created_by_id?: StaffId | null;
}

export interface AddDiscountInput {
  description: string;
  /** Discount magnitude in whole XAF (always stored as a negative amount). */
  amount: number;
  created_by_id?: StaffId | null;
}

// ---------------------------------------------------------------------------
// Billing & invoicing (Phase 16.9)
//
// Two collections: `billableItems` (the per-tenant price catalog) and `charges`
// (the per-visit ledger). Auto-generated charges (consultations, ordered tests,
// drugs, bed-nights, nursing-days) are reconciled idempotently against their
// clinical origin via `source_ref_id`; operator-entered manual lines and
// discounts are preserved across reconciliation. Billing is informational — it
// produces the bill and, on settlement, ticks `is_financial_cleared` as a
// convenience; it adds no new discharge-blocking logic.
// ---------------------------------------------------------------------------

/** The price catalog for the active tenant, by display name. */
export function getBillableItems(): BillableItem[] {
  return loadScoped()
    .billableItems.slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getBillableItemById(id: BillableItemId): BillableItem | undefined {
  return loadScoped().billableItems.find((i) => i.id === id);
}

/** Every charge for the active tenant (reporting/aggregation). */
export function getAllCharges(): Charge[] {
  return loadScoped().charges;
}

/** The charge ledger for a single visit, oldest first (creation order). */
export function getChargesForVisit(visitId: VisitId): Charge[] {
  return loadScoped()
    .charges.filter((c) => c.visit_id === visitId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Add a new catalog price. Admin/receptionist UI only (not enforced here). */
export function createBillableItem(input: CreateBillableItemInput): BillableItem {
  const db = loadDatabase();
  const timestamp = nowISO();
  const item: BillableItem = {
    id: generateId() as BillableItemId,
    hospital_id: tenantId(db),
    category: input.category,
    name: input.name.trim(),
    unit: input.unit,
    unit_price: Math.max(0, Math.round(input.unit_price)),
    ref_code: input.ref_code?.trim() || null,
    is_active: input.is_active ?? true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.billableItems.push(item);
  persist(db);
  return item;
}

/** Patch a catalog price. Existing charges keep their snapshotted price. */
export function updateBillableItem(
  itemId: BillableItemId,
  input: UpdateBillableItemInput
): BillableItem {
  const db = loadDatabase();
  const item = db.billableItems.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`updateBillableItem: item "${itemId}" not found`);
  }
  if (input.category !== undefined) item.category = input.category;
  if (input.name !== undefined) item.name = input.name.trim();
  if (input.unit !== undefined) item.unit = input.unit;
  if (input.unit_price !== undefined) {
    item.unit_price = Math.max(0, Math.round(input.unit_price));
  }
  if (input.ref_code !== undefined) item.ref_code = input.ref_code?.trim() || null;
  if (input.is_active !== undefined) item.is_active = input.is_active;
  item.updated_at = nowISO();
  persist(db);
  return item;
}

/**
 * Reconcile the auto-generated charges for a visit against its current clinical
 * record. Idempotent: charges are keyed by `(source, source_ref_id)`, so a line
 * whose origin still exists is updated in place (its snapshotted price is *not*
 * rewritten — only its computed quantity/amount), a brand-new origin gets a new
 * line, and a line whose origin disappeared is dropped. Manual lines and
 * discounts are never touched. Returns the visit's full charge ledger after.
 */
export function recalculateAutoCharges(visitId: VisitId): Charge[] {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`recalculateAutoCharges: visit "${visitId}" not found`);
  }

  const admission = db.admissions.find((a) => a.visit_id === visitId) ?? null;
  const transfers = admission
    ? db.transfers.filter((t) => t.admission_id === admission.id)
    : [];

  const desired = computeAutoChargeLines({
    visit,
    consultations: db.consultations.filter((c) => c.visit_id === visitId),
    orders: db.orders.filter((o) => o.visit_id === visitId),
    prescriptions: db.prescriptions.filter((p) => p.visit_id === visitId),
    admission,
    transfers,
    wards: db.wards,
    catalog: db.billableItems.filter((i) => i.hospital_id === visit.hospital_id),
    nowMs: Date.now(),
  });

  const AUTO_SOURCES = new Set(["consultation", "order", "prescription", "bed", "nursing", "procedure"]);
  const timestamp = nowISO();

  // Index existing auto charges for this visit by their idempotency key.
  const existingAuto = new Map<string, Charge>();
  for (const c of db.charges) {
    if (c.visit_id === visitId && AUTO_SOURCES.has(c.source) && c.source_ref_id) {
      existingAuto.set(`${c.source}:${c.source_ref_id}`, c);
    }
  }

  const keep = new Set<string>();
  for (const line of desired) {
    const key = `${line.source}:${line.source_ref_id}`;
    keep.add(key);
    const existing = existingAuto.get(key);
    if (existing) {
      // Update the computed shape; preserve the snapshotted unit price.
      const amount = line.quantity * existing.unit_price;
      if (
        existing.quantity !== line.quantity ||
        existing.amount !== amount ||
        existing.description !== line.description ||
        existing.billable_item_id !== line.billable_item_id
      ) {
        existing.quantity = line.quantity;
        existing.amount = amount;
        existing.description = line.description;
        existing.billable_item_id = line.billable_item_id;
        existing.updated_at = timestamp;
      }
    } else {
      db.charges.push({
        id: generateId() as ChargeId,
        hospital_id: visit.hospital_id,
        visit_id: visitId,
        billable_item_id: line.billable_item_id,
        source: line.source,
        source_ref_id: line.source_ref_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: line.amount,
        status: "pending",
        created_by_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
  }

  // Drop auto charges whose clinical origin no longer exists.
  db.charges = db.charges.filter((c) => {
    if (c.visit_id !== visitId) return true;
    if (!AUTO_SOURCES.has(c.source) || !c.source_ref_id) return true;
    return keep.has(`${c.source}:${c.source_ref_id}`);
  });

  persist(db);
  return db.charges
    .filter((c) => c.visit_id === visitId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Add an operator-entered line (extra goods/services). Preserved on reconcile. */
export function addManualCharge(visitId: VisitId, input: AddManualChargeInput): Charge {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addManualCharge: visit "${visitId}" not found`);
  }
  const catalogItem = input.billable_item_id
    ? db.billableItems.find((i) => i.id === input.billable_item_id)
    : undefined;
  const unitPrice = Math.max(
    0,
    Math.round(input.unit_price ?? catalogItem?.unit_price ?? 0)
  );
  const quantity = Math.max(1, Math.round(input.quantity ?? 1));
  const timestamp = nowISO();
  const charge: Charge = {
    id: generateId() as ChargeId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    billable_item_id: catalogItem?.id ?? null,
    source: "manual",
    source_ref_id: null,
    description: input.description.trim() || catalogItem?.name || "Manual charge",
    quantity,
    unit_price: unitPrice,
    amount: quantity * unitPrice,
    status: "pending",
    created_by_id: input.created_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.charges.push(charge);
  persist(db);
  return charge;
}

/** Add a discount line (stored as a negative amount). Preserved on reconcile. */
export function addDiscount(visitId: VisitId, input: AddDiscountInput): Charge {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addDiscount: visit "${visitId}" not found`);
  }
  const magnitude = Math.max(0, Math.round(Math.abs(input.amount)));
  const timestamp = nowISO();
  const charge: Charge = {
    id: generateId() as ChargeId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    billable_item_id: null,
    source: "discount",
    source_ref_id: null,
    description: input.description.trim() || "Discount",
    quantity: 1,
    unit_price: -magnitude,
    amount: -magnitude,
    status: "pending",
    created_by_id: input.created_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.charges.push(charge);
  persist(db);
  return charge;
}

/** Remove a single charge line (any source). */
export function removeCharge(chargeId: ChargeId): void {
  const db = loadDatabase();
  const before = db.charges.length;
  db.charges = db.charges.filter((c) => c.id !== chargeId);
  if (db.charges.length !== before) persist(db);
}

/** Set the settlement status of a single charge line. */
export function setChargeStatus(chargeId: ChargeId, status: ChargeStatus): Charge {
  const db = loadDatabase();
  const charge = db.charges.find((c) => c.id === chargeId);
  if (!charge) {
    throw new Error(`setChargeStatus: charge "${chargeId}" not found`);
  }
  charge.status = status;
  charge.updated_at = nowISO();
  persist(db);
  return charge;
}

/**
 * Settle the whole bill for a visit: mark every pending charge `paid` and, as a
 * convenience, tick the admission's `is_financial_cleared` flag (informational —
 * no discharge logic is added here). Returns the settled ledger.
 */
export function settleBill(visitId: VisitId, settledById?: StaffId | null): Charge[] {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`settleBill: visit "${visitId}" not found`);
  }
  const timestamp = nowISO();
  for (const c of db.charges) {
    if (c.visit_id === visitId && c.status === "pending") {
      c.status = "paid";
      c.updated_at = timestamp;
      if (settledById !== undefined && c.created_by_id === null) {
        c.created_by_id = settledById;
      }
    }
  }
  // Convenience: reflect settlement on the admission's financial-clearance flag.
  const admission = db.admissions.find((a) => a.visit_id === visitId);
  if (admission && !admission.is_financial_cleared) {
    admission.is_financial_cleared = true;
    admission.updated_at = timestamp;
  }
  persist(db);
  return db.charges
    .filter((c) => c.visit_id === visitId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
