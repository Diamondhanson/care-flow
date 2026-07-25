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
 *
 * The implementation is decomposed into focused domain modules under
 * `services/db/` — this file is the stable barrel that re-exports their entire
 * surface, so every existing `@/services/mockStorage` import keeps working
 * unchanged. (`services/db/seed-history.ts` is a private helper of the seed
 * module and is deliberately not re-exported.)
 */

export * from "./db/shared";
export * from "./db/engine";
export * from "./db/tenancy";
export * from "./db/structure";
export * from "./db/patients";
export * from "./db/ros";
export * from "./db/visits";
export * from "./db/clinical";
export * from "./db/meds";
export * from "./db/admissions";
export * from "./db/billing";
export * from "./db/terms";
export * from "./db/notifications";
export * from "./db/seed";
