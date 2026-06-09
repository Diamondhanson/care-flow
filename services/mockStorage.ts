/**
 * CareFlow mock persistence engine (Phase 6 — Visit-Centric Refactor).
 *
 * A localStorage-backed simulator that stands in for the eventual Supabase
 * backend. ALL data mutation logic lives here so UI components stay
 * storage-agnostic — when we move to a real backend, only this file is swapped
 * for `supabase-js` calls and the UI contract (the exported functions below) is
 * preserved.
 *
 * The store now holds the full visit-centric relational model that mirrors
 * `types/healthcare.ts` (and, transitively, `supabase/schema.sql`). **The Visit
 * is the spine of the record** — consultations, diagnoses, orders, results,
 * prescriptions, MAR entries, vitals and (inpatient only) an admission all hang
 * off a visit by `*_id` foreign keys rather than nested objects.
 */

import type {
  Admission,
  AdmissionId,
  Allergy,
  AllergyCategory,
  AllergyId,
  AllergySeverity,
  Bed,
  BedId,
  BedStatus,
  BillableItem,
  BillableItemId,
  BillingCategory,
  BillingUnit,
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
  CarePlanItemId,
  CareStage,
  Charge,
  ChargeId,
  ChargeStatus,
  Consultation,
  ConsultationId,
  Department,
  DepartmentId,
  Diagnosis,
  Hospital,
  HospitalId,
  MarStatus,
  MedicationAdministration,
  MedicationAdministrationId,
  Order,
  OrderId,
  OrderStatus,
  OrderType,
  Patient,
  PatientId,
  Prescription,
  PrescriptionId,
  PrescriptionStatus,
  Result,
  ResultId,
  Staff,
  StaffId,
  StaffRole,
  SubscriptionStatus,
  Transfer,
  TreatmentRecord,
  TriageLevel,
  Visit,
  VisitId,
  VisitType,
  Ward,
  WardId,
} from "@/types/healthcare";
import { clearOutbox, enqueueChanges, type NewChange } from "@/services/syncQueue";
import {
  BILLING_CATALOG_SEED,
  computeAutoChargeLines,
} from "@/components/billing/billing";

// Bumped v7 → v8: every domain row now carries a `hospital_id` (Phase 17
// multi-tenancy). Older persisted shapes lack it, so a fresh key forces a clean
// re-seed rather than trying to backfill tenantless rows.
const STORAGE_KEY = "careflow_db_v8";

/** The demo tenant every seeded record belongs to (mirrors `hospitals` row). */
export const DEMO_HOSPITAL_ID = "hosp_demo";

/** A seed/input row before its owning `hospital_id` is stamped on. */
type Seed<T> = Omit<T, "hospital_id">;

interface Database {
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
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowISO(): string {
  return new Date().toISOString();
}

function generateId(): string {
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

/**
 * Read the database. On the server (no localStorage) we return a fresh,
 * non-persisted seed so SSR renders consistent data; in the browser we lazily
 * seed on first access and persist.
 */
function loadDatabase(): Database {
  if (!isBrowser()) {
    return seedDatabaseObject();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDatabaseObject();
    persist(seeded, { track: false });
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Database>;
    const normalized = normalizeDatabase(parsed);
    // Heal the persisted shape so a DB saved by an older build (missing newer
    // collections like `allergies`/`transfers`) doesn't crash accessors. This is
    // not a user mutation, so it is untracked — but it refreshes the outbox
    // baseline (`lastPersisted`) to the current stored state, so the next real
    // mutation diffs against an accurate pre-image.
    persist(normalized, { track: false });
    return normalized;
  } catch {
    // Corrupt payload — reset to a clean seed rather than crashing the UI.
    const seeded = seedDatabaseObject();
    persist(seeded, { track: false });
    return seeded;
  }
}

/** Collections every Database holds — used to backfill stale persisted shapes. */
const DB_COLLECTIONS = [
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
 * The last database state written to storage, kept in memory so the next
 * `persist` can diff against it and capture exactly which rows changed. Refreshed
 * on every write (tracked or not) and on every `loadDatabase` heal, so it always
 * mirrors what is on disk immediately before a mutation runs.
 */
let lastPersisted: Database | null = null;

/**
 * Map each in-memory collection (camelCase) to its Supabase table name
 * (snake_case) so captured changes carry the real Postgres table — letting the
 * future sync seam do `supabase.from(change.table)…` with no translation.
 */
const COLLECTION_TO_TABLE: Record<(typeof DB_COLLECTIONS)[number], string> = {
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
};

/**
 * Reverse of {@link COLLECTION_TO_TABLE}: Postgres table name → in-memory
 * collection. Used by the optimistic-concurrency write-back path (Phase 19),
 * where the sync layer speaks in table names and needs to land a
 * server-authoritative row or version back in the right local collection.
 */
const TABLE_TO_COLLECTION: Record<string, keyof Database> = Object.fromEntries(
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

interface Identified {
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

    for (const [id] of preById) {
      if (!postById.has(id)) {
        changes.push({ table, op: "delete", row_id: id, payload: { id } });
      }
    }
  }

  return changes;
}

/**
 * Write the database to storage. The single integration point for the outbox:
 * a *tracked* persist (the default — used by every mutation) diffs the new state
 * against {@link lastPersisted} and enqueues a change per affected row. Seeding,
 * healing and reset pass `{ track: false }` so they don't flood the queue with
 * non-mutations. On the server (no localStorage) this is a no-op, leaving the
 * node test path untouched.
 */
function persist(db: Database, opts: { track?: boolean } = {}): void {
  if (!isBrowser()) return;

  const track = opts.track ?? true;
  if (track && lastPersisted) {
    const changes = diffDatabases(lastPersisted, db);
    if (changes.length > 0) enqueueChanges(changes);
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  lastPersisted = structuredClone(db);
}

/**
 * Replace the entire local cache with rows fetched from Supabase (Phase 18b
 * hydration). Each Postgres table is mapped back onto its in-memory collection;
 * unknown/missing tables default to `[]`. The write is untracked so hydration
 * never floods the outbox, and it resets the diff baseline (`lastPersisted`) to
 * this server snapshot so the next real mutation diffs against accurate state.
 */
export function replaceDatabaseFromTables(
  byTable: Partial<Record<string, unknown[]>>,
): void {
  const db = normalizeDatabase({});
  for (const collection of DB_COLLECTIONS) {
    const rows = byTable[COLLECTION_TO_TABLE[collection]];
    if (Array.isArray(rows)) {
      (db[collection] as unknown[]) = rows;
    }
  }
  persist(db, { track: false });
}

/**
 * Stamp the server-authoritative `version` onto a single cached row after a
 * successful sync (Phase 19 optimistic concurrency). The local row already holds
 * the new field values — only its version was unknown until the server bumped it
 * — so we patch just `version` and leave everything else intact. Untracked: a
 * version write-back must never re-enqueue the row it just confirmed. Returns
 * true when a matching row was found and updated.
 */
export function applyServerVersionToCache(
  table: string,
  id: string,
  version: number,
): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as (Identified & { version?: number })[];
  const row = rows.find((r) => r.id === id);
  if (!row || row.version === version) return false;
  row.version = version;
  persist(db, { track: false });
  return true;
}

/**
 * Replace (or insert) a single cached row with the server's authoritative copy
 * (Phase 19 conflict resolution). When a write is rejected because it targeted a
 * stale version, the sync layer refetches the live row and calls this to re-sync
 * the cache to the winning state. Untracked so the refresh never re-enqueues.
 * Returns true when the row landed in a known collection.
 */
export function upsertRowFromServer(table: string, row: Identified): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as Identified[];
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    rows[idx] = row;
  } else {
    rows.push(row);
  }
  persist(db, { track: false });
  return true;
}

/**
 * Drop the local cache so the next reader starts clean (Phase 18b sign-out).
 * Leaves the outbox alone — any not-yet-uploaded changes must still drain. The
 * next login re-hydrates from Supabase.
 */
export function clearLocalCache(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  lastPersisted = null;
}

// ---------------------------------------------------------------------------
// Tenancy — the mock's stand-in for the schema's current_hospital_id() + RLS.
//
// A module-level "active hospital" (set from the logged-in / acting staff)
// scopes every read to a single tenant and stamps new rows on write. On the
// Supabase cutover (Phase 18) this whole mechanism is replaced by RLS on the
// server and `setActiveHospitalId` becomes a no-op — the UI contract is
// unchanged because callers never pass a hospital id explicitly.
// ---------------------------------------------------------------------------

let activeHospitalId: HospitalId | null = null;

/** Set the tenant whose data is visible. Called when the acting staff resolves. */
export function setActiveHospitalId(id: HospitalId | null): void {
  activeHospitalId = id;
}

/** The active tenant id, or null before one has been resolved. */
export function getActiveHospitalId(): HospitalId | null {
  return activeHospitalId;
}

/**
 * Resolve the tenant used to scope reads and stamp writes: the active hospital
 * when it exists in the store, otherwise the first (demo) hospital so SSR and
 * pre-login reads still render real data. Mirrors `current_hospital_id()`
 * resolving the logged-in staff's hospital.
 */
function currentHospitalId(db: Database): HospitalId | null {
  if (activeHospitalId && db.hospitals.some((h) => h.id === activeHospitalId)) {
    return activeHospitalId;
  }
  return db.hospitals[0]?.id ?? null;
}

/** Non-null tenant id for stamping new rows (falls back to the demo hospital). */
function tenantId(db: Database): HospitalId {
  return currentHospitalId(db) ?? DEMO_HOSPITAL_ID;
}

/**
 * Public resolver for the active tenant's hospital record (the account row).
 * Returns undefined only when the store somehow holds no hospitals.
 */
export function getCurrentHospital(): Hospital | undefined {
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  return db.hospitals.find((h) => h.id === hid);
}

/**
 * Every hospital account known to the platform. Deliberately NOT tenant-scoped:
 * this is the control-plane view (signup, the dev hospital switcher, a future
 * super-admin console), the one place that legitimately sees across tenants. On
 * the Supabase cutover this maps to a service-role / platform query, not an
 * RLS-scoped one.
 */
export function getHospitals(): Hospital[] {
  return loadDatabase().hospitals;
}

/** A single hospital account by id, or undefined. Control-plane (cross-tenant). */
export function getHospitalById(id: HospitalId): Hospital | undefined {
  return loadDatabase().hospitals.find((h) => h.id === id);
}

/**
 * Register a new hospital account — the heart of the future signup flow. New
 * tenants start on a `trial` subscription. The created hospital is returned so
 * the caller can immediately make it the active tenant and seed its first staff.
 */
export function createHospital(input: CreateHospitalInput): Hospital {
  const db = loadDatabase();
  const timestamp = nowISO();
  const hospital: Hospital = {
    id: generateId(),
    name: input.name.trim(),
    region: input.region?.trim() || null,
    contact_email: input.contact_email?.trim() || null,
    contact_phone: input.contact_phone?.trim() || null,
    subscription_tier: input.subscription_tier ?? "standard",
    subscription_status: input.subscription_status ?? "trial",
    created_at: timestamp,
    updated_at: timestamp,
  };
  if (!hospital.name) {
    throw new Error("createHospital: a hospital name is required");
  }
  db.hospitals.push(hospital);
  persist(db);
  return hospital;
}

/**
 * Load the database filtered to the active tenant — the READ path. Every domain
 * collection is narrowed to rows whose `hospital_id` matches the current
 * hospital; `hospitals` is narrowed to the tenant's own account row. This is the
 * mock equivalent of an RLS `using (hospital_id = current_hospital_id())`
 * predicate on every table. Writes use {@link loadDatabase} (the full store) so
 * the outbox diff stays correct and rows are stamped, not filtered away.
 */
function loadScoped(): Database {
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  if (!hid) return db;
  const only = <T extends { hospital_id: HospitalId }>(rows: T[]): T[] =>
    rows.filter((r) => r.hospital_id === hid);
  return {
    hospitals: db.hospitals.filter((h) => h.id === hid),
    departments: only(db.departments),
    wards: only(db.wards),
    beds: only(db.beds),
    staff: only(db.staff),
    patients: only(db.patients),
    allergies: only(db.allergies),
    visits: only(db.visits),
    consultations: only(db.consultations),
    diagnoses: only(db.diagnoses),
    orders: only(db.orders),
    results: only(db.results),
    prescriptions: only(db.prescriptions),
    medicationAdministrations: only(db.medicationAdministrations),
    treatmentRecords: only(db.treatmentRecords),
    admissions: only(db.admissions),
    transfers: only(db.transfers),
    carePlanItems: only(db.carePlanItems),
    carePlanEntries: only(db.carePlanEntries),
    billableItems: only(db.billableItems),
    charges: only(db.charges),
  };
}

// ---------------------------------------------------------------------------
// Input shapes (what callers provide; ids/timestamps are filled in here)
// ---------------------------------------------------------------------------

export interface CreateHospitalInput {
  name: string;
  region?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** Defaults to "standard". */
  subscription_tier?: string;
  /** Defaults to "trial" for a fresh signup. */
  subscription_status?: SubscriptionStatus;
}

export interface CreateStaffInput {
  full_name: string;
  role: StaffRole;
  email?: string | null;
  phone?: string | null;
  department_id?: DepartmentId | null;
  /** Defaults to the active tenant; pass explicitly when seeding a new hospital. */
  hospital_id?: HospitalId;
}

export interface CreatePatientInput {
  full_name: string;
  date_of_birth?: string | null;
  sex?: Patient["sex"];
  phone?: string | null;
  address?: string | null;
  national_id?: string | null;
  /** Mother's first name — supplies the patient ID's trailing initial. */
  mother_first_name?: string | null;
  is_emergency_anonymous?: boolean;
  /** If omitted for an emergency intake, one is generated automatically. */
  anonymous_identifier?: string;
}

export interface CreateVisitInput {
  visit_type: VisitType;
  department_id?: DepartmentId | null;
  attending_doctor_id?: StaffId | null;
  registered_by_id?: StaffId | null;
  chief_complaint?: string | null;
  triage_notes?: string | null;
  /** Emergency-severity acuity (1 = critical … 5 = non-urgent); null if untriaged. */
  triage_level?: TriageLevel | null;
  /** Defaults to "registration". */
  stage?: CareStage;
}

export interface AddTreatmentLogInput {
  recorded_by_id?: StaffId | null;
  spo2?: number | null;
  pulse?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  temperature_c?: number | null;
  weight_kg?: number | null;
  gcs_score?: number | null;
  notes?: string | null;
  recorded_at?: string;
}

export interface CreateAdmissionInput {
  attending_doctor_id?: StaffId | null;
  ward_id?: WardId | null;
  bed_id?: BedId | null;
  stage?: CareStage;
  reason?: string | null;
  is_medical_cleared?: boolean;
  is_financial_cleared?: boolean;
  is_pharmacy_ready?: boolean;
}

export interface CreateDepartmentInput {
  name: string;
  code?: string | null;
  description?: string | null;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface CreateWardInput {
  name: string;
  department_id?: DepartmentId | null;
  floor_label?: string | null;
  /** Optionally seed the ward with N sequentially-labelled beds on creation. */
  bed_count?: number;
}

export interface UpdateWardInput {
  name?: string;
  department_id?: DepartmentId | null;
  floor_label?: string | null;
  is_active?: boolean;
}

export interface UpdateBedInput {
  label?: string;
  status?: BedStatus;
}

export interface TransferAdmissionInput {
  to_ward_id?: WardId | null;
  to_bed_id?: BedId | null;
  to_doctor_id?: StaffId | null;
  reason?: string | null;
  transferred_by_id?: StaffId | null;
}

export interface AddConsultationInput {
  doctor_id?: StaffId | null;
  subjective?: string | null;
  examination?: string | null;
  assessment?: string | null;
  plan?: string | null;
}

export interface AddDiagnosisInput {
  consultation_id?: ConsultationId | null;
  diagnosed_by_id?: StaffId | null;
  icd10_code?: string | null;
  description: string;
  is_primary?: boolean;
}

export interface AddOrderInput {
  ordered_by_id?: StaffId | null;
  order_type: OrderType;
  description: string;
}

export interface AddResultInput {
  recorded_by_id?: StaffId | null;
  summary?: string | null;
  value?: string | null;
  reference_range?: string | null;
  is_abnormal?: boolean;
  /** Mock attachment reference (filename); no binary is stored in this phase. */
  attachment_path?: string | null;
}

export interface AddPrescriptionInput {
  prescribed_by_id?: StaffId | null;
  drug_name: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
}

export interface RecordAdministrationInput {
  administered_by_id?: StaffId | null;
  status: MarStatus;
  /** When the dose was due; defaults to now. */
  scheduled_for?: string | null;
  /** When it was actually given; defaults to now for "given", else null. */
  administered_at?: string | null;
  notes?: string | null;
}

export interface AddAllergyInput {
  substance: string;
  category?: AllergyCategory;
  severity?: AllergySeverity;
  reaction?: string | null;
  noted_by_id?: StaffId | null;
}

export interface AddCarePlanItemInput {
  category: CareNeedCategory;
  description: string;
  frequency?: string | null;
  goal?: string | null;
  created_by_id?: StaffId | null;
}

export interface AddCarePlanEntryInput {
  note: string;
  /** Tie the note to a specific care need, when applicable. */
  care_plan_item_id?: CarePlanItemId | null;
  /** Mark as a shift-handover message for the next nurse. */
  is_handover?: boolean;
  recorded_by_id?: StaffId | null;
}

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
// Emergency-intake helpers
// ---------------------------------------------------------------------------

const GREEK_TAGS = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
];

/**
 * Generate a human-readable anonymous tracking identifier for an unconscious /
 * unidentified emergency intake, e.g. "John Doe - Gamma - 20260531".
 */
export function generateAnonymousIdentifier(seedIndex?: number): string {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const tag =
    typeof seedIndex === "number"
      ? GREEK_TAGS[seedIndex % GREEK_TAGS.length]
      : GREEK_TAGS[Math.floor(Math.random() * GREEK_TAGS.length)];
  return `John Doe - ${tag} - ${stamp}`;
}

// ---------------------------------------------------------------------------
// Stage helpers (which stages still belong on the active board)
// ---------------------------------------------------------------------------

/** A visit has left the floor once it reaches one of these stages. */
export function isTerminalStage(stage: CareStage): boolean {
  return (
    stage === "discharged" || stage === "followed_up" || stage === "deceased"
  );
}

// ---------------------------------------------------------------------------
// Department routing helpers (pure — drive the board filter & per-unit views)
// ---------------------------------------------------------------------------

/** Sentinel meaning "no filter" — the admin / all-departments view. */
export const ALL_DEPARTMENTS = "all";

/**
 * Narrow a list of visits to a single department. A `null`/`undefined` or the
 * {@link ALL_DEPARTMENTS} sentinel returns the list untouched (admin view).
 * Pure — no storage access, so it is unit-testable.
 */
export function filterVisitsByDepartment<T extends { department_id: DepartmentId | null }>(
  visits: T[],
  departmentId: DepartmentId | null | undefined
): T[] {
  if (!departmentId || departmentId === ALL_DEPARTMENTS) return visits;
  return visits.filter((v) => v.department_id === departmentId);
}

/**
 * Tally visits per department id. Visits with no department are bucketed under
 * the {@link ALL_DEPARTMENTS} key. Pure — used for directory + nav badges.
 */
export function countVisitsByDepartment<T extends { department_id: DepartmentId | null }>(
  visits: T[]
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const v of visits) {
    const key = v.department_id ?? ALL_DEPARTMENTS;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Read queries — reference / structural
// ---------------------------------------------------------------------------

export function getDepartments(): Department[] {
  return loadScoped().departments;
}

export function getDepartmentById(id: DepartmentId): Department | undefined {
  return loadScoped().departments.find((d) => d.id === id);
}

export function getWards(): Ward[] {
  return loadScoped().wards;
}

export function getWardById(id: WardId): Ward | undefined {
  return loadScoped().wards.find((w) => w.id === id);
}

export function getBeds(): Bed[] {
  return loadScoped().beds;
}

export function getBedById(id: BedId): Bed | undefined {
  return loadScoped().beds.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Read queries — people
// ---------------------------------------------------------------------------

export function getStaff(): Staff[] {
  return loadScoped().staff;
}

export function getStaffById(id: StaffId): Staff | undefined {
  return loadScoped().staff.find((s) => s.id === id);
}

// --- Control-plane staff lookups (cross-tenant) -----------------------------
// The login screen and session resolution legitimately need to see staff before
// a tenant is active (you pick a hospital, then sign in). These read the FULL
// store, deliberately NOT scoped — the mock equivalent of a service-role query.

/** Every staff member of a given hospital — for the login "sign in as" picker. */
export function getStaffForHospital(hospitalId: HospitalId): Staff[] {
  return loadDatabase().staff.filter((s) => s.hospital_id === hospitalId);
}

/** Resolve a staff account by id across all tenants — used to restore a session. */
export function getStaffAccountById(id: StaffId): Staff | undefined {
  return loadDatabase().staff.find((s) => s.id === id);
}

/**
 * Resolve a staff account by its linked Supabase Auth uid (Phase 18b). After
 * hydration the staff row carries the real `user_id`, so this maps a signed-in
 * user straight to their staff identity without the mock metadata bridge.
 */
export function getStaffAccountByUserId(userId: string): Staff | undefined {
  return loadDatabase().staff.find((s) => s.user_id === userId);
}

/**
 * Create a staff member. Used by hospital signup (the founder admin, against the
 * just-created hospital via an explicit `hospital_id`) and by admin provisioning
 * (against the active tenant). A real login (`user_id`) is provisioned later via
 * a privileged server function (Phase 18); mock staff start with `user_id: null`.
 */
export function createStaff(input: CreateStaffInput): Staff {
  const db = loadDatabase();
  const fullName = input.full_name.trim();
  if (!fullName) {
    throw new Error("createStaff: a staff name is required");
  }
  const timestamp = nowISO();
  const staff: Staff = {
    id: generateId() as StaffId,
    hospital_id: input.hospital_id ?? tenantId(db),
    user_id: null,
    full_name: fullName,
    role: input.role,
    department_id: input.department_id ?? null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.staff.push(staff);
  persist(db);
  return staff;
}

/**
 * Remove a staff member. Used to roll back a freshly created mock staff row when
 * the privileged login provisioning (Phase 18a server action) fails — so the
 * directory never shows an account that has no real login behind it.
 */
export function deleteStaff(id: StaffId): void {
  const db = loadDatabase();
  const next = db.staff.filter((s) => s.id !== id);
  if (next.length === db.staff.length) return;
  db.staff = next;
  persist(db);
}

/**
 * Link a staff row to its Supabase Auth user id. Called right after
 * {@link provisionStaffLogin} succeeds (Phase 18b) so the new account's
 * `staff.user_id` matches `auth.uid()` — without that link the row is invisible
 * to its owner under Row-Level-Security. The write is tracked, so it drains to
 * Supabase via the outbox like any other mutation.
 */
export function setStaffUserId(id: StaffId, userId: string): void {
  const db = loadDatabase();
  const staff = db.staff.find((s) => s.id === id);
  if (!staff || staff.user_id === userId) return;
  staff.user_id = userId;
  staff.updated_at = nowISO();
  persist(db);
}

export function getPatients(): Patient[] {
  return loadScoped().patients;
}

export function getPatientById(id: PatientId): Patient | undefined {
  return loadScoped().patients.find((p) => p.id === id);
}

/**
 * Global patient lookup for the "find my patient" front door. Matches on name,
 * hospital number (MRN / booklet number), national ID, phone, or the temporary
 * anonymous identifier — case-insensitive substring. Returns the best matches,
 * MRN/exact-prefix hits first, capped at `limit`.
 */
export function searchPatients(query: string, limit = 8): Patient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = loadScoped().patients.filter((p) => {
    const haystacks = [
      p.full_name,
      p.mrn,
      p.national_id ?? "",
      p.phone ?? "",
      p.anonymous_identifier ?? "",
    ];
    return haystacks.some((h) => h.toLowerCase().includes(q));
  });
  // Rank: hospital-number / name prefix matches before mid-string matches.
  const score = (p: Patient): number => {
    const mrn = p.mrn.toLowerCase();
    const name = p.full_name.toLowerCase();
    if (mrn === q || name === q) return 0;
    if (mrn.startsWith(q) || name.startsWith(q)) return 1;
    if (mrn.includes(q) || name.includes(q)) return 2;
    return 3;
  };
  return matches
    .sort((a, b) => score(a) - score(b) || a.full_name.localeCompare(b.full_name))
    .slice(0, limit);
}

/** Every visit a patient has ever had, most-recently arrived first. */
export function getVisitsForPatient(patientId: PatientId): Visit[] {
  return loadScoped()
    .visits.filter((v) => v.patient_id === patientId)
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
}

/**
 * Resolve a patient to the visit a search result should open: the open visit if
 * one exists, otherwise the most recently created visit. Undefined if the
 * patient has never had a visit.
 */
export function getLatestVisitForPatient(patientId: PatientId): Visit | undefined {
  const visits = loadScoped().visits.filter((v) => v.patient_id === patientId);
  if (visits.length === 0) return undefined;
  const open = visits.filter((v) => v.status === "open");
  const pool = open.length ? open : visits;
  return [...pool].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** A patient's allergy records, most-recently noted first. */
export function getAllergiesForPatient(patientId: PatientId): Allergy[] {
  return loadScoped()
    .allergies.filter((a) => a.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Read queries — visits (the record spine)
// ---------------------------------------------------------------------------

export function getVisits(): Visit[] {
  return loadScoped().visits;
}

export function getVisitById(id: VisitId): Visit | undefined {
  return loadScoped().visits.find((v) => v.id === id);
}

/**
 * All visits still in progress (status "open"), most-recently arrived first.
 * This drives the Live Status Board.
 */
export function getActiveVisits(): Visit[] {
  return loadScoped()
    .visits.filter((v) => v.status === "open")
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
}

/** Active visits routed to a given department (or all, for the admin view). */
export function getActiveVisitsForDepartment(
  departmentId: DepartmentId | null | undefined
): Visit[] {
  return filterVisitsByDepartment(getActiveVisits(), departmentId);
}

/** Per-department tally of active visits, keyed by department id. */
export function getActiveVisitCountsByDepartment(): Record<string, number> {
  return countVisitsByDepartment(getActiveVisits());
}

/** Visits whose patient is still flagged as an anonymous emergency. */
export function getAnonymousVisits(): Visit[] {
  const db = loadScoped();
  const anonymousPatientIds = new Set(
    db.patients.filter((p) => p.is_emergency_anonymous).map((p) => p.id)
  );
  return db.visits.filter((v) => anonymousPatientIds.has(v.patient_id));
}

// ---------------------------------------------------------------------------
// Read queries — clinical record (hang off a visit)
// ---------------------------------------------------------------------------

export function getConsultationsForVisit(visitId: VisitId): Consultation[] {
  return loadScoped()
    .consultations.filter((c) => c.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getDiagnosesForVisit(visitId: VisitId): Diagnosis[] {
  return loadScoped()
    .diagnoses.filter((d) => d.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getOrdersForVisit(visitId: VisitId): Order[] {
  return loadScoped()
    .orders.filter((o) => o.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getResultsForOrder(orderId: OrderId): Result[] {
  return loadScoped()
    .results.filter((r) => r.order_id === orderId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/** All results recorded against any order belonging to a visit. */
export function getResultsForVisit(visitId: VisitId): Result[] {
  const db = loadScoped();
  const orderIds = new Set(
    db.orders.filter((o) => o.visit_id === visitId).map((o) => o.id)
  );
  return db.results
    .filter((r) => orderIds.has(r.order_id))
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/**
 * The diagnostics work queue — every order still awaiting a result
 * ("requested" or "in_progress"), oldest first so the longest-waiting test is
 * actioned next. Optionally narrowed to a single order type (lab / imaging).
 */
export function getOpenOrders(orderType?: OrderType): Order[] {
  return loadScoped()
    .orders.filter(
      (o) =>
        (o.status === "requested" || o.status === "in_progress") &&
        (orderType ? o.order_type === orderType : true)
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getPrescriptionsForVisit(visitId: VisitId): Prescription[] {
  return loadScoped()
    .prescriptions.filter((p) => p.visit_id === visitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getMedicationAdministrationsForPrescription(
  prescriptionId: PrescriptionId
): MedicationAdministration[] {
  return loadScoped()
    .medicationAdministrations.filter((m) => m.prescription_id === prescriptionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Every active prescription belonging to a still-open visit — the working set
 * for the nurse Medication Administration Record (MAR). Oldest first so a stable
 * order; the MAR view re-sorts by dose urgency. Optionally narrowed to a single
 * department (for the per-unit / shift-handover view).
 */
export function getActivePrescriptions(
  departmentId?: DepartmentId | null
): Prescription[] {
  const db = loadScoped();
  const openVisitIds = new Set(
    db.visits
      .filter(
        (v) =>
          v.status === "open" &&
          (!departmentId ||
            departmentId === ALL_DEPARTMENTS ||
            v.department_id === departmentId)
      )
      .map((v) => v.id)
  );
  return db.prescriptions
    .filter((p) => p.status === "active" && openVisitIds.has(p.visit_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getTreatmentRecordsForVisit(visitId: VisitId): TreatmentRecord[] {
  return loadScoped()
    .treatmentRecords.filter((r) => r.visit_id === visitId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

// ---------------------------------------------------------------------------
// Read queries — admissions (inpatient only)
// ---------------------------------------------------------------------------

export function getAdmissions(): Admission[] {
  return loadScoped().admissions;
}

export function getAdmissionById(id: AdmissionId): Admission | undefined {
  return loadScoped().admissions.find((a) => a.id === id);
}

/** The admission for a visit, if it became an inpatient stay. */
export function getAdmissionForVisit(visitId: VisitId): Admission | undefined {
  return loadScoped().admissions.find((a) => a.visit_id === visitId);
}

/** Admissions still occupying a bed (status "active"). */
export function getActiveAdmissions(): Admission[] {
  return loadScoped()
    .admissions.filter((a) => a.status === "active")
    .sort((a, b) => b.admitted_at.localeCompare(a.admitted_at));
}

/** The move history for an admission, most recent first. */
export function getTransfersForAdmission(admissionId: AdmissionId): Transfer[] {
  return loadScoped()
    .transfers.filter((t) => t.admission_id === admissionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The move history for a patient across all admissions, most recent first. */
export function getTransfersForPatient(patientId: PatientId): Transfer[] {
  return loadScoped()
    .transfers.filter((t) => t.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Reads — nursing care plan
// ---------------------------------------------------------------------------

/** Care-plan needs for an admission. Active first, then by creation order. */
export function getCarePlanItemsForAdmission(
  admissionId: AdmissionId
): CarePlanItem[] {
  return loadScoped()
    .carePlanItems.filter((i) => i.admission_id === admissionId)
    .sort((a, b) => {
      // Active needs lead; within a status, oldest-first keeps the plan stable.
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });
}

/** The care log + handover notes for an admission, most recent first. */
export function getCarePlanEntriesForAdmission(
  admissionId: AdmissionId
): CarePlanEntry[] {
  return loadScoped()
    .carePlanEntries.filter((e) => e.admission_id === admissionId)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

/**
 * The currently admitted patients a nurse manages a care plan for: each active
 * admission joined to its visit, patient, ward and bed, plus the count of active
 * care needs and whether a handover note is waiting. Sorted by ward then bed so
 * the list reads like a ward round.
 */
export interface CarePlanPatient {
  admission: Admission;
  visit: Visit | undefined;
  patient: Patient | undefined;
  ward: Ward | undefined;
  bed: Bed | undefined;
  activeNeeds: number;
  /** The most recent handover note, if any (drives the "handover waiting" cue). */
  latestHandover: CarePlanEntry | null;
}

export function getAdmittedPatientsForCarePlan(): CarePlanPatient[] {
  const db = loadScoped();
  return db.admissions
    .filter((a) => a.status === "active")
    .map((admission) => {
      const visit = db.visits.find((v) => v.id === admission.visit_id);
      const patient = db.patients.find((p) => p.id === admission.patient_id);
      const ward = admission.ward_id
        ? db.wards.find((w) => w.id === admission.ward_id)
        : undefined;
      const bed = admission.bed_id
        ? db.beds.find((b) => b.id === admission.bed_id)
        : undefined;
      const activeNeeds = db.carePlanItems.filter(
        (i) => i.admission_id === admission.id && i.status === "active"
      ).length;
      const latestHandover =
        db.carePlanEntries
          .filter((e) => e.admission_id === admission.id && e.is_handover)
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
      return { admission, visit, patient, ward, bed, activeNeeds, latestHandover };
    })
    .sort((a, b) => {
      const wardCmp = (a.ward?.name ?? "").localeCompare(b.ward?.name ?? "");
      if (wardCmp !== 0) return wardCmp;
      return (a.bed?.label ?? "").localeCompare(b.bed?.label ?? "");
    });
}

// ---------------------------------------------------------------------------
// Whole-collection reads — used by the reporting/analytics layer, which needs
// every row (not just the per-visit/per-patient slices above) to aggregate.
// ---------------------------------------------------------------------------

export function getAllDiagnoses(): Diagnosis[] {
  return loadScoped().diagnoses;
}

export function getAllResults(): Result[] {
  return loadScoped().results;
}

export function getAllTreatmentRecords(): TreatmentRecord[] {
  return loadScoped().treatmentRecords;
}

export function getAllTransfers(): Transfer[] {
  return loadScoped().transfers;
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export interface WardOccupancy {
  ward: Ward;
  total: number;
  occupied: number;
  free: number;
}

/** Per-ward bed occupancy, mirroring the `ward_occupancy` SQL view. Pure. */
export function computeWardOccupancy(wards: Ward[], beds: Bed[]): WardOccupancy[] {
  return wards.map((ward) => {
    const wardBeds = beds.filter((b) => b.ward_id === ward.id);
    const occupied = wardBeds.filter(
      (b) => b.status === "occupied" || b.status === "reserved"
    ).length;
    return {
      ward,
      total: wardBeds.length,
      occupied,
      free: wardBeds.length - occupied,
    };
  });
}

export function getWardOccupancy(): WardOccupancy[] {
  const db = loadScoped();
  return computeWardOccupancy(db.wards, db.beds);
}

// ---------------------------------------------------------------------------
// Mutations — registration / intake
// ---------------------------------------------------------------------------

/**
 * Register a patient and open their first visit in a single operation. Assigns a
 * permanent MRN (`CF-YYYY-NNNNNN`). For emergency anonymous intakes an anonymous
 * identifier is generated if the caller did not supply one.
 */
// ---------------------------------------------------------------------------
// Mutations — departments (admin management)
// ---------------------------------------------------------------------------

/** Register a new department. Returns the created record. */
export function createDepartment(input: CreateDepartmentInput): Department {
  const db = loadDatabase();
  const timestamp = nowISO();
  const department: Department = {
    id: generateId(),
    hospital_id: tenantId(db),
    name: input.name.trim(),
    code: input.code?.trim() || null,
    description: input.description?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.departments.push(department);
  persist(db);
  return department;
}

/** Patch an existing department (name / code / description / active flag). */
export function updateDepartment(
  id: DepartmentId,
  patch: UpdateDepartmentInput
): Department {
  const db = loadDatabase();
  const department = db.departments.find((d) => d.id === id);
  if (!department) {
    throw new Error(`updateDepartment: department "${id}" not found`);
  }
  if (patch.name !== undefined) department.name = patch.name.trim();
  if (patch.code !== undefined) department.code = patch.code?.trim() || null;
  if (patch.description !== undefined)
    department.description = patch.description?.trim() || null;
  if (patch.is_active !== undefined) department.is_active = patch.is_active;
  department.updated_at = nowISO();
  persist(db);
  return department;
}

/** Toggle a department's active flag (soft archive — never hard-deleted). */
export function setDepartmentActive(
  id: DepartmentId,
  isActive: boolean
): Department {
  return updateDepartment(id, { is_active: isActive });
}

// ---------------------------------------------------------------------------
// Mutations — wards & beds (admin floor map)
// ---------------------------------------------------------------------------

/**
 * Next "Bed N" labels continuing past the highest existing numeric label, so
 * appended beds never collide. Private mirror of the UI's `nextBedLabels`.
 */
function nextBedLabelsInternal(existing: string[], count: number): string[] {
  let max = 0;
  for (const label of existing) {
    const m = label.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  const labels: string[] = [];
  for (let i = 1; i <= Math.max(0, Math.floor(count)); i++) {
    labels.push(`Bed ${max + i}`);
  }
  return labels;
}

function makeBed(
  wardId: WardId,
  label: string,
  timestamp: string,
  hospitalId: HospitalId,
): Bed {
  return {
    id: generateId(),
    hospital_id: hospitalId,
    ward_id: wardId,
    label,
    status: "free",
    current_admission_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** Create a ward, optionally pre-filling it with `bed_count` free beds. */
export function createWard(input: CreateWardInput): Ward {
  const db = loadDatabase();
  const timestamp = nowISO();
  const ward: Ward = {
    id: generateId(),
    hospital_id: tenantId(db),
    department_id: input.department_id ?? null,
    name: input.name.trim(),
    floor_label: input.floor_label?.trim() || null,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.wards.push(ward);

  for (const label of nextBedLabelsInternal([], input.bed_count ?? 0)) {
    db.beds.push(makeBed(ward.id, label, timestamp, ward.hospital_id));
  }

  persist(db);
  return ward;
}

/** Patch a ward (name / department / floor / active flag). */
export function updateWard(id: WardId, patch: UpdateWardInput): Ward {
  const db = loadDatabase();
  const ward = db.wards.find((w) => w.id === id);
  if (!ward) throw new Error(`updateWard: ward "${id}" not found`);
  if (patch.name !== undefined) ward.name = patch.name.trim();
  if (patch.department_id !== undefined) {
    ward.department_id = patch.department_id ?? null;
  }
  if (patch.floor_label !== undefined) {
    ward.floor_label = patch.floor_label?.trim() || null;
  }
  if (patch.is_active !== undefined) ward.is_active = patch.is_active;
  ward.updated_at = nowISO();
  persist(db);
  return ward;
}

/** Soft-archive / restore a ward (never hard-deleted). */
export function setWardActive(id: WardId, isActive: boolean): Ward {
  return updateWard(id, { is_active: isActive });
}

/** Append `count` new free beds to a ward, continuing its numbering. */
export function addBedsToWard(wardId: WardId, count: number): Bed[] {
  const db = loadDatabase();
  const ward = db.wards.find((w) => w.id === wardId);
  if (!ward) throw new Error(`addBedsToWard: ward "${wardId}" not found`);
  const timestamp = nowISO();
  const existing = db.beds
    .filter((b) => b.ward_id === wardId)
    .map((b) => b.label);
  const created = nextBedLabelsInternal(existing, count).map((label) =>
    makeBed(wardId, label, timestamp, ward.hospital_id)
  );
  db.beds.push(...created);
  persist(db);
  return created;
}

/** Rename a bed or set a manual status (free / cleaning / maintenance / reserved). */
export function updateBed(bedId: BedId, patch: UpdateBedInput): Bed {
  const db = loadDatabase();
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) throw new Error(`updateBed: bed "${bedId}" not found`);
  if (bed.current_admission_id && patch.status !== undefined) {
    throw new Error(
      "Cannot change the status of a bed that holds a patient — discharge or transfer first"
    );
  }
  if (patch.label !== undefined) bed.label = patch.label.trim();
  if (patch.status !== undefined) bed.status = patch.status;
  bed.updated_at = nowISO();
  persist(db);
  return bed;
}

/** Permanently remove a bed — only allowed when it holds no patient. */
export function removeBed(bedId: BedId): void {
  const db = loadDatabase();
  const bed = db.beds.find((b) => b.id === bedId);
  if (!bed) throw new Error(`removeBed: bed "${bedId}" not found`);
  if (bed.status === "occupied" || bed.current_admission_id) {
    throw new Error("Cannot remove a bed that holds a patient");
  }
  db.beds = db.beds.filter((b) => b.id !== bedId);
  persist(db);
}

/**
 * Move an active admission to a new ward, bed, and/or attending doctor, logging
 * the change as an append-only Transfer event. Frees the previously-occupied bed
 * and occupies the new one (mirrors the `sync_bed_occupancy` trigger on a bed
 * change). A provided bed implies its ward unless a ward is given explicitly.
 *
 * `undefined` on a field means "leave unchanged"; an explicit `null` clears it.
 * Throws if the admission is not active or the target bed is taken by someone
 * else. Also used for the initial bed assignment of a bedless admission.
 */
export function transferAdmission(
  admissionId: AdmissionId,
  input: TransferAdmissionInput
): { admission: Admission; transfer: Transfer } {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`transferAdmission: admission "${admissionId}" not found`);
  }
  if (admission.status !== "active") {
    throw new Error("Cannot transfer a discharged admission");
  }

  const timestamp = nowISO();
  const fromWard = admission.ward_id;
  const fromBed = admission.bed_id;
  const fromDoctor = admission.attending_doctor_id;

  const bedProvided = input.to_bed_id !== undefined;
  const toBed = bedProvided ? input.to_bed_id ?? null : fromBed;
  const toDoctor =
    input.to_doctor_id !== undefined ? input.to_doctor_id : fromDoctor;
  let toWard: WardId | null;
  if (input.to_ward_id !== undefined) {
    toWard = input.to_ward_id;
  } else if (bedProvided && toBed) {
    toWard = db.beds.find((b) => b.id === toBed)?.ward_id ?? fromWard;
  } else {
    toWard = fromWard;
  }

  // Validate the target bed before mutating anything.
  if (toBed && toBed !== fromBed) {
    const target = db.beds.find((b) => b.id === toBed);
    if (!target) throw new Error(`transferAdmission: bed "${toBed}" not found`);
    if (
      target.current_admission_id &&
      target.current_admission_id !== admissionId
    ) {
      throw new Error("Target bed is already occupied");
    }
  }

  // Free the old bed when the bed changed.
  if (fromBed && fromBed !== toBed) {
    const old = db.beds.find((b) => b.id === fromBed);
    if (old) {
      old.status = "free";
      old.current_admission_id = null;
      old.updated_at = timestamp;
    }
  }
  // Occupy the new bed.
  if (toBed && toBed !== fromBed) {
    const next = db.beds.find((b) => b.id === toBed);
    if (next) {
      next.status = "occupied";
      next.current_admission_id = admissionId;
      next.updated_at = timestamp;
    }
  }

  admission.ward_id = toWard;
  admission.bed_id = toBed;
  admission.attending_doctor_id = toDoctor ?? null;
  admission.updated_at = timestamp;

  // Keep the visit's attending doctor in lock-step on a doctor change.
  if (toDoctor !== fromDoctor) {
    const visit = db.visits.find((v) => v.id === admission.visit_id);
    if (visit) {
      visit.attending_doctor_id = toDoctor ?? null;
      visit.updated_at = timestamp;
    }
  }

  const transfer: Transfer = {
    id: generateId(),
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    patient_id: admission.patient_id,
    from_ward_id: fromWard,
    to_ward_id: toWard,
    from_bed_id: fromBed,
    to_bed_id: toBed,
    from_doctor_id: fromDoctor,
    to_doctor_id: toDoctor ?? null,
    reason: input.reason?.trim() || null,
    transferred_by_id: input.transferred_by_id ?? null,
    created_at: timestamp,
  };
  db.transfers.push(transfer);

  persist(db);
  return { admission, transfer };
}

/** Assign a free bed to an admission that doesn't have one yet (logs a Transfer). */
export function assignBedToAdmission(
  admissionId: AdmissionId,
  bedId: BedId,
  byId: StaffId | null = null
): Admission {
  const { admission } = transferAdmission(admissionId, {
    to_bed_id: bedId,
    reason: "Bed assignment",
    transferred_by_id: byId,
  });
  return admission;
}

// ---------------------------------------------------------------------------
// Mutations — nursing care plan
// ---------------------------------------------------------------------------

/** Add a care need to an admission's plan. Returns the created item. */
export function addCarePlanItem(
  admissionId: AdmissionId,
  input: AddCarePlanItemInput
): CarePlanItem {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`addCarePlanItem: admission "${admissionId}" not found`);
  }
  const timestamp = nowISO();
  const item: CarePlanItem = {
    id: generateId(),
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    patient_id: admission.patient_id,
    category: input.category,
    description: input.description.trim(),
    frequency: input.frequency?.trim() || null,
    goal: input.goal?.trim() || null,
    status: "active",
    created_by_id: input.created_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.carePlanItems.push(item);
  persist(db);
  return item;
}

/** Mark a care need as resolved (kept on the record, not deleted). */
export function resolveCarePlanItem(itemId: CarePlanItemId): CarePlanItem {
  const db = loadDatabase();
  const item = db.carePlanItems.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`resolveCarePlanItem: item "${itemId}" not found`);
  }
  item.status = "resolved";
  item.updated_at = nowISO();
  persist(db);
  return item;
}

/**
 * Append a care-log note or a shift-handover message to an admission. Append-only
 * (never overwritten), mirroring transfers — so the handover trail is durable.
 */
export function addCarePlanEntry(
  admissionId: AdmissionId,
  input: AddCarePlanEntryInput
): CarePlanEntry {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(`addCarePlanEntry: admission "${admissionId}" not found`);
  }
  const entry: CarePlanEntry = {
    id: generateId(),
    hospital_id: admission.hospital_id,
    admission_id: admissionId,
    care_plan_item_id: input.care_plan_item_id ?? null,
    note: input.note.trim(),
    is_handover: input.is_handover ?? false,
    recorded_by_id: input.recorded_by_id ?? null,
    recorded_at: nowISO(),
  };
  db.carePlanEntries.push(entry);
  persist(db);
  return entry;
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
    id: generateId(),
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
        id: generateId(),
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
    id: generateId(),
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
    id: generateId(),
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

// ---------------------------------------------------------------------------
// Mutations — visits
// ---------------------------------------------------------------------------

export function createNewVisit(
  patientData: CreatePatientInput,
  visitData: CreateVisitInput
): { patient: Patient; visit: Visit } {
  const db = loadDatabase();
  const timestamp = nowISO();

  const isAnonymous = patientData.is_emergency_anonymous ?? false;
  const anonymousIdentifier = isAnonymous
    ? patientData.anonymous_identifier ?? generateAnonymousIdentifier()
    : null;

  // Anonymous emergency records get no patient ID until reconciliation supplies
  // real identity details; everyone else gets a Cameroon booklet ID derived from
  // birth date + name initials + mother's initial, de-duplicated against peers.
  const mrn = isAnonymous
    ? ""
    : uniquePatientId(
        generatePatientId(
          patientData.date_of_birth ?? null,
          patientData.full_name,
          patientData.mother_first_name ?? null,
        ),
        db.patients.map((p) => p.mrn),
      );

  const patient: Patient = {
    id: generateId(),
    hospital_id: tenantId(db),
    mrn,
    full_name: patientData.full_name,
    date_of_birth: patientData.date_of_birth ?? null,
    sex: patientData.sex ?? "unknown",
    phone: patientData.phone ?? null,
    address: patientData.address ?? null,
    national_id: patientData.national_id ?? null,
    mother_first_name: patientData.mother_first_name ?? null,
    is_emergency_anonymous: isAnonymous,
    anonymous_identifier: anonymousIdentifier,
    no_known_allergies: false,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const visit: Visit = {
    id: generateId(),
    hospital_id: patient.hospital_id,
    patient_id: patient.id,
    visit_type: visitData.visit_type,
    status: "open",
    stage: visitData.stage ?? "registration",
    department_id: visitData.department_id ?? null,
    attending_doctor_id: visitData.attending_doctor_id ?? null,
    registered_by_id: visitData.registered_by_id ?? null,
    chief_complaint: visitData.chief_complaint ?? null,
    triage_notes: visitData.triage_notes ?? null,
    triage_level: visitData.triage_level ?? null,
    arrived_at: timestamp,
    closed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.patients.push(patient);
  db.visits.push(visit);
  persist(db);

  return { patient, visit };
}

// ---------------------------------------------------------------------------
// Mutations — clinical logging
// ---------------------------------------------------------------------------

/** Append a vitals / GCS checkpoint to a visit. */
export function addTreatmentLog(
  visitId: VisitId,
  logData: AddTreatmentLogInput
): TreatmentRecord {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addTreatmentLog: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const record: TreatmentRecord = {
    id: generateId(),
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    recorded_by_id: logData.recorded_by_id ?? null,
    spo2: logData.spo2 ?? null,
    pulse: logData.pulse ?? null,
    bp_systolic: logData.bp_systolic ?? null,
    bp_diastolic: logData.bp_diastolic ?? null,
    temperature_c: logData.temperature_c ?? null,
    weight_kg: logData.weight_kg ?? null,
    gcs_score: logData.gcs_score ?? null,
    notes: logData.notes ?? null,
    recorded_at: logData.recorded_at ?? timestamp,
  };

  db.treatmentRecords.push(record);

  // Touch the parent visit so consumers see fresh activity.
  visit.updated_at = timestamp;
  persist(db);

  return record;
}

// ---------------------------------------------------------------------------
// Mutations — clinical encounter (doctor consultation, Phase 8)
// ---------------------------------------------------------------------------

/**
 * Record a doctor's SOAP-style consultation note against a visit. Advances the
 * visit to the "consultation" stage if it has not progressed past triage yet, so
 * the encounter is reflected on the board. Returns the created consultation.
 */
export function addConsultation(
  visitId: VisitId,
  input: AddConsultationInput
): Consultation {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addConsultation: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const consultation: Consultation = {
    id: generateId(),
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    doctor_id: input.doctor_id ?? visit.attending_doctor_id ?? null,
    subjective: input.subjective?.trim() || null,
    examination: input.examination?.trim() || null,
    assessment: input.assessment?.trim() || null,
    plan: input.plan?.trim() || null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.consultations.push(consultation);

  // Surface the encounter on the board: a freshly-triaged patient who has just
  // been seen moves into "consultation".
  if (visit.stage === "registration" || visit.stage === "triage") {
    visit.stage = "consultation";
  }
  visit.updated_at = timestamp;

  persist(db);
  return consultation;
}

/**
 * Record a structured diagnosis against a visit (ICD-10 where known). Marking a
 * new diagnosis as primary demotes any existing primary for the same visit so
 * exactly one diagnosis is flagged primary at a time. Returns the created row.
 */
export function addDiagnosis(
  visitId: VisitId,
  input: AddDiagnosisInput
): Diagnosis {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addDiagnosis: visit "${visitId}" not found`);
  }
  const description = input.description.trim();
  if (!description) {
    throw new Error("addDiagnosis: a diagnosis description is required");
  }

  const isPrimary = input.is_primary ?? false;
  if (isPrimary) {
    for (const existing of db.diagnoses) {
      if (existing.visit_id === visitId && existing.is_primary) {
        existing.is_primary = false;
      }
    }
  }

  const timestamp = nowISO();
  const diagnosis: Diagnosis = {
    id: generateId(),
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    consultation_id: input.consultation_id ?? null,
    diagnosed_by_id: input.diagnosed_by_id ?? visit.attending_doctor_id ?? null,
    icd10_code: input.icd10_code?.trim() || null,
    description,
    is_primary: isPrimary,
    created_at: timestamp,
  };

  db.diagnoses.push(diagnosis);
  visit.updated_at = timestamp;
  persist(db);
  return diagnosis;
}

/**
 * Disposition — the doctor's end-of-consultation decision on where the patient
 * goes next. Modeled as an orchestration over the existing stage/admission
 * mutations (no new schema field) plus an audit note in the treatment record so
 * the choice is visible in history and survives a reload.
 */
export type Disposition =
  | "discharge_home"
  | "admit"
  | "observation"
  | "refer"
  | "deceased";

const DISPOSITION_PLAN: Record<
  Disposition,
  { note: string; stage: CareStage; admit: boolean }
> = {
  discharge_home: {
    note: "Disposition: Discharge home",
    stage: "discharge_planning",
    admit: false,
  },
  admit: {
    note: "Disposition: Admit to inpatient ward",
    stage: "treatment",
    admit: true,
  },
  observation: {
    note: "Disposition: Keep under observation",
    stage: "treatment",
    admit: false,
  },
  refer: {
    note: "Disposition: Refer to specialist / external facility",
    stage: "discharge_planning",
    admit: false,
  },
  // A death recorded at the consultation (e.g. brought in deceased / died during
  // the encounter). Terminal: closes the visit without admitting.
  deceased: {
    note: "Disposition: Patient deceased",
    stage: "deceased",
    admit: false,
  },
};

/**
 * Apply a disposition decision to a visit. For "admit" an inpatient admission is
 * created if one does not yet exist. The decision is logged as a treatment-record
 * note and the visit is moved to the corresponding care stage. Returns the visit.
 */
export function recordDisposition(
  visitId: VisitId,
  disposition: Disposition,
  decidedById?: StaffId | null
): Visit {
  const plan = DISPOSITION_PLAN[disposition];
  if (!plan) {
    throw new Error(`recordDisposition: unknown disposition "${disposition}"`);
  }

  if (plan.admit && !getAdmissionForVisit(visitId)) {
    createAdmissionForVisit(visitId, {
      attending_doctor_id: decidedById ?? null,
      stage: plan.stage,
    });
  }

  addTreatmentLog(visitId, {
    recorded_by_id: decidedById ?? null,
    notes: plan.note,
  });

  return updateVisitStage(visitId, plan.stage);
}

/**
 * Record that a patient died in care — a terminal outcome reachable at any
 * stage (not only at the consultation disposition). Logs a respectful,
 * timestamped audit note (with an optional cause/circumstances), then moves the
 * visit to the `deceased` terminal stage. Unlike a discharge this is never
 * blocked by pending clearances; `updateVisitStage` frees the bed and closes
 * the admission. Returns the closed visit.
 */
export function recordDeath(
  visitId: VisitId,
  recordedById?: StaffId | null,
  note?: string | null
): Visit {
  const detail = note?.trim();
  addTreatmentLog(visitId, {
    recorded_by_id: recordedById ?? null,
    notes: detail
      ? `Patient deceased — ${detail}`
      : "Patient deceased",
  });

  return updateVisitStage(visitId, "deceased");
}

// ---------------------------------------------------------------------------
// Mutations — orders & results (diagnostics loop, Phase 9)
// ---------------------------------------------------------------------------

/**
 * Order a diagnostic test (lab / imaging / procedure) against a visit. New
 * orders start "requested" and surface in the diagnostics queue. Ordering a
 * test nudges a still-in-consultation visit into the "diagnostics" stage so the
 * board reflects that a workup is pending. Returns the created order.
 */
export function addOrder(visitId: VisitId, input: AddOrderInput): Order {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addOrder: visit "${visitId}" not found`);
  }
  const description = input.description.trim();
  if (!description) {
    throw new Error("addOrder: an order description is required");
  }

  const timestamp = nowISO();
  const order: Order = {
    id: generateId(),
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    ordered_by_id: input.ordered_by_id ?? visit.attending_doctor_id ?? null,
    order_type: input.order_type,
    description,
    status: "requested",
    created_at: timestamp,
    completed_at: null,
    updated_at: timestamp,
  };

  db.orders.push(order);

  // A pending workup belongs in diagnostics — advance from consultation only.
  if (visit.stage === "consultation") {
    visit.stage = "diagnostics";
  }
  visit.updated_at = timestamp;

  persist(db);
  return order;
}

/**
 * Move an order along its lifecycle. Setting it "completed" stamps
 * `completed_at`; any other status clears it. Used by the lab tech to "start"
 * (in_progress) or cancel an order. Returns the updated order.
 */
export function updateOrderStatus(
  orderId: OrderId,
  status: OrderStatus
): Order {
  const db = loadDatabase();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error(`updateOrderStatus: order "${orderId}" not found`);
  }

  const timestamp = nowISO();
  order.status = status;
  order.completed_at = status === "completed" ? timestamp : null;
  order.updated_at = timestamp;

  persist(db);
  return order;
}

/**
 * Record a result against an order — the lab tech closing the loop. The parent
 * order is marked "completed" (with `completed_at`) so it leaves the queue and
 * the result surfaces back on the visit for doctor review. Returns the result.
 */
export function addResult(orderId: OrderId, input: AddResultInput): Result {
  const db = loadDatabase();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) {
    throw new Error(`addResult: order "${orderId}" not found`);
  }

  const timestamp = nowISO();
  const result: Result = {
    id: generateId() as ResultId,
    hospital_id: order.hospital_id,
    order_id: orderId,
    recorded_by_id: input.recorded_by_id ?? null,
    summary: input.summary?.trim() || null,
    value: input.value?.trim() || null,
    reference_range: input.reference_range?.trim() || null,
    is_abnormal: input.is_abnormal ?? false,
    attachment_path: input.attachment_path?.trim() || null,
    recorded_at: timestamp,
  };

  db.results.push(result);

  // Closing the loop: the order is now complete.
  order.status = "completed";
  order.completed_at = timestamp;
  order.updated_at = timestamp;

  persist(db);
  return result;
}

// ---------------------------------------------------------------------------
// Mutations — prescriptions & MAR (medication loop, Phase 10)
// ---------------------------------------------------------------------------

/**
 * Write a prescription against a visit — the doctor defining the *structure* of
 * the medication (drug, dose, route, frequency, duration, instructions). New
 * prescriptions are "active" and immediately generate doses on the nurse MAR.
 * `prescribed_by_id` falls back to the visit's attending doctor. Returns it.
 */
export function addPrescription(
  visitId: VisitId,
  input: AddPrescriptionInput
): Prescription {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`addPrescription: visit "${visitId}" not found`);
  }
  const drugName = input.drug_name.trim();
  if (!drugName) {
    throw new Error("addPrescription: a drug name is required");
  }

  const timestamp = nowISO();
  const prescription: Prescription = {
    id: generateId() as PrescriptionId,
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    prescribed_by_id: input.prescribed_by_id ?? visit.attending_doctor_id ?? null,
    drug_name: drugName,
    dose: input.dose?.trim() || null,
    route: input.route?.trim() || null,
    frequency: input.frequency?.trim() || null,
    duration: input.duration?.trim() || null,
    instructions: input.instructions?.trim() || null,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prescriptions.push(prescription);
  visit.updated_at = timestamp;
  persist(db);
  return prescription;
}

/**
 * Move a prescription along its lifecycle — the doctor/pharmacist marking it
 * "completed" (course finished) or "discontinued" (stopped early). An inactive
 * prescription stops generating doses on the MAR. Returns the updated row.
 */
export function updatePrescriptionStatus(
  prescriptionId: PrescriptionId,
  status: PrescriptionStatus
): Prescription {
  const db = loadDatabase();
  const prescription = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!prescription) {
    throw new Error(
      `updatePrescriptionStatus: prescription "${prescriptionId}" not found`
    );
  }
  prescription.status = status;
  prescription.updated_at = nowISO();
  persist(db);
  return prescription;
}

/**
 * Record a Medication Administration Record (MAR) entry — what actually
 * happened at the bedside for a scheduled dose: given / held / refused / missed,
 * by whom and when. This is how the next nurse knows what to give without going
 * back to the doctor, and the proof that care was delivered. For a "given" dose
 * `administered_at` defaults to now; for any other outcome it stays null unless
 * supplied. Returns the created record.
 */
export function recordMedicationAdministration(
  prescriptionId: PrescriptionId,
  input: RecordAdministrationInput
): MedicationAdministration {
  const db = loadDatabase();
  const prescription = db.prescriptions.find((p) => p.id === prescriptionId);
  if (!prescription) {
    throw new Error(
      `recordMedicationAdministration: prescription "${prescriptionId}" not found`
    );
  }

  const timestamp = nowISO();
  const administeredAt =
    input.administered_at !== undefined
      ? input.administered_at
      : input.status === "given"
        ? timestamp
        : null;

  const record: MedicationAdministration = {
    id: generateId() as MedicationAdministrationId,
    hospital_id: prescription.hospital_id,
    prescription_id: prescriptionId,
    administered_by_id: input.administered_by_id ?? null,
    scheduled_for: input.scheduled_for ?? timestamp,
    administered_at: administeredAt,
    status: input.status,
    notes: input.notes?.trim() || null,
    created_at: timestamp,
  };

  db.medicationAdministrations.push(record);

  // Touch the parent prescription so consumers see fresh activity.
  prescription.updated_at = timestamp;
  persist(db);
  return record;
}

// ---------------------------------------------------------------------------
// Mutations — allergies (patient-level safety record)
// ---------------------------------------------------------------------------

/**
 * Record an allergy against a patient. Recording any allergy clears the
 * "no known allergies" flag — the two states are mutually exclusive. Returns
 * the created record.
 */
export function addAllergy(
  patientId: PatientId,
  input: AddAllergyInput
): Allergy {
  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`addAllergy: patient "${patientId}" not found`);
  }
  const substance = input.substance.trim();
  if (!substance) {
    throw new Error("addAllergy: a substance is required");
  }

  const timestamp = nowISO();
  const allergy: Allergy = {
    id: generateId() as AllergyId,
    hospital_id: patient.hospital_id,
    patient_id: patientId,
    substance,
    category: input.category ?? "drug",
    severity: input.severity ?? "moderate",
    reaction: input.reaction?.trim() || null,
    noted_by_id: input.noted_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.allergies.push(allergy);
  // An actual allergy and "no known allergies" cannot coexist.
  patient.no_known_allergies = false;
  patient.updated_at = timestamp;
  persist(db);
  return allergy;
}

/** Remove an allergy record (e.g. entered in error). */
export function removeAllergy(allergyId: AllergyId): void {
  const db = loadDatabase();
  const allergy = db.allergies.find((a) => a.id === allergyId);
  if (!allergy) return;
  db.allergies = db.allergies.filter((a) => a.id !== allergyId);
  const patient = db.patients.find((p) => p.id === allergy.patient_id);
  if (patient) patient.updated_at = nowISO();
  persist(db);
}

/**
 * Mark a patient as having no known allergies — an active clinical confirmation,
 * distinct from an empty list that simply hasn't been asked. Clearing the flag
 * returns the patient to the "not yet assessed" state. Returns the patient.
 */
export function markNoKnownAllergies(
  patientId: PatientId,
  value = true
): Patient {
  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`markNoKnownAllergies: patient "${patientId}" not found`);
  }
  patient.no_known_allergies = value;
  patient.updated_at = nowISO();
  persist(db);
  return patient;
}

// ---------------------------------------------------------------------------
// Mutations — admissions (inpatient bed assignment + occupancy sync)
// ---------------------------------------------------------------------------

/**
 * Promote a visit to an inpatient admission, optionally assigning a bed. When a
 * bed is assigned it is flipped to "occupied" and back-references the admission
 * (mirrors the `sync_bed_occupancy` trigger).
 */
export function createAdmissionForVisit(
  visitId: VisitId,
  admissionData: CreateAdmissionInput = {}
): Admission {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`createAdmissionForVisit: visit "${visitId}" not found`);
  }

  const timestamp = nowISO();
  const admission: Admission = {
    id: generateId(),
    hospital_id: visit.hospital_id,
    visit_id: visitId,
    patient_id: visit.patient_id,
    attending_doctor_id:
      admissionData.attending_doctor_id ?? visit.attending_doctor_id ?? null,
    ward_id: admissionData.ward_id ?? null,
    bed_id: admissionData.bed_id ?? null,
    status: "active",
    stage: admissionData.stage ?? visit.stage,
    reason: admissionData.reason ?? visit.chief_complaint ?? null,
    is_medical_cleared: admissionData.is_medical_cleared ?? false,
    is_financial_cleared: admissionData.is_financial_cleared ?? false,
    is_pharmacy_ready: admissionData.is_pharmacy_ready ?? false,
    admitted_at: timestamp,
    discharged_at: null,
    updated_at: timestamp,
  };

  db.admissions.push(admission);

  if (admission.bed_id) {
    const bed = db.beds.find((b) => b.id === admission.bed_id);
    if (bed) {
      bed.status = "occupied";
      bed.current_admission_id = admission.id;
      bed.updated_at = timestamp;
    }
  }

  visit.visit_type = "inpatient";
  visit.updated_at = timestamp;
  persist(db);

  return admission;
}

/** Update any of the three multi-department clearance gates on an admission. */
export function updateAdmissionClearances(
  admissionId: AdmissionId,
  clearances: Partial<
    Pick<
      Admission,
      "is_medical_cleared" | "is_financial_cleared" | "is_pharmacy_ready"
    >
  >
): Admission {
  const db = loadDatabase();
  const admission = db.admissions.find((a) => a.id === admissionId);
  if (!admission) {
    throw new Error(
      `updateAdmissionClearances: admission "${admissionId}" not found`
    );
  }

  if (clearances.is_medical_cleared !== undefined) {
    admission.is_medical_cleared = clearances.is_medical_cleared;
  }
  if (clearances.is_financial_cleared !== undefined) {
    admission.is_financial_cleared = clearances.is_financial_cleared;
  }
  if (clearances.is_pharmacy_ready !== undefined) {
    admission.is_pharmacy_ready = clearances.is_pharmacy_ready;
  }
  admission.updated_at = nowISO();

  persist(db);
  return admission;
}

// ---------------------------------------------------------------------------
// Verification gate + discharge
// ---------------------------------------------------------------------------

/**
 * Verification gate (Phase 5). Determine whether an inpatient admission is
 * eligible to be discharged. Discharge is blocked until all three department
 * clearances are granted AND the patient is no longer an unreconciled anonymous
 * emergency record. Pure — safe to call from the UI to drive button state.
 *
 * `blockers` are i18n message keys (resolved with `t()` at the render site), not
 * display text, so the gate stays language-agnostic.
 */
export function evaluateDischargeReadiness(
  admission: Admission,
  patient: Patient
): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!admission.is_medical_cleared) blockers.push("drawer.blockerMedical");
  if (!admission.is_financial_cleared) blockers.push("drawer.blockerFinancial");
  if (!admission.is_pharmacy_ready) blockers.push("drawer.blockerPharmacy");
  if (patient.is_emergency_anonymous) {
    blockers.push("drawer.blockerReconcile");
  }
  return { ready: blockers.length === 0, blockers };
}

/**
 * Simulate the automated post-discharge follow-up transmissions a real system
 * would fire (SMS reminder, tele-check-in booking, summary dispatch). Logged to
 * the system console only — no real messages are sent.
 */
function logFollowUpTransmission(visit: Visit, patient?: Patient): void {
  const name =
    patient?.is_emergency_anonymous && patient.anonymous_identifier
      ? patient.anonymous_identifier
      : patient?.full_name ?? "Unknown patient";
  const followUpDate = new Date(Date.now() + 7 * 24 * 3600_000)
    .toISOString()
    .slice(0, 10);

  console.groupCollapsed(
    `[CareFlow ▸ Follow-Up Service] Post-discharge transmissions — ${name}`
  );
  console.info(`Discharge confirmed @ ${new Date().toLocaleString()}`);
  console.info(
    `SMS recovery reminder queued → ${patient?.phone ?? "registered contact"}`
  );
  console.info(`7-day tele-check-in scheduled for ${followUpDate}`);
  console.info(`Discharge summary dispatched to attending physician`);
  console.groupEnd();
}

/**
 * Move a visit to a new care stage.
 *
 * Reaching a terminal stage ("discharged"/"followed_up") closes the visit
 * (stamps `closed_at`, sets `status="closed"` so it drops off the active board),
 * and — for an inpatient visit with an admission — is gated: it throws unless
 * all clearances are granted and the patient is reconciled. A terminal
 * transition also discharges the admission, frees the bed, and fires the
 * simulated follow-up notification log.
 */
export function updateVisitStage(visitId: VisitId, newStage: CareStage): Visit {
  const db = loadDatabase();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) {
    throw new Error(`updateVisitStage: visit "${visitId}" not found`);
  }

  const patient = db.patients.find((p) => p.id === visit.patient_id);
  const admission = db.admissions.find((a) => a.visit_id === visitId);
  const becomingTerminal = isTerminalStage(newStage) && visit.status === "open";

  // Verification gate — block the final discharge transition until ready.
  // A death is exempt: recording a patient's death is never withheld over a
  // pending clearance (financial/pharmacy/medical) or an unreconciled identity.
  if (becomingTerminal && newStage !== "deceased" && admission && patient) {
    const { ready, blockers } = evaluateDischargeReadiness(admission, patient);
    if (!ready) {
      throw new Error(`Cannot discharge: ${blockers.join("; ")}`);
    }
  }

  const timestamp = nowISO();
  visit.stage = newStage;
  visit.updated_at = timestamp;

  if (becomingTerminal) {
    visit.status = "closed";
    visit.closed_at = timestamp;

    if (admission) {
      admission.status = "discharged";
      admission.stage = newStage;
      admission.discharged_at = timestamp;
      admission.updated_at = timestamp;

      // Free the bed the admission occupied.
      if (admission.bed_id) {
        const bed = db.beds.find((b) => b.id === admission.bed_id);
        if (bed) {
          bed.status = "free";
          bed.current_admission_id = null;
          bed.updated_at = timestamp;
        }
      }
    }
  } else if (admission) {
    // Keep the admission stage in lock-step while the patient is on the floor.
    admission.stage = newStage;
    admission.updated_at = timestamp;
  }

  persist(db);

  // Fire the simulated post-discharge follow-up — but never for a death.
  if (becomingTerminal && newStage !== "deceased") {
    logFollowUpTransmission(visit, patient);
  }

  return visit;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Real identity details captured when an anonymous record is reconciled. */
export interface CompleteAnonymousInput {
  full_name: string;
  sex?: Patient["sex"];
  date_of_birth?: string | null;
  phone?: string | null;
  national_id?: string | null;
  mother_first_name?: string | null;
}

/**
 * Give an unidentified emergency patient their real identity in place — the
 * common case where the unconscious arrival turns out to be a brand-new patient.
 *
 * Unlike {@link reconcileAnonymousProfile} (which folds the record into an
 * already-registered patient), this keeps the same Patient row — so every visit,
 * admission and clinical record stays attached untouched — and simply fills in
 * the real details, mints the Cameroon patient ID, and flips the record from
 * anonymous to verified. Accepts either the anonymous Patient.id or its
 * `anonymous_identifier`.
 */
export function completeAnonymousProfile(
  anonymousId: PatientId | string,
  details: CompleteAnonymousInput
): Patient {
  const db = loadDatabase();

  const patient = db.patients.find(
    (p) =>
      p.is_emergency_anonymous &&
      (p.id === anonymousId || p.anonymous_identifier === anonymousId)
  );
  if (!patient) {
    throw new Error(
      `completeAnonymousProfile: anonymous patient "${anonymousId}" not found`
    );
  }

  patient.full_name = details.full_name;
  patient.sex = details.sex ?? patient.sex;
  patient.date_of_birth = details.date_of_birth ?? null;
  patient.phone = details.phone ?? null;
  patient.national_id = details.national_id ?? null;
  patient.mother_first_name = details.mother_first_name ?? null;
  // Now a verified record: mint the human-facing patient ID and drop the
  // anonymous tracking tag.
  patient.is_emergency_anonymous = false;
  patient.anonymous_identifier = null;
  patient.mrn = uniquePatientId(
    generatePatientId(
      patient.date_of_birth,
      patient.full_name,
      patient.mother_first_name
    ),
    db.patients.filter((p) => p.id !== patient.id).map((p) => p.mrn)
  );
  patient.updated_at = nowISO();

  persist(db);
  return patient;
}

/**
 * Merge an unidentified emergency patient into a verified permanent profile.
 *
 * The anonymous patient's visits and admissions (and, transitively, their
 * clinical records, which key off the visit) are re-pointed at the real patient.
 * The anonymous placeholder record is then removed. Accepts either the anonymous
 * Patient.id or its `anonymous_identifier`.
 */
export function reconcileAnonymousProfile(
  anonymousId: PatientId | string,
  realPatientId: PatientId
): { patient: Patient; reassignedVisits: Visit[] } {
  const db = loadDatabase();

  const anonymous = db.patients.find(
    (p) =>
      p.is_emergency_anonymous &&
      (p.id === anonymousId || p.anonymous_identifier === anonymousId)
  );
  if (!anonymous) {
    throw new Error(
      `reconcileAnonymousProfile: anonymous patient "${anonymousId}" not found`
    );
  }

  const realPatient = db.patients.find((p) => p.id === realPatientId);
  if (!realPatient) {
    throw new Error(
      `reconcileAnonymousProfile: target patient "${realPatientId}" not found`
    );
  }

  const timestamp = nowISO();

  // Re-point the anonymous patient's visits to the verified profile. The
  // clinical record (consultations, vitals, etc.) follows automatically since it
  // keys off visit_id.
  const reassignedVisits: Visit[] = [];
  for (const visit of db.visits) {
    if (visit.patient_id === anonymous.id) {
      visit.patient_id = realPatient.id;
      visit.updated_at = timestamp;
      reassignedVisits.push(visit);
    }
  }

  // Re-point admissions too (they carry their own patient_id).
  for (const admission of db.admissions) {
    if (admission.patient_id === anonymous.id) {
      admission.patient_id = realPatient.id;
      admission.updated_at = timestamp;
    }
  }

  // Carry any allergies recorded under the placeholder onto the real profile.
  for (const allergy of db.allergies) {
    if (allergy.patient_id === anonymous.id) {
      allergy.patient_id = realPatient.id;
      allergy.updated_at = timestamp;
    }
  }

  // Re-point transfer history (it carries its own patient_id).
  for (const transfer of db.transfers) {
    if (transfer.patient_id === anonymous.id) {
      transfer.patient_id = realPatient.id;
    }
  }

  // Standard registration always assigns the verified profile a patient ID, but
  // if reconciliation ever targets a record that lacks one, mint it now from the
  // identity details that the merge just confirmed.
  if (!realPatient.mrn) {
    realPatient.mrn = uniquePatientId(
      generatePatientId(
        realPatient.date_of_birth ?? null,
        realPatient.full_name,
        realPatient.mother_first_name ?? null,
      ),
      db.patients.filter((p) => p.id !== realPatient.id).map((p) => p.mrn),
    );
  }

  realPatient.updated_at = timestamp;

  // Drop the anonymous placeholder now that its clinical history is merged.
  db.patients = db.patients.filter((p) => p.id !== anonymous.id);

  persist(db);
  return { patient: realPatient, reassignedVisits };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Wipe and re-seed the store. Useful during testing/demoing. */
export function resetDatabase(): Database {
  const seeded = seedDatabaseObject();
  // A fresh seed is not a set of user mutations and there is nothing to upload
  // for it, so don't track it — and discard any changes still queued from the
  // store we just threw away.
  clearOutbox();
  persist(seeded, { track: false });
  return seeded;
}

// ---------------------------------------------------------------------------
// Seed data — a small but complete hospital: departments, wards/beds, staff
// across all six roles, patients with MRNs, and realistic outpatient, inpatient
// and emergency visits carrying consultations, diagnoses, orders/results,
// prescriptions, MAR entries and vitals — one visit per active board column,
// including an unconscious anonymous ICU patient.
// ---------------------------------------------------------------------------

function seedDatabaseObject(): Database {
  // Anchor seed timestamps around the current clinical day.
  const day = (offsetHours: number) =>
    new Date(Date.now() - offsetHours * 3600_000).toISOString();

  const hospitals: Hospital[] = [
    {
      id: DEMO_HOSPITAL_ID,
      name: "Douala General Hospital",
      region: "Littoral — Douala",
      contact_email: "contact@dgh.cm",
      contact_phone: "+237 6 55 00 00 00",
      subscription_tier: "standard",
      subscription_status: "active",
      created_at: day(8760),
      updated_at: day(8760),
    },
  ];

  const departments: Seed<Department>[] = [
    { id: "dept_emergency", name: "Emergency", code: "EMG", description: "Emergency & trauma", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_medicine", name: "Internal Medicine", code: "MED", description: "General internal medicine", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_surgery", name: "Surgery", code: "SUR", description: "General & specialist surgery", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_icu", name: "Intensive Care", code: "ICU", description: "Critical care unit", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_lab", name: "Laboratory", code: "LAB", description: "Pathology & diagnostics", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_pharmacy", name: "Pharmacy", code: "PHA", description: "Dispensary", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_admin", name: "Administration", code: "ADM", description: "Front desk & records", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const wards: Seed<Ward>[] = [
    { id: "ward_icu", department_id: "dept_icu", name: "ICU", floor_label: "3rd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_medb", department_id: "dept_medicine", name: "Medical Ward B", floor_label: "2nd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_er", department_id: "dept_emergency", name: "Emergency Bays", floor_label: "Ground Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const beds: Seed<Bed>[] = [
    { id: "bed_icu_02", ward_id: "ward_icu", label: "ICU-02", status: "occupied", current_admission_id: "adm_anon_gamma", created_at: day(8760), updated_at: day(5) },
    { id: "bed_icu_04", ward_id: "ward_icu", label: "ICU-04", status: "occupied", current_admission_id: "adm_idris", created_at: day(8760), updated_at: day(28) },
    { id: "bed_icu_01", ward_id: "ward_icu", label: "ICU-01", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_11", ward_id: "ward_medb", label: "B-11", status: "occupied", current_admission_id: "adm_bello", created_at: day(8760), updated_at: day(96) },
    { id: "bed_medb_09", ward_id: "ward_medb", label: "B-09", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_10", ward_id: "ward_medb", label: "B-10", status: "cleaning", current_admission_id: null, created_at: day(8760), updated_at: day(30) },
    { id: "bed_er_1", ward_id: "ward_er", label: "ER-Bay-1", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_er_2", ward_id: "ward_er", label: "ER-Bay-2", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
  ];

  const staff: Seed<Staff>[] = [
    { id: "staff_okafor", user_id: null, full_name: "Dr. A. Okafor", role: "doctor", department_id: "dept_medicine", email: "a.okafor@generalhospital.med", phone: "+233 20 555 0010", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_chen", user_id: null, full_name: "Dr. M. Chen", role: "doctor", department_id: "dept_surgery", email: "m.chen@generalhospital.med", phone: "+233 20 555 0011", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_patel", user_id: null, full_name: "Nurse J. Patel", role: "nurse", department_id: "dept_icu", email: "j.patel@generalhospital.med", phone: "+233 20 555 0012", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_romero", user_id: null, full_name: "Nurse L. Romero", role: "nurse", department_id: "dept_emergency", email: "l.romero@generalhospital.med", phone: "+233 20 555 0013", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_boateng", user_id: null, full_name: "K. Boateng", role: "lab_tech", department_id: "dept_lab", email: "k.boateng@generalhospital.med", phone: "+233 20 555 0014", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_eze", user_id: null, full_name: "T. Eze", role: "pharmacist", department_id: "dept_pharmacy", email: "t.eze@generalhospital.med", phone: "+233 20 555 0015", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_adebayo", user_id: null, full_name: "R. Adebayo", role: "receptionist", department_id: "dept_admin", email: "r.adebayo@generalhospital.med", phone: "+233 20 555 0016", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_quartey", user_id: null, full_name: "S. Quartey", role: "admin", department_id: "dept_admin", email: "s.quartey@generalhospital.med", phone: "+233 20 555 0017", is_active: true, created_at: day(8760), updated_at: day(8760) },
    // Additional clinicians — give the workload / throughput reports real spread.
    { id: "staff_adeyemi", user_id: null, full_name: "Dr. F. Adeyemi", role: "doctor", department_id: "dept_medicine", email: "f.adeyemi@generalhospital.med", phone: "+233 20 555 0018", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_nwosu", user_id: null, full_name: "Dr. P. Nwosu", role: "doctor", department_id: "dept_surgery", email: "p.nwosu@generalhospital.med", phone: "+233 20 555 0019", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_asante", user_id: null, full_name: "Dr. C. Asante", role: "doctor", department_id: "dept_emergency", email: "c.asante@generalhospital.med", phone: "+233 20 555 0020", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_okonkwo", user_id: null, full_name: "Dr. R. Okonkwo", role: "doctor", department_id: "dept_icu", email: "r.okonkwo@generalhospital.med", phone: "+233 20 555 0021", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_tetteh", user_id: null, full_name: "Nurse G. Tetteh", role: "nurse", department_id: "dept_medicine", email: "g.tetteh@generalhospital.med", phone: "+233 20 555 0022", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_yeboah", user_id: null, full_name: "Nurse H. Yeboah", role: "nurse", department_id: "dept_surgery", email: "h.yeboah@generalhospital.med", phone: "+233 20 555 0023", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const patients: Seed<Patient>[] = [
    { id: "pat_mensah", mrn: "890314GM - A", full_name: "Grace Mensah", date_of_birth: "1989-03-14", sex: "female", phone: "+233 20 555 0142", address: "12 Ring Rd, Accra", national_id: "GHA-8841203", mother_first_name: "Akosua", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(3), updated_at: day(3) },
    { id: "pat_idris", mrn: "721102SI - F", full_name: "Samuel Idris", date_of_birth: "1972-11-02", sex: "male", phone: "+234 80 555 0199", address: "5 Awolowo St, Lagos", national_id: "NGA-5520117", mother_first_name: "Fatima", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(28), updated_at: day(6) },
    { id: "pat_anon_gamma", mrn: "", full_name: "Unidentified Patient", date_of_birth: null, sex: "unknown", phone: null, address: null, national_id: null, mother_first_name: null, is_emergency_anonymous: true, anonymous_identifier: "John Doe - Gamma - 20260531", no_known_allergies: false, created_at: day(5), updated_at: day(1) },
    { id: "pat_bello", mrn: "950721AB - H", full_name: "Aisha Bello", date_of_birth: "1995-07-21", sex: "female", phone: "+234 70 555 0173", address: "8 Marina Rd, Lagos", national_id: "NGA-7790455", mother_first_name: "Hauwa", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: true, created_at: day(96), updated_at: day(12) },
    { id: "pat_owusu", mrn: "600109DO - A", full_name: "Daniel Owusu", date_of_birth: "1960-01-09", sex: "male", phone: "+233 24 555 0166", address: "30 Cantonments, Accra", national_id: "GHA-3310928", mother_first_name: "Abena", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(720), updated_at: day(2) },
  ];

  // Mensah & Idris carry documented allergies; Bello is confirmed no-known
  // (flag above); Owusu and the anonymous ICU patient are not yet assessed.
  const allergies: Seed<Allergy>[] = [
    { id: "alg_mensah_pen", patient_id: "pat_mensah", substance: "Penicillin", category: "drug", severity: "severe", reaction: "Widespread rash and facial swelling", noted_by_id: "staff_romero", created_at: day(3), updated_at: day(3) },
    { id: "alg_idris_asa", patient_id: "pat_idris", substance: "Aspirin", category: "drug", severity: "moderate", reaction: "Gastric bleeding", noted_by_id: "staff_chen", created_at: day(28), updated_at: day(28) },
    { id: "alg_idris_peanut", patient_id: "pat_idris", substance: "Peanuts", category: "food", severity: "mild", reaction: "Hives", noted_by_id: "staff_patel", created_at: day(28), updated_at: day(28) },
  ];

  const visits: Seed<Visit>[] = [
    // Intake column (registration/triage) — emergency, just arrived.
    { id: "vis_mensah", patient_id: "pat_mensah", visit_type: "emergency", status: "open", stage: "triage", department_id: "dept_emergency", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Acute chest pain", triage_notes: "Diaphoretic, BP elevated. ECG ordered. Awaiting cardiac workup.", triage_level: 2, arrived_at: day(3), closed_at: null, created_at: day(3), updated_at: day(3) },
    // Consultation column (consultation/diagnostics) — outpatient diabetes follow-up.
    { id: "vis_owusu", patient_id: "pat_owusu", visit_type: "outpatient", status: "open", stage: "diagnostics", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Routine diabetes review", triage_notes: "Stable, ambulatory. HbA1c sample taken.", triage_level: 5, arrived_at: day(2), closed_at: null, created_at: day(2), updated_at: day(2) },
    // Treatment column — inpatient post-op recovery.
    { id: "vis_idris", patient_id: "pat_idris", visit_type: "inpatient", status: "open", stage: "treatment", department_id: "dept_surgery", attending_doctor_id: "staff_chen", registered_by_id: "staff_adebayo", chief_complaint: "Post-operative recovery, laparotomy", triage_notes: null, triage_level: 3, arrived_at: day(28), closed_at: null, created_at: day(28), updated_at: day(6) },
    // Treatment column — anonymous emergency, head trauma in ICU.
    { id: "vis_anon", patient_id: "pat_anon_gamma", visit_type: "emergency", status: "open", stage: "treatment", department_id: "dept_icu", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Unconscious on arrival, head trauma — RTA", triage_notes: "Unidentified. GCS 7 on arrival. Neuro protocol initiated.", triage_level: 1, arrived_at: day(5), closed_at: null, created_at: day(5), updated_at: day(1) },
    // Discharge column — inpatient pneumonia, awaiting financial clearance.
    { id: "vis_bello", patient_id: "pat_bello", visit_type: "inpatient", status: "open", stage: "discharge_planning", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Community-acquired pneumonia", triage_notes: null, triage_level: 3, arrived_at: day(96), closed_at: null, created_at: day(96), updated_at: day(12) },
  ];

  const consultations: Seed<Consultation>[] = [
    { id: "con_owusu", visit_id: "vis_owusu", doctor_id: "staff_okafor", subjective: "Reports good adherence to metformin. Occasional polyuria. No hypoglycaemic episodes.", examination: "Well, afebrile. Feet examined — no ulcers. BMI 28.", assessment: "Type 2 diabetes mellitus, fair control.", plan: "Check HbA1c. Continue metformin. Dietary reinforcement. Review in 3 months.", created_at: day(2), updated_at: day(2) },
    { id: "con_idris", visit_id: "vis_idris", doctor_id: "staff_chen", subjective: "Mild incisional pain, controlled. Passing flatus.", examination: "Wound clean and dry. Abdomen soft. Bowel sounds present.", assessment: "Day-2 post laparotomy, recovering well.", plan: "Continue analgesia & DVT prophylaxis. Mobilize. Monitor wound.", created_at: day(26), updated_at: day(26) },
    { id: "con_bello", visit_id: "vis_bello", doctor_id: "staff_okafor", subjective: "Cough improving. No fever for 48h. Appetite returning.", examination: "Chest clear on auscultation. SpO₂ 98% on air.", assessment: "Community-acquired pneumonia, resolving.", plan: "Complete oral antibiotics. Plan discharge once finance cleared.", created_at: day(24), updated_at: day(24) },
    { id: "con_anon", visit_id: "vis_anon", doctor_id: "staff_okafor", subjective: "Unable to obtain — patient unresponsive.", examination: "GCS 7 on arrival. Pupils equal & reactive. Localizes to pain.", assessment: "Traumatic brain injury, RTA. Awaiting CT head.", plan: "Neuro protocol, mannitol, close monitoring. CT head urgent.", created_at: day(5), updated_at: day(5) },
  ];

  const diagnoses: Seed<Diagnosis>[] = [
    { id: "dx_owusu", visit_id: "vis_owusu", consultation_id: "con_owusu", diagnosed_by_id: "staff_okafor", icd10_code: "E11.9", description: "Type 2 diabetes mellitus without complications", is_primary: true, created_at: day(2) },
    { id: "dx_bello", visit_id: "vis_bello", consultation_id: "con_bello", diagnosed_by_id: "staff_okafor", icd10_code: "J18.9", description: "Pneumonia, unspecified organism", is_primary: true, created_at: day(24) },
    { id: "dx_anon", visit_id: "vis_anon", consultation_id: "con_anon", diagnosed_by_id: "staff_okafor", icd10_code: "S06.9", description: "Intracranial injury, unspecified", is_primary: true, created_at: day(5) },
  ];

  const orders: Seed<Order>[] = [
    { id: "ord_owusu_hba1c", visit_id: "vis_owusu", ordered_by_id: "staff_okafor", order_type: "lab", description: "HbA1c", status: "completed", created_at: day(2), completed_at: day(1), updated_at: day(1) },
    { id: "ord_bello_cxr", visit_id: "vis_bello", ordered_by_id: "staff_okafor", order_type: "imaging", description: "Chest X-ray (PA)", status: "completed", created_at: day(90), completed_at: day(88), updated_at: day(88) },
    { id: "ord_anon_ct", visit_id: "vis_anon", ordered_by_id: "staff_okafor", order_type: "imaging", description: "CT head (non-contrast)", status: "in_progress", created_at: day(5), completed_at: null, updated_at: day(4) },
    // Fresh, unactioned orders — populate the diagnostics queue on first load.
    { id: "ord_mensah_trop", visit_id: "vis_mensah", ordered_by_id: "staff_okafor", order_type: "lab", description: "Troponin I", status: "requested", created_at: day(3), completed_at: null, updated_at: day(3) },
    { id: "ord_owusu_lipids", visit_id: "vis_owusu", ordered_by_id: "staff_okafor", order_type: "lab", description: "Fasting lipid panel", status: "requested", created_at: day(2), completed_at: null, updated_at: day(2) },
  ];

  const results: Seed<Result>[] = [
    { id: "res_owusu_hba1c", order_id: "ord_owusu_hba1c", recorded_by_id: "staff_boateng", summary: "Moderately elevated — reinforce adherence.", value: "7.8%", reference_range: "< 7.0%", is_abnormal: true, attachment_path: null, recorded_at: day(1) },
    { id: "res_bello_cxr", order_id: "ord_bello_cxr", recorded_by_id: "staff_boateng", summary: "Right lower lobe consolidation, consistent with pneumonia.", value: "Abnormal", reference_range: null, is_abnormal: true, attachment_path: "bello-cxr-pa.jpg", recorded_at: day(88) },
  ];

  const prescriptions: Seed<Prescription>[] = [
    { id: "rx_idris_para", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Paracetamol", dose: "1 g", route: "IV", frequency: "every 6 hours", duration: "3 days", instructions: "For post-op analgesia.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_idris_enox", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Enoxaparin", dose: "40 mg", route: "SC", frequency: "once daily", duration: "while inpatient", instructions: "DVT prophylaxis.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_bello_amox", visit_id: "vis_bello", prescribed_by_id: "staff_okafor", drug_name: "Amoxicillin-clavulanate", dose: "625 mg", route: "oral", frequency: "every 8 hours", duration: "7 days", instructions: "Complete full course.", status: "active", created_at: day(90), updated_at: day(12) },
    { id: "rx_owusu_metf", visit_id: "vis_owusu", prescribed_by_id: "staff_okafor", drug_name: "Metformin", dose: "1 g", route: "oral", frequency: "twice daily", duration: "ongoing", instructions: "Take with meals.", status: "active", created_at: day(2), updated_at: day(2) },
  ];

  const medicationAdministrations: Seed<MedicationAdministration>[] = [
    { id: "mar_idris_para_1", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(12), administered_at: day(12), status: "given", notes: "Tolerated well.", created_at: day(12) },
    { id: "mar_idris_para_2", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(6), administered_at: day(6), status: "given", notes: null, created_at: day(6) },
    { id: "mar_idris_enox_1", prescription_id: "rx_idris_enox", administered_by_id: "staff_patel", scheduled_for: day(24), administered_at: day(24), status: "given", notes: null, created_at: day(24) },
    { id: "mar_bello_amox_1", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(16), administered_at: day(16), status: "given", notes: null, created_at: day(16) },
    { id: "mar_bello_amox_2", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(8), administered_at: null, status: "missed", notes: "Patient off ward for imaging.", created_at: day(8) },
  ];

  const treatmentRecords: Seed<TreatmentRecord>[] = [
    { id: "trec_mensah_1", visit_id: "vis_mensah", recorded_by_id: "staff_romero", spo2: 96, pulse: 102, bp_systolic: 158, bp_diastolic: 96, temperature_c: 37.0, weight_kg: 78.5, gcs_score: 15, notes: "Chest pain 7/10. ECG taken, troponin sent.", recorded_at: day(3) },
    { id: "trec_idris_1", visit_id: "vis_idris", recorded_by_id: "staff_patel", spo2: 97, pulse: 88, bp_systolic: 128, bp_diastolic: 82, temperature_c: 37.4, weight_kg: 71.0, gcs_score: 15, notes: "Stable post-op. Pain controlled. Mobilizing with assistance.", recorded_at: day(6) },
    { id: "trec_anon_1", visit_id: "vis_anon", recorded_by_id: "staff_patel", spo2: 94, pulse: 104, bp_systolic: 148, bp_diastolic: 95, temperature_c: 37.9, weight_kg: 82.0, gcs_score: 7, notes: "Unresponsive to voice, localizes to pain. Pupils equal/reactive. CT head pending.", recorded_at: day(4) },
    { id: "trec_anon_2", visit_id: "vis_anon", recorded_by_id: "staff_okafor", spo2: 96, pulse: 92, bp_systolic: 138, bp_diastolic: 88, temperature_c: 37.5, weight_kg: 82.0, gcs_score: 9, notes: "Slight improvement in responsiveness. Continue close monitoring.", recorded_at: day(1) },
    { id: "trec_bello_1", visit_id: "vis_bello", recorded_by_id: "staff_patel", spo2: 98, pulse: 74, bp_systolic: 118, bp_diastolic: 76, temperature_c: 36.9, weight_kg: 64.5, gcs_score: 15, notes: "Afebrile 48h. Chest clear on auscultation. Fit for discharge planning.", recorded_at: day(12) },
  ];

  const admissions: Seed<Admission>[] = [
    { id: "adm_idris", visit_id: "vis_idris", patient_id: "pat_idris", attending_doctor_id: "staff_chen", ward_id: "ward_icu", bed_id: "bed_icu_04", status: "active", stage: "treatment", reason: "Post-operative recovery, laparotomy", is_medical_cleared: false, is_financial_cleared: true, is_pharmacy_ready: false, admitted_at: day(28), discharged_at: null, updated_at: day(6) },
    { id: "adm_anon_gamma", visit_id: "vis_anon", patient_id: "pat_anon_gamma", attending_doctor_id: "staff_okafor", ward_id: "ward_icu", bed_id: "bed_icu_02", status: "active", stage: "treatment", reason: "Unconscious on arrival, head trauma — RTA", is_medical_cleared: false, is_financial_cleared: false, is_pharmacy_ready: false, admitted_at: day(5), discharged_at: null, updated_at: day(1) },
    { id: "adm_bello", visit_id: "vis_bello", patient_id: "pat_bello", attending_doctor_id: "staff_okafor", ward_id: "ward_medb", bed_id: "bed_medb_11", status: "active", stage: "discharge_planning", reason: "Community-acquired pneumonia, responding to treatment", is_medical_cleared: true, is_financial_cleared: false, is_pharmacy_ready: true, admitted_at: day(96), discharged_at: null, updated_at: day(12) },
  ];

  // History: Idris deteriorated post-op and was escalated from Medical Ward B
  // to ICU, with his attending changing from the medic to the surgeon.
  const transfers: Seed<Transfer>[] = [
    { id: "trf_idris_icu", admission_id: "adm_idris", patient_id: "pat_idris", from_ward_id: "ward_medb", to_ward_id: "ward_icu", from_bed_id: "bed_medb_09", to_bed_id: "bed_icu_04", from_doctor_id: "staff_okafor", to_doctor_id: "staff_chen", reason: "Post-op deterioration — escalated to critical care", transferred_by_id: "staff_patel", created_at: day(20) },
  ];

  // Nursing care plans for the three admitted patients — the individualized,
  // non-medication care (hygiene, positioning, nutrition…) that fills a shift,
  // plus an append-only care log with shift-handover notes for the next nurse.
  const carePlanItems: Seed<CarePlanItem>[] = [
    // Samuel Idris — ICU-04, post-op laparotomy.
    { id: "cpi_idris_hyg", admission_id: "adm_idris", patient_id: "pat_idris", category: "hygiene", description: "Assist with bed bath, keep skin dry", frequency: "Daily", goal: "Skin remains intact", status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_pos", admission_id: "adm_idris", patient_id: "pat_idris", category: "mobility_positioning", description: "Turn every 2h to prevent pressure sores", frequency: "Every 2h", goal: "No pressure injury", status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_temp", admission_id: "adm_idris", patient_id: "pat_idris", category: "temperature", description: "Tepid sponge and review if temp > 38.5°C", frequency: "As needed", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_nut", admission_id: "adm_idris", patient_id: "pat_idris", category: "nutrition", description: "Soft diet, assist feeding, encourage fluids", frequency: "Each meal", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    // Aisha Bello — B-11, pneumonia recovering.
    { id: "cpi_bello_brt", admission_id: "adm_bello", patient_id: "pat_bello", category: "breathing", description: "Sit upright, encourage deep breathing / chest physio", frequency: "Every 4h", goal: "Clear chest, good air entry", status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    { id: "cpi_bello_hyg", admission_id: "adm_bello", patient_id: "pat_bello", category: "hygiene", description: "Assist shower", frequency: "Daily", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    { id: "cpi_bello_mob", admission_id: "adm_bello", patient_id: "pat_bello", category: "mobility_positioning", description: "Encourage short walks on the ward", frequency: "Twice daily", goal: "Mobilizing independently", status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    // John Doe · Gamma — ICU-02, unconscious head trauma, GCS improving.
    { id: "cpi_anon_hyg", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "hygiene", description: "Full bed bath + mouth care", frequency: "Daily", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_pos", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "mobility_positioning", description: "Turn every 2h", frequency: "Every 2h", goal: "No pressure injury", status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_elim", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "elimination", description: "Catheter care, monitor output", frequency: "Each shift", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_eye", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "other", description: "Eye care: clean and protect eyes to prevent dryness", frequency: "Every 4h", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_safe", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "safety", description: "Cot sides up, neuro observations", frequency: "Each shift", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
  ];

  const carePlanEntries: Seed<CarePlanEntry>[] = [
    // Samuel Idris — care log + a fresh handover for the evening shift.
    { id: "cpe_idris_1", admission_id: "adm_idris", care_plan_item_id: "cpi_idris_pos", note: "Turned to left side. Temp 37.8°C, settling.", is_handover: false, recorded_by_id: "staff_romero", recorded_at: day(9) },
    { id: "cpe_idris_2", admission_id: "adm_idris", care_plan_item_id: "cpi_idris_hyg", note: "Bed bath given, skin intact. Ate half of lunch.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(7) },
    { id: "cpe_idris_ho", admission_id: "adm_idris", care_plan_item_id: null, note: "Anxious about surgery tomorrow — needs reassurance. Watch temperature this evening.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(5) },
    // Aisha Bello — care log + handover.
    { id: "cpe_bello_1", admission_id: "adm_bello", care_plan_item_id: "cpi_bello_mob", note: "Walked to end of ward and back, tolerated well.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(11) },
    { id: "cpe_bello_ho", admission_id: "adm_bello", care_plan_item_id: null, note: "Chest clearer, coughing productively. Keep prompting deep breathing.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(9) },
    // John Doe · Gamma — care log + handover.
    { id: "cpe_anon_1", admission_id: "adm_anon_gamma", care_plan_item_id: "cpi_anon_hyg", note: "Full bed bath and mouth care done. Repositioned. Output adequate.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(3) },
    { id: "cpe_anon_ho", admission_id: "adm_anon_gamma", care_plan_item_id: null, note: "GCS improving (7→9). Continue 2-hourly turns and eye care. Family visited.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(2) },
  ];

  // -------------------------------------------------------------------------
  // Historical caseload — a deterministically generated 60-day back-catalogue of
  // *closed* visits so the reporting dashboard has rich, varied data to chart
  // (throughput over time, top diagnoses, LOS, demographics, meds dispensed…).
  // These are appended to the live snapshot above; being `closed`/terminal they
  // never appear on the live board, MAR or floor map.
  // -------------------------------------------------------------------------
  seedHistoricalCaseload({
    day,
    patients,
    allergies,
    visits,
    consultations,
    diagnoses,
    orders,
    results,
    prescriptions,
    medicationAdministrations,
    treatmentRecords,
    admissions,
  });

  // -------------------------------------------------------------------------
  // Billing (Phase 16.9) — the price catalog + sample charges for EVERY visit
  // (live + historical) so the bill screen has rich, viewable data on first
  // load. Charges are derived with the same pure engine the live recalc uses
  // (`computeAutoChargeLines`), so seeded data matches what reconciliation would
  // produce. Closed visits are marked settled (`paid`); open visits stay
  // `pending` so they can be settled during testing. Two live visits also carry
  // a showcase manual line and a discount.
  // -------------------------------------------------------------------------
  const billableItems: Seed<BillableItem>[] = BILLING_CATALOG_SEED.map((it) => ({
    id: it.id,
    category: it.category,
    name: it.name,
    unit: it.unit,
    unit_price: it.unit_price,
    ref_code: it.ref_code,
    is_active: it.is_active,
    created_at: day(8760),
    updated_at: day(8760),
  }));

  const charges: Seed<Charge>[] = [];
  {
    const catalog = billableItems as unknown as BillableItem[];
    const wardsForCalc = wards as unknown as Ward[];
    const nowMs = Date.now();
    for (const v of visits) {
      const adm = admissions.find((a) => a.visit_id === v.id) ?? null;
      const trs = adm ? transfers.filter((t) => t.admission_id === adm.id) : [];
      const lines = computeAutoChargeLines({
        visit: v as unknown as Visit,
        consultations: consultations.filter((c) => c.visit_id === v.id) as unknown as Consultation[],
        orders: orders.filter((o) => o.visit_id === v.id) as unknown as Order[],
        prescriptions: prescriptions.filter((p) => p.visit_id === v.id) as unknown as Prescription[],
        admission: adm as unknown as Admission | null,
        transfers: trs as unknown as Transfer[],
        wards: wardsForCalc,
        catalog,
        nowMs,
      });
      const settled = v.status === "closed";
      const baseTs = v.closed_at ?? v.updated_at ?? v.created_at;
      lines.forEach((line, idx) => {
        charges.push({
          id: `chg_${v.id}_${idx}`,
          visit_id: v.id,
          billable_item_id: line.billable_item_id,
          source: line.source,
          source_ref_id: line.source_ref_id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: line.amount,
          status: settled ? "paid" : "pending",
          created_by_id: "staff_adebayo",
          created_at: baseTs,
          updated_at: baseTs,
        });
      });
    }
    // Showcase a manual line and a discount on two live (open) visits.
    charges.push({
      id: "chg_idris_manual", visit_id: "vis_idris", billable_item_id: null, source: "manual", source_ref_id: null,
      description: "Wound dressing pack", quantity: 2, unit_price: 1_500, amount: 3_000, status: "pending",
      created_by_id: "staff_adebayo", created_at: day(6), updated_at: day(6),
    });
    charges.push({
      id: "chg_bello_discount", visit_id: "vis_bello", billable_item_id: null, source: "discount", source_ref_id: null,
      description: "Goodwill discount", quantity: 1, unit_price: -2_000, amount: -2_000, status: "pending",
      created_by_id: "staff_quartey", created_at: day(11), updated_at: day(11),
    });
  }

  // Stamp the demo tenant onto every domain row. The seed is built tenantless
  // (`Seed<T>`) so the literals stay terse; ownership is applied in one place.
  const stamp = <T,>(rows: Seed<T>[]): T[] =>
    rows.map((r) => ({ ...r, hospital_id: DEMO_HOSPITAL_ID }) as T);

  return {
    hospitals,
    departments: stamp<Department>(departments),
    wards: stamp<Ward>(wards),
    beds: stamp<Bed>(beds),
    staff: stamp<Staff>(staff),
    patients: stamp<Patient>(patients),
    allergies: stamp<Allergy>(allergies),
    visits: stamp<Visit>(visits),
    consultations: stamp<Consultation>(consultations),
    diagnoses: stamp<Diagnosis>(diagnoses),
    orders: stamp<Order>(orders),
    results: stamp<Result>(results),
    prescriptions: stamp<Prescription>(prescriptions),
    medicationAdministrations: stamp<MedicationAdministration>(medicationAdministrations),
    treatmentRecords: stamp<TreatmentRecord>(treatmentRecords),
    admissions: stamp<Admission>(admissions),
    transfers: stamp<Transfer>(transfers),
    carePlanItems: stamp<CarePlanItem>(carePlanItems),
    carePlanEntries: stamp<CarePlanEntry>(carePlanEntries),
    billableItems: stamp<BillableItem>(billableItems),
    charges: stamp<Charge>(charges),
  };
}

// ---------------------------------------------------------------------------
// Historical caseload generator (demo data only)
// ---------------------------------------------------------------------------

interface HistoricalSeedCtx {
  day: (offsetHours: number) => string;
  // Rows are stamped with `hospital_id` by the caller after generation, so the
  // generator builds them tenantless (`Seed<T>`).
  patients: Seed<Patient>[];
  allergies: Seed<Allergy>[];
  visits: Seed<Visit>[];
  consultations: Seed<Consultation>[];
  diagnoses: Seed<Diagnosis>[];
  orders: Seed<Order>[];
  results: Seed<Result>[];
  prescriptions: Seed<Prescription>[];
  medicationAdministrations: Seed<MedicationAdministration>[];
  treatmentRecords: Seed<TreatmentRecord>[];
  admissions: Seed<Admission>[];
}

/**
 * Append a deterministic 60-day back-catalogue of *closed* visits with full
 * clinical records, so the reporting dashboard has rich, varied history to
 * chart. Deterministic (seeded PRNG) so the dataset is stable across reloads.
 * Everything generated here is terminal/closed and therefore invisible to the
 * live board, MAR worklist and floor map — it only feeds reports.
 */
function seedHistoricalCaseload(ctx: HistoricalSeedCtx): void {
  const { day } = ctx;

  // mulberry32 — deterministic so the demo set never drifts between loads.
  let s = 0x20260531 >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const randint = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p: number) => rng() < p;
  const weighted = <T,>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = rng() * total;
    for (const [value, w] of items) {
      r -= w;
      if (r <= 0) return value;
    }
    return items[items.length - 1][0];
  };

  const firstNames = [
    "Kwame", "Ama", "Kofi", "Akua", "Yaw", "Abena", "Kojo", "Esi", "Kwesi",
    "Adwoa", "Chinedu", "Ngozi", "Emeka", "Folake", "Tunde", "Bisi", "Femi",
    "Zainab", "Musa", "Halima", "Ibrahim", "Fatima", "Joseph", "Mary", "Isaac",
    "Beatrice", "Michael", "Patience", "Eric", "Vivian", "Prince", "Gifty",
  ];
  const lastNames = [
    "Asante", "Boateng", "Addo", "Appiah", "Darko", "Frimpong", "Gyamfi",
    "Acheampong", "Okeke", "Nwankwo", "Adeyemi", "Balogun", "Danso", "Quaye",
    "Lartey", "Annan", "Kanu", "Sarpong", "Amankwah", "Mahama",
  ];
  const complaints = [
    "Fever and chills", "Persistent headache", "Abdominal pain", "Productive cough",
    "Shortness of breath", "Vomiting and diarrhoea", "Chest pain", "Dizziness",
    "Painful urination", "Generalized body weakness", "Joint pain", "Lower back pain",
    "Difficulty breathing", "Fainting episode", "Swelling of the legs",
  ];

  const doctorByDept: Record<string, string[]> = {
    dept_medicine: ["staff_okafor", "staff_adeyemi"],
    dept_surgery: ["staff_chen", "staff_nwosu"],
    dept_emergency: ["staff_asante", "staff_romero"],
    dept_icu: ["staff_okonkwo", "staff_okafor"],
  };
  const clinicalDepts: readonly (readonly [string, number])[] = [
    ["dept_medicine", 10],
    ["dept_emergency", 7],
    ["dept_surgery", 5],
    ["dept_icu", 3],
  ];
  const nurseIds = ["staff_patel", "staff_romero", "staff_tetteh", "staff_yeboah"];
  const wardByDept: Record<string, string> = {
    dept_icu: "ward_icu",
    dept_medicine: "ward_medb",
    dept_emergency: "ward_er",
    dept_surgery: "ward_medb",
  };
  const bedByWard: Record<string, string[]> = {
    ward_icu: ["bed_icu_01", "bed_icu_02", "bed_icu_04"],
    ward_medb: ["bed_medb_09", "bed_medb_10", "bed_medb_11"],
    ward_er: ["bed_er_1", "bed_er_2"],
  };

  const dxPool: readonly (readonly [readonly [string, string], number])[] = [
    [["B54", "Malaria, unspecified"], 18],
    [["I10", "Essential (primary) hypertension"], 15],
    [["E11.9", "Type 2 diabetes mellitus without complications"], 10],
    [["A09", "Infectious gastroenteritis & colitis"], 9],
    [["A01.0", "Typhoid fever"], 8],
    [["J18.9", "Pneumonia, unspecified organism"], 8],
    [["N39.0", "Urinary tract infection, site not specified"], 7],
    [["D64.9", "Anaemia, unspecified"], 6],
    [["K29.70", "Gastritis, unspecified"], 5],
    [["J45.909", "Asthma, unspecified"], 5],
    [["D57.00", "Sickle-cell crisis"], 4],
    [["I50.9", "Heart failure, unspecified"], 4],
    [["S52.501A", "Fracture of lower end of right radius"], 4],
    [["O80", "Full-term uncomplicated delivery"], 4],
    [["K35.80", "Acute appendicitis"], 3],
    [["I63.9", "Cerebral infarction, unspecified"], 3],
    [["A41.9", "Sepsis, unspecified organism"], 3],
    [["J44.9", "Chronic obstructive pulmonary disease"], 3],
  ];

  const drugPool = [
    ["Artemether-lumefantrine", "20/120 mg", "oral", "twice daily"],
    ["Amoxicillin", "500 mg", "oral", "every 8 hours"],
    ["Paracetamol", "1 g", "oral", "every 6 hours"],
    ["Metformin", "1 g", "oral", "twice daily"],
    ["Amlodipine", "10 mg", "oral", "once daily"],
    ["Ceftriaxone", "1 g", "IV", "once daily"],
    ["Ibuprofen", "400 mg", "oral", "every 8 hours"],
    ["Omeprazole", "20 mg", "oral", "once daily"],
    ["Lisinopril", "10 mg", "oral", "once daily"],
    ["Azithromycin", "500 mg", "oral", "once daily"],
    ["Salbutamol", "2.5 mg", "nebulized", "every 6 hours"],
    ["Ferrous sulfate", "200 mg", "oral", "twice daily"],
    ["Metronidazole", "500 mg", "IV", "every 8 hours"],
  ] as const;

  const labTests = [
    "Full Blood Count", "Malaria RDT", "Random blood glucose", "Urea & electrolytes",
    "Liver function test", "Blood culture", "Urinalysis", "Widal test", "Lipid panel",
  ];
  const imagingTests = [
    "Chest X-ray (PA)", "Abdominal ultrasound", "CT head (non-contrast)",
    "Pelvic ultrasound", "Wrist X-ray",
  ];

  const allergenPool = [
    ["Penicillin", "drug", "severe", "Rash and facial swelling"],
    ["Sulfa drugs", "drug", "moderate", "Hives"],
    ["Peanuts", "food", "mild", "Itching"],
    ["Shellfish", "food", "moderate", "Lip swelling"],
    ["House dust", "environmental", "mild", "Sneezing and congestion"],
    ["Aspirin", "drug", "moderate", "Gastric upset"],
  ] as const;

  const N = 46;
  for (let i = 0; i < N; i++) {
    const tag = `h${i + 1}`;
    const patientId = `pat_${tag}`;
    const visitId = `vis_${tag}`;

    const sex = chance(0.5) ? ("female" as const) : ("male" as const);
    const age = randint(1, 88);
    const dob = `${2026 - age}-${String(randint(1, 12)).padStart(2, "0")}-${String(randint(1, 28)).padStart(2, "0")}`;

    const daysAgo = randint(1, 60);
    const arrivedH = daysAgo * 24 + randint(0, 23);

    const visitType = weighted<VisitType>([
      ["outpatient", 55],
      ["inpatient", 22],
      ["emergency", 23],
    ]);
    const dept = weighted(clinicalDepts);
    const doctorId = pick(doctorByDept[dept] ?? ["staff_okafor"]);
    const [icd, desc] = weighted(dxPool);
    const stage = chance(0.25) ? ("followed_up" as const) : ("discharged" as const);

    let admittedH: number | null = null;
    let dischargedH: number | null = null;
    let closedH: number;
    if (visitType === "inpatient") {
      const maxLos = Math.max(1, Math.floor((arrivedH - 12) / 24));
      const los = randint(1, Math.min(14, maxLos));
      admittedH = arrivedH;
      dischargedH = arrivedH - los * 24;
      closedH = dischargedH;
    } else {
      closedH = Math.max(1, arrivedH - randint(1, 8));
    }

    const hasAllergy = chance(0.28);
    const noKnown = !hasAllergy && chance(0.5);

    const fullName = `${pick(firstNames)} ${pick(lastNames)}`;
    const motherFirstName = pick(firstNames);

    ctx.patients.push({
      id: patientId,
      mrn: uniquePatientId(
        generatePatientId(dob, fullName, motherFirstName),
        ctx.patients.map((p) => p.mrn),
      ),
      full_name: fullName,
      date_of_birth: dob,
      sex,
      phone: `+233 24 555 ${String(2000 + i).slice(-4)}`,
      address: null,
      national_id: null,
      mother_first_name: motherFirstName,
      is_emergency_anonymous: false,
      anonymous_identifier: null,
      no_known_allergies: noKnown,
      created_at: day(arrivedH),
      updated_at: day(closedH),
    });

    if (hasAllergy) {
      const [sub, cat, sev, react] = pick(allergenPool);
      ctx.allergies.push({
        id: `alg_${tag}`,
        patient_id: patientId,
        substance: sub,
        category: cat,
        severity: sev,
        reaction: react,
        noted_by_id: doctorId,
        created_at: day(arrivedH),
        updated_at: day(arrivedH),
      });
    }

    ctx.visits.push({
      id: visitId,
      patient_id: patientId,
      visit_type: visitType,
      status: "closed",
      stage,
      department_id: dept,
      attending_doctor_id: doctorId,
      registered_by_id: "staff_adebayo",
      chief_complaint: pick(complaints),
      triage_notes: null,
      triage_level: (visitType === "emergency"
        ? randint(1, 3)
        : visitType === "inpatient"
          ? randint(2, 4)
          : randint(4, 5)) as TriageLevel,
      arrived_at: day(arrivedH),
      closed_at: day(closedH),
      created_at: day(arrivedH),
      updated_at: day(closedH),
    });

    const hasConsult = chance(0.85);
    const consultId = `con_${tag}`;
    if (hasConsult) {
      ctx.consultations.push({
        id: consultId,
        visit_id: visitId,
        doctor_id: doctorId,
        subjective: `${pick(complaints)}.`,
        examination: "Examined; vitals and systems reviewed.",
        assessment: `${desc}.`,
        plan: "Commenced treatment; advised review.",
        created_at: day(Math.max(1, arrivedH - 1)),
        updated_at: day(Math.max(1, arrivedH - 1)),
      });
    }

    ctx.diagnoses.push({
      id: `dx_${tag}`,
      visit_id: visitId,
      consultation_id: hasConsult ? consultId : null,
      diagnosed_by_id: doctorId,
      icd10_code: icd,
      description: desc,
      is_primary: true,
      created_at: day(Math.max(1, arrivedH - 1)),
    });

    const nOrders = randint(0, 2);
    for (let o = 0; o < nOrders; o++) {
      const isLab = chance(0.7);
      const orderId = `ord_${tag}_${o}`;
      const completed = chance(0.85);
      const compH = Math.max(1, arrivedH - randint(2, 12));
      ctx.orders.push({
        id: orderId,
        visit_id: visitId,
        ordered_by_id: doctorId,
        order_type: isLab ? "lab" : "imaging",
        description: isLab ? pick(labTests) : pick(imagingTests),
        status: completed ? "completed" : "cancelled",
        created_at: day(arrivedH),
        completed_at: completed ? day(compH) : null,
        updated_at: day(completed ? compH : arrivedH),
      });
      if (completed && chance(0.9)) {
        const abnormal = chance(0.3);
        ctx.results.push({
          id: `res_${tag}_${o}`,
          order_id: orderId,
          recorded_by_id: "staff_boateng",
          summary: abnormal ? "Result outside reference range." : "Within normal limits.",
          value: abnormal ? "Abnormal" : "Normal",
          reference_range: null,
          is_abnormal: abnormal,
          attachment_path: null,
          recorded_at: day(compH),
        });
      }
    }

    const nRx = randint(0, 2);
    for (let r = 0; r < nRx; r++) {
      const [drug, dose, route, freq] = pick(drugPool);
      const rxId = `rx_${tag}_${r}`;
      ctx.prescriptions.push({
        id: rxId,
        visit_id: visitId,
        prescribed_by_id: doctorId,
        drug_name: drug,
        dose,
        route,
        frequency: freq,
        duration: `${randint(3, 7)} days`,
        instructions: null,
        status: "completed",
        created_at: day(arrivedH),
        updated_at: day(closedH),
      });
      const nDoses = visitType === "inpatient" ? randint(2, 6) : chance(0.4) ? 1 : 0;
      for (let d = 0; d < nDoses; d++) {
        const doseH = randint(closedH, arrivedH);
        ctx.medicationAdministrations.push({
          id: `mar_${tag}_${r}_${d}`,
          prescription_id: rxId,
          administered_by_id: pick(nurseIds),
          scheduled_for: day(doseH),
          administered_at: day(doseH),
          status: chance(0.92) ? "given" : chance(0.5) ? "held" : "refused",
          notes: null,
          created_at: day(doseH),
        });
      }
    }

    const nVitals = visitType === "inpatient" ? randint(1, 3) : chance(0.5) ? 1 : 0;
    for (let v = 0; v < nVitals; v++) {
      const vH = randint(closedH, arrivedH);
      ctx.treatmentRecords.push({
        id: `trec_${tag}_${v}`,
        visit_id: visitId,
        recorded_by_id: pick(nurseIds),
        spo2: randint(92, 100),
        pulse: randint(60, 120),
        bp_systolic: randint(100, 165),
        bp_diastolic: randint(60, 100),
        temperature_c: Math.round((36 + rng() * 2.5) * 10) / 10,
        weight_kg: Math.round((55 + rng() * 45) * 10) / 10,
        gcs_score: 15,
        notes: null,
        recorded_at: day(vH),
      });
    }

    if (visitType === "inpatient") {
      const ward = wardByDept[dept] ?? "ward_medb";
      ctx.admissions.push({
        id: `adm_${tag}`,
        visit_id: visitId,
        patient_id: patientId,
        attending_doctor_id: doctorId,
        ward_id: ward,
        bed_id: pick(bedByWard[ward] ?? ["bed_medb_09"]),
        status: "discharged",
        stage: "discharged",
        reason: desc,
        is_medical_cleared: true,
        is_financial_cleared: true,
        is_pharmacy_ready: true,
        admitted_at: day(admittedH ?? arrivedH),
        discharged_at: day(dischargedH ?? closedH),
        updated_at: day(dischargedH ?? closedH),
      });
    }
  }
}
