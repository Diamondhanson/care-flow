/**
 * Tenancy — the mock's stand-in for the schema's `current_hospital_id()` +
 * RLS: the module-level active hospital, the tenant resolvers used to stamp
 * writes, and `loadScoped` (the tenant-filtered READ path every domain
 * module goes through).
 */

import type { HospitalId } from "@careflow/shared";
import { DEMO_HOSPITAL_ID, type Database } from "./shared";
import { readDb } from "./engine";

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
export function currentHospitalId(db: Database): HospitalId | null {
  if (activeHospitalId && db.hospitals.some((h) => h.id === activeHospitalId)) {
    return activeHospitalId;
  }
  return db.hospitals[0]?.id ?? null;
}

/** Non-null tenant id for stamping new rows (falls back to the demo hospital). */
export function tenantId(db: Database): HospitalId {
  return currentHospitalId(db) ?? DEMO_HOSPITAL_ID;
}

/**
 * Load the database filtered to the active tenant — the READ path. Every domain
 * collection is narrowed to rows whose `hospital_id` matches the current
 * hospital; `hospitals` is narrowed to the tenant's own account row. This is the
 * mock equivalent of an RLS `using (hospital_id = current_hospital_id())`
 * predicate on every table. Writes use {@link loadDatabase} (the full store) so
 * the outbox diff stays correct and rows are stamped, not filtered away.
 */
export function loadScoped(): Database {
  // Reads share the in-memory reference (no clone) — they only filter. All
  // mutations go through loadDatabase() (a mutable clone) + persist().
  const db = readDb();
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
    patientHistory: only(db.patientHistory),
    visits: only(db.visits),
    consultations: only(db.consultations),
    diagnoses: only(db.diagnoses),
    rosResponses: only(db.rosResponses),
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
    clinicalTermRows: only(db.clinicalTermRows),
    followUpTasks: only(db.followUpTasks),
    // Notification rows are addressed to a recipient staff member; tenant
    // scoping by hospital keeps another hospital's traffic invisible.
    notifications: only(db.notifications),
  };
}
