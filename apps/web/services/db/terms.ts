/**
 * Learned clinical terms (Stage 2) — synced storage for the clinical-term
 * autocomplete's learned layer: custom terms and usage-ranking stats, one
 * row per term key per hospital.
 */

import type {
  ClinicalTerm,
  ClinicalTermCategory,
  ClinicalTermRow,
} from "@careflow/shared";
import { generateId, nowISO } from "./shared";
import { loadDatabase, persist } from "./engine";
import { currentHospitalId, loadScoped } from "./tenancy";

// ---------------------------------------------------------------------------
// Learned clinical terms (Stage 2) — the synced replacement for the old
// device-only localStorage blob. One row per learned term key per hospital,
// holding the optional doctor-added custom term and its usage ranking stats.
// Flows through the ordinary tracked-persist path, so custom vocabulary and
// rankings sync to the `clinical_terms` table and hydrate on every device.
// ---------------------------------------------------------------------------

/** All learned-term rows for the active hospital. */
export function getClinicalTermRows(): ClinicalTermRow[] {
  return loadScoped().clinicalTermRows;
}

/**
 * Record one use of a term: bump its usage count and recency, creating the row
 * on first use. Ranking tolerates approximate counts, so concurrent devices
 * lose the occasional increment — acceptable by design (non-versioned table).
 */
export function recordClinicalTermUseRow(
  category: ClinicalTermCategory,
  termKeyValue: string,
  nowMs: number,
): void {
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  if (!hid) return;
  const timestamp = nowISO();
  const existing = db.clinicalTermRows.find(
    (r) => r.hospital_id === hid && r.term_key === termKeyValue,
  );
  if (existing) {
    existing.usage_count += 1;
    existing.last_used_at = new Date(nowMs).toISOString();
    existing.updated_at = timestamp;
  } else {
    db.clinicalTermRows.push({
      id: generateId(),
      hospital_id: hid,
      term_key: termKeyValue,
      category,
      custom_term: null,
      usage_count: 1,
      last_used_at: new Date(nowMs).toISOString(),
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  persist(db);
}

/**
 * Store a doctor-added custom term (idempotent by term key). If a usage-only
 * row already exists for the key, the custom payload is attached to it.
 */
export function addCustomClinicalTermRow(
  category: ClinicalTermCategory,
  termKeyValue: string,
  term: ClinicalTerm,
): void {
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  if (!hid) return;
  const timestamp = nowISO();
  const existing = db.clinicalTermRows.find(
    (r) => r.hospital_id === hid && r.term_key === termKeyValue,
  );
  if (existing) {
    if (existing.custom_term) return; // already stored
    existing.custom_term = term;
    existing.updated_at = timestamp;
  } else {
    db.clinicalTermRows.push({
      id: generateId(),
      hospital_id: hid,
      term_key: termKeyValue,
      category,
      custom_term: term,
      usage_count: 0,
      last_used_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  persist(db);
}

/**
 * One-time import of the legacy device-only learned blob (pre-Stage-2) into
 * synced rows. Tracked, so the import itself uploads the device's accumulated
 * vocabulary to the server. Returns how many rows were imported.
 */
export function importLegacyLearnedState(
  entries: readonly {
    term_key: string;
    category: ClinicalTermCategory;
    custom_term: ClinicalTerm | null;
    usage_count: number;
    last_used_at: string | null;
  }[],
): number {
  if (entries.length === 0) return 0;
  const db = loadDatabase();
  const hid = currentHospitalId(db);
  if (!hid) return 0;
  const timestamp = nowISO();
  let imported = 0;
  for (const entry of entries) {
    const existing = db.clinicalTermRows.find(
      (r) => r.hospital_id === hid && r.term_key === entry.term_key,
    );
    if (existing) {
      // Merge conservatively: keep the larger count, attach a missing payload.
      existing.usage_count = Math.max(existing.usage_count, entry.usage_count);
      existing.last_used_at = existing.last_used_at ?? entry.last_used_at;
      existing.custom_term = existing.custom_term ?? entry.custom_term;
      existing.updated_at = timestamp;
    } else {
      db.clinicalTermRows.push({
        id: generateId(),
        hospital_id: hid,
        term_key: entry.term_key,
        category: entry.category,
        custom_term: entry.custom_term,
        usage_count: entry.usage_count,
        last_used_at: entry.last_used_at,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    imported += 1;
  }
  persist(db);
  return imported;
}
