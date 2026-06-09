/**
 * One-off ETL: populate the LIVE Supabase `billable_items` + `charges` tables for
 * the production demo tenant, so the billing screen has rich, viewable data.
 *
 * Unlike `seed-demo.ts` (which remaps friendly mock IDs to fresh UUIDs for a
 * clean-slate load), the production DB ALREADY holds the demo clinical data under
 * its own UUIDs. So this script READS those real rows and derives charges that
 * reference the existing visit/ward UUIDs — using the exact same pure engine the
 * live app uses (`computeAutoChargeLines`), so seeded data matches reconciliation.
 *
 * Idempotent: clears this tenant's billing rows first, then re-inserts. Triggers
 * are disabled during load (session_replication_role = replica), exactly like the
 * demo seed, so version/updated_at/audit triggers don't fire.
 *
 * Run: set -a; source .env.local; set +a; npx tsx scripts/seed-billing-live.ts
 */

import { randomUUID } from "node:crypto";
import { Client } from "pg";

import {
  BILLING_CATALOG_SEED,
  computeAutoChargeLines,
} from "../components/billing/billing";
import type {
  Admission,
  BillableItem,
  Consultation,
  Order,
  Prescription,
  Transfer,
  Visit,
  Ward,
} from "../types/healthcare";

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error("SUPABASE_DB_URL not set. Run: set -a; source .env.local; set +a");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // ---- Resolve the (single) production tenant + an author for created_by ----
    const { rows: hosp } = await client.query<{ id: string }>(
      "select id from hospitals order by created_at limit 1",
    );
    if (hosp.length === 0) throw new Error("No hospital in production DB.");
    const hospitalId = hosp[0].id;

    const { rows: staffRows } = await client.query<{ id: string }>(
      "select id from staff where hospital_id = $1 order by created_at limit 1",
      [hospitalId],
    );
    const authorId = staffRows[0]?.id ?? null;

    // ---- Read the clinical record we derive charges from ---------------------
    const q = async <T>(sql: string): Promise<T[]> =>
      (await client.query(sql + ` where hospital_id = '${hospitalId}'`)).rows as T[];

    const visits = await q<Visit>("select * from visits");
    const consultations = await q<Consultation>("select * from consultations");
    const orders = await q<Order>("select * from orders");
    const prescriptions = await q<Prescription>("select * from prescriptions");
    const admissions = await q<Admission>("select * from admissions");
    const transfers = await q<Transfer>("select * from transfers");
    const wards = await q<Ward>("select * from wards");

    // ---- Build the catalog (fresh UUIDs; resolution is by ref_code) ----------
    const nowIso = new Date().toISOString();
    const catalog: BillableItem[] = BILLING_CATALOG_SEED.map((it) => ({
      id: randomUUID(),
      hospital_id: hospitalId,
      category: it.category,
      name: it.name,
      unit: it.unit,
      unit_price: it.unit_price,
      ref_code: it.ref_code,
      is_active: it.is_active,
      created_at: nowIso,
      updated_at: nowIso,
      version: 1,
    }));

    // ---- Derive charges per visit via the shared engine ----------------------
    type ChargeRow = {
      id: string;
      visit_id: string;
      billable_item_id: string | null;
      source: string;
      source_ref_id: string | null;
      description: string;
      quantity: number;
      unit_price: number;
      amount: number;
      status: "pending" | "paid" | "waived";
      created_by_id: string | null;
    };
    const charges: ChargeRow[] = [];
    const nowMs = Date.now();

    for (const v of visits) {
      const adm = admissions.find((a) => a.visit_id === v.id) ?? null;
      const trs = adm ? transfers.filter((t) => t.admission_id === adm.id) : [];
      const lines = computeAutoChargeLines({
        visit: v,
        consultations: consultations.filter((c) => c.visit_id === v.id),
        orders: orders.filter((o) => o.visit_id === v.id),
        prescriptions: prescriptions.filter((p) => p.visit_id === v.id),
        admission: adm,
        transfers: trs,
        wards,
        catalog,
        nowMs,
      });
      const settled = v.status === "closed";
      for (const line of lines) {
        charges.push({
          id: randomUUID(),
          visit_id: v.id,
          billable_item_id: line.billable_item_id,
          source: line.source,
          source_ref_id: line.source_ref_id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: line.amount,
          status: settled ? "paid" : "pending",
          created_by_id: authorId,
        });
      }
    }

    // Showcase a manual line + a discount on two OPEN visits (richer testing).
    const openVisits = visits.filter((v) => v.status === "open");
    if (openVisits[0]) {
      charges.push({
        id: randomUUID(), visit_id: openVisits[0].id, billable_item_id: null,
        source: "manual", source_ref_id: null, description: "Wound dressing pack",
        quantity: 2, unit_price: 1_500, amount: 3_000, status: "pending", created_by_id: authorId,
      });
    }
    if (openVisits[1]) {
      charges.push({
        id: randomUUID(), visit_id: openVisits[1].id, billable_item_id: null,
        source: "discount", source_ref_id: null, description: "Goodwill discount",
        quantity: 1, unit_price: -2_000, amount: -2_000, status: "pending", created_by_id: authorId,
      });
    }

    // ---- Load (idempotent, triggers off) -------------------------------------
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query("delete from charges where hospital_id = $1", [hospitalId]);
    await client.query("delete from billable_items where hospital_id = $1", [hospitalId]);

    for (const it of catalog) {
      await client.query(
        `insert into billable_items
           (id, hospital_id, category, name, unit, unit_price, ref_code, is_active, created_at, updated_at, version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`,
        [it.id, it.hospital_id, it.category, it.name, it.unit, it.unit_price, it.ref_code, it.is_active, it.created_at, it.updated_at],
      );
    }

    for (const c of charges) {
      await client.query(
        `insert into charges
           (id, hospital_id, visit_id, billable_item_id, source, source_ref_id, description, quantity, unit_price, amount, status, created_by_id, created_at, updated_at, version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now(), 1)`,
        [c.id, hospitalId, c.visit_id, c.billable_item_id, c.source, c.source_ref_id, c.description, c.quantity, c.unit_price, c.amount, c.status, c.created_by_id],
      );
    }

    await client.query("commit");

    console.log(
      `Seeded ${catalog.length} catalog items and ${charges.length} charges across ${visits.length} visits for hospital ${hospitalId}.`,
    );
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
