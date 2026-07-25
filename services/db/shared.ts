/**
 * Shared foundations of the local data layer (`services/db`): the `Database`
 * shape, the collection ↔ Supabase-table mappings, id/time/environment
 * helpers, the Cameroon patient-ID generators, and the pure row-level
 * snapshot differ. Every other `services/db` module may import from here;
 * this module imports none of them, so no dependency cycle can start here.
 */

import type {
  Admission,
  Allergy,
  Bed,
  BillableItem,
  CarePlanEntry,
  CarePlanItem,
  Charge,
  ClinicalTermRow,
  Consultation,
  Department,
  Diagnosis,
  FollowUpTask,
  Hospital,
  HospitalId,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  Staff,
  Transfer,
  TreatmentRecord,
  Visit,
  Ward,
} from "@/types/healthcare";
import type { NewChange } from "@/services/syncQueue";

/** The demo tenant every seeded record belongs to (mirrors `hospitals` row). */
export const DEMO_HOSPITAL_ID = "hosp_demo" as HospitalId;

export interface Database {
  hospitals: Hospital[];
  departments: Department[];
  wards: Ward[];
  beds: Bed[];
  staff: Staff[];
  patients: Patient[];
  allergies: Allergy[];
  visits: Visit[];
  consultations: Consultation[];
  diagnoses: Diagnosis[];
  orders: Order[];
  results: Result[];
  prescriptions: Prescription[];
  medicationAdministrations: MedicationAdministration[];
  treatmentRecords: TreatmentRecord[];
  admissions: Admission[];
  transfers: Transfer[];
  carePlanItems: CarePlanItem[];
  carePlanEntries: CarePlanEntry[];
  billableItems: BillableItem[];
  charges: Charge[];
  clinicalTermRows: ClinicalTermRow[];
  followUpTasks: FollowUpTask[];
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strip diacritics and return the first A–Z letter of a name token, uppercased.
 * Returns "" when the token has no Latin letter (so the initial is simply
 * omitted rather than producing a stray character).
 */
function nameInitial(token: string): string {
  const ascii = token
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  const match = ascii.match(/[A-Z]/);
  return match ? match[0] : "";
}

/**
 * Build the Cameroon-standard patient ID (Phase 16.7). Pure helper.
 *
 *   `YYMMDD` + name initials + ` - ` + mother's-first-name initial
 *
 * e.g. Bambot Hanson Ngongmun, born 1998-11-20, mother Ndung → "981120BHN - N".
 * - `dob` is "YYYY-MM-DD" (may be approximate, e.g. "YYYY-01-01"). When absent
 *   the date prefix is omitted (an anonymous record has no ID at all — see
 *   `createNewVisit`).
 * - initials = first Latin letter of each whitespace-separated name token, in
 *   order, accents normalized to A–Z.
 * - mother's initial is appended after " - " only when a mother name is given.
 *
 * Uniqueness (clash suffix) is layered on top by `uniquePatientId`.
 */
export function generatePatientId(
  dob: string | null,
  fullName: string,
  motherFirstName?: string | null
): string {
  let datePart = "";
  if (dob) {
    const [y, m, d] = dob.split("-");
    if (y && m && d) datePart = `${y.slice(-2)}${m}${d}`;
  }
  const initials = fullName
    .trim()
    .split(/\s+/)
    .map(nameInitial)
    .join("");
  const base = `${datePart}${initials}`;
  const motherInitial = motherFirstName ? nameInitial(motherFirstName) : "";
  return motherInitial ? `${base} - ${motherInitial}` : base;
}

/**
 * Resolve a patient ID clash by appending `-2`, `-3`, … against the set of IDs
 * already in use. Returns `base` unchanged when it is free. Empty `base`
 * (anonymous, no details yet) is returned as-is — those carry no ID.
 */
export function uniquePatientId(base: string, existing: Iterable<string>): string {
  if (base === "") return "";
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Collections every Database holds — used to backfill stale persisted shapes. */
export const DB_COLLECTIONS = [
  "hospitals",
  "departments",
  "wards",
  "beds",
  "staff",
  "patients",
  "allergies",
  "visits",
  "consultations",
  "diagnoses",
  "orders",
  "results",
  "prescriptions",
  "medicationAdministrations",
  "treatmentRecords",
  "admissions",
  "transfers",
  "carePlanItems",
  "carePlanEntries",
  "billableItems",
  "charges",
  "clinicalTermRows",
  "followUpTasks",
] as const satisfies readonly (keyof Database)[];

/**
 * Backfill any collection a stale persisted DB is missing. New top-level arrays
 * were added across phases (allergies, transfers) without bumping the storage
 * key, so a DB written by an earlier build can lack them — default those to `[]`
 * rather than crashing. Never reseeds existing data.
 */
export function normalizeDatabase(parsed: Partial<Database>): Database {
  const db = { ...parsed } as Database;
  for (const key of DB_COLLECTIONS) {
    if (!Array.isArray(db[key])) {
      (db[key] as unknown[]) = [];
    }
  }
  return db;
}

/**
 * Map each in-memory collection (camelCase) to its Supabase table name
 * (snake_case) so captured changes carry the real Postgres table — letting the
 * future sync seam do `supabase.from(change.table)…` with no translation.
 */
export const COLLECTION_TO_TABLE: Record<(typeof DB_COLLECTIONS)[number], string> = {
  hospitals: "hospitals",
  departments: "departments",
  wards: "wards",
  beds: "beds",
  staff: "staff",
  patients: "patients",
  allergies: "allergies",
  visits: "visits",
  consultations: "consultations",
  diagnoses: "diagnoses",
  orders: "orders",
  results: "results",
  prescriptions: "prescriptions",
  medicationAdministrations: "medication_administrations",
  treatmentRecords: "treatment_records",
  admissions: "admissions",
  transfers: "transfers",
  carePlanItems: "care_plan_items",
  carePlanEntries: "care_plan_entries",
  billableItems: "billable_items",
  charges: "charges",
  clinicalTermRows: "clinical_terms",
  followUpTasks: "follow_up_tasks",
};

/**
 * Reverse of {@link COLLECTION_TO_TABLE}: Postgres table name → in-memory
 * collection. Used by the optimistic-concurrency write-back path (Phase 19),
 * where the sync layer speaks in table names and needs to land a
 * server-authoritative row or version back in the right local collection.
 */
export const TABLE_TO_COLLECTION: Record<string, keyof Database> = Object.fromEntries(
  DB_COLLECTIONS.map((c) => [COLLECTION_TO_TABLE[c], c]),
) as Record<string, keyof Database>;

/**
 * Every Postgres table the local cache mirrors, in dependency-friendly order
 * (parents before children). Phase 18b hydration fetches each of these and the
 * outbox replays writes against them, so this is the canonical table list for
 * the Supabase data layer.
 */
export const SUPABASE_TABLES: readonly string[] = DB_COLLECTIONS.map(
  (c) => COLLECTION_TO_TABLE[c],
);

export interface Identified {
  id: string;
}

/**
 * Diff two database snapshots at the row level, producing one outbox change per
 * affected row across every collection: `insert` for a new id, `delete` for a
 * dropped id, and `update` when a shared id's row content changed. Pure — no
 * storage access — so it is unit-testable in the node environment.
 */
export function diffDatabases(pre: Database, post: Database): NewChange[] {
  const changes: NewChange[] = [];
  // Deletes are collected per collection and appended child-first (reverse
  // dependency order): DB_COLLECTIONS lists parents before children, so a
  // parent delete replayed before its children would hit a foreign-key
  // violation on the server and poison the queue (Stage 2 fix).
  const deletesByCollection: NewChange[][] = [];

  for (const collection of DB_COLLECTIONS) {
    const table = COLLECTION_TO_TABLE[collection];
    const preRows = (pre[collection] ?? []) as unknown as Identified[];
    const postRows = (post[collection] ?? []) as unknown as Identified[];

    const preById = new Map(preRows.map((r) => [r.id, r]));
    const postById = new Map(postRows.map((r) => [r.id, r]));

    for (const [id, row] of postById) {
      const before = preById.get(id);
      if (!before) {
        changes.push({ table, op: "insert", row_id: id, payload: { ...row } });
      } else if (JSON.stringify(before) !== JSON.stringify(row)) {
        changes.push({ table, op: "update", row_id: id, payload: { ...row } });
      }
    }

    const deletes: NewChange[] = [];
    for (const [id] of preById) {
      if (!postById.has(id)) {
        deletes.push({ table, op: "delete", row_id: id, payload: { id } });
      }
    }
    deletesByCollection.push(deletes);
  }

  for (const deletes of deletesByCollection.reverse()) {
    changes.push(...deletes);
  }

  return changes;
}
