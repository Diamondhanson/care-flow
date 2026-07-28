/**
 * supabaseData — the read (download) half of the data layer.
 *
 * The app keeps a fast local cache (see {@link ./mockStorage}); this module
 * fills it from Supabase. Row-Level-Security automatically scopes every query
 * to the signed-in user's hospital, so we never pass a hospital id. Field names
 * already match the Postgres columns (snake_case), so a fetched row drops
 * straight into its collection with no translation.
 *
 * Stage 4 — WINDOWED hydration: sign-in no longer downloads the hospital's
 * entire history. It pulls the *working set*: all structural/small tables in
 * full, plus every open visit / active admission and the last
 * {@link WINDOW_MONTHS} months of clinical records. Daily work is therefore
 * fully offline-capable, while older history loads on demand (per patient) when
 * online — and stays cached (IndexedDB) for offline reading afterwards.
 *
 * Browser-only: it uses the anon client's authenticated session. Importing the
 * module is side-effect-free (lazy client), so node tests stay hermetic.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  applyPendingChangesToCache,
  mergeRowsFromServer,
  replaceDatabaseFromTables,
  SUPABASE_TABLES,
} from "@/services/mockStorage";
import { readOutbox } from "@/services/syncQueue";

/** Supabase caps a single response at 1000 rows; page through in chunks. */
const PAGE_SIZE = 1000;

/**
 * A table the app knows about but the hosted schema doesn't have yet (schema.sql
 * committed but not applied — e.g. Phase 21's patient_history / ros_responses).
 * Postgres reports 42P01 ("undefined table"); PostgREST reports PGRST205
 * ("could not find the table in the schema cache").
 */
function isMissingTableError(error: { code?: string; message: string }): boolean {
  // 42703 is "undefined COLUMN" — a real bug in our own query, not a table the
  // hosted schema lacks. It must never be swallowed as an empty table (doing so
  // silently hydrated four tables as empty; see WINDOW_COLUMN below).
  if (error.code === "42703") return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /schema cache/i.test(error.message) ||
    /relation .* does not exist/i.test(error.message)
  );
}

/** How far back the offline working set reaches. */
export const WINDOW_MONTHS = 12;

function windowCutoffISO(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - WINDOW_MONTHS);
  return d.toISOString();
}

/**
 * Small / structural tables that are always fetched in full — they stay small
 * per hospital and daily work needs all of them offline.
 */
const FULL_FETCH_TABLES: ReadonlySet<string> = new Set([
  "hospitals",
  "departments",
  "wards",
  "beds",
  "staff",
  "billable_items",
  "clinical_terms",
  // Safety-critical and small: allergy checks must never miss an old record.
  "allergies",
  // Patient registry rows are small and power the offline "find my patient"
  // front door; clinical history is what gets windowed, not identity.
  "patients",
  // Patient-level clinical background (Phase 21): small per patient and
  // safety-relevant — it must be fully available offline, like allergies.
  // (ros_responses and notifications stay windowed by created_at: ROS rows are
  // visit-scoped, notifications are ephemeral.)
  "patient_history",
]);

/**
 * An `.or()` PostgREST filter keeping a table's OPEN work regardless of age,
 * alongside the recency window. Tables not listed here (and not full-fetch)
 * are windowed purely by `created_at`.
 */
const OPEN_OR_RECENT: Record<string, (cutoff: string) => string> = {
  visits: (cutoff) => `status.eq.open,arrived_at.gte.${cutoff}`,
  admissions: (cutoff) => `status.eq.active,admitted_at.gte.${cutoff}`,
  // A pending follow-up must surface no matter how old it is.
  follow_up_tasks: (cutoff) => `status.eq.pending,created_at.gte.${cutoff}`,
};

/**
 * The timestamp column a windowed table is filtered on. Most tables carry
 * `created_at`, but four record their moment under a domain-specific name and
 * have NO `created_at` at all — windowing those on `created_at` makes Postgres
 * raise 42703 and the table hydrates EMPTY (admissions, vitals, results and the
 * care log all silently vanished from the cache until this map existed).
 */
const WINDOW_COLUMN: Record<string, string> = {
  admissions: "admitted_at",
  treatment_records: "recorded_at",
  results: "recorded_at",
  care_plan_entries: "recorded_at",
};

/**
 * The column `table` is windowed on. Exported so a test can assert every one of
 * them really exists in packages/db/schema.sql — the guard against this bug
 * class returning when a new table is added.
 */
export function windowColumnFor(table: string): string {
  return WINDOW_COLUMN[table] ?? "created_at";
}

/** Fetch every matching row of one table (RLS-scoped), paging until exhausted. */
async function fetchRows(
  table: string,
  windowed: boolean,
): Promise<unknown[]> {
  const supabase = getSupabaseClient();
  const cutoff = windowCutoffISO();
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (windowed) {
      const orFilter = OPEN_OR_RECENT[table];
      query = orFilter
        ? query.or(orFilter(cutoff))
        : query.gte(WINDOW_COLUMN[table] ?? "created_at", cutoff);
    }
    const { data, error } = await query;
    if (error) {
      // A newer app against an older hosted schema must not lose the whole
      // hydration (the caller falls back to seed data on ANY failure) — treat
      // the missing table as empty and keep the rest of the pull intact.
      if (isMissingTableError(error)) {
        console.warn(
          `hydrate: table "${table}" missing on hosted schema — treating as empty`,
        );
        return [];
      }
      throw new Error(`hydrate ${table}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Download the signed-in user's working set from Supabase into the local cache,
 * replacing whatever was there. Call after a session resolves (sign-in or
 * restored session). Tables are fetched in parallel; the cache is replaced
 * atomically once all have arrived.
 *
 * NOTE: replacement drops previously fetched on-demand history from the cache
 * window; it re-fetches on demand. Pending (unsynced) local changes are
 * re-applied on top so a hydrate never visually reverts the user's own work.
 */
export async function hydrateFromSupabase(): Promise<void> {
  const results = await Promise.all(
    SUPABASE_TABLES.map(
      async (table) =>
        [table, await fetchRows(table, !FULL_FETCH_TABLES.has(table))] as const,
    ),
  );
  const byTable: Record<string, unknown[]> = {};
  for (const [table, rows] of results) byTable[table] = rows;
  replaceDatabaseFromTables(byTable);
  // Changes still queued for upload (made offline, or mid-drain) are not in the
  // server snapshot yet. Re-apply them on top so a hydrate — including the
  // hourly token-refresh one — never visually reverts the user's recent work.
  applyPendingChangesToCache(readOutbox());
}

// ---------------------------------------------------------------------------
// On-demand history (Stage 4) — fetch beyond the window, per patient, and merge
// into the cache so it is also available offline afterwards.
// ---------------------------------------------------------------------------

/** Child tables keyed by visit_id. */
const VISIT_CHILD_TABLES = [
  "consultations",
  "diagnoses",
  "orders",
  "prescriptions",
  "treatment_records",
  "admissions",
  "charges",
] as const;

async function fetchByColumn(
  table: string,
  column: string,
  values: readonly string[],
): Promise<unknown[]> {
  if (values.length === 0) return [];
  const supabase = getSupabaseClient();
  const rows: unknown[] = [];
  // Chunk the `in` list to keep URLs comfortably under length limits.
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .in(column, chunk);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(`history ${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

/**
 * Fetch one patient's FULL history (all visits and their clinical records,
 * regardless of age) and merge it into the local cache. Used by the patient
 * timeline / drawer when a record older than the offline window is needed.
 * Rows with pending local edits are left untouched by the merge.
 */
export async function fetchPatientHistory(patientId: string): Promise<void> {
  const visits = (await fetchByColumn("visits", "patient_id", [
    patientId,
  ])) as { id: string }[];
  const visitIds = visits.map((v) => v.id);

  const byTable: Record<string, unknown[]> = { visits };
  // Patient-level background + the per-visit ROS answers (Phase 21) join the
  // on-demand pull so an old encounter opens complete.
  byTable.patient_history = await fetchByColumn(
    "patient_history",
    "patient_id",
    [patientId],
  );
  byTable.ros_responses = await fetchByColumn(
    "ros_responses",
    "visit_id",
    visitIds,
  );
  await Promise.all(
    VISIT_CHILD_TABLES.map(async (table) => {
      byTable[table] = await fetchByColumn(table, "visit_id", visitIds);
    }),
  );

  // Results hang off orders; MAR entries hang off prescriptions.
  const orderIds = (byTable.orders as { id: string }[]).map((o) => o.id);
  byTable.results = await fetchByColumn("results", "order_id", orderIds);
  const prescriptionIds = (byTable.prescriptions as { id: string }[]).map(
    (p) => p.id,
  );
  byTable.medication_administrations = await fetchByColumn(
    "medication_administrations",
    "prescription_id",
    prescriptionIds,
  );

  // Care plans hang off admissions.
  const admissionIds = (byTable.admissions as { id: string }[]).map((a) => a.id);
  byTable.care_plan_items = await fetchByColumn(
    "care_plan_items",
    "admission_id",
    admissionIds,
  );
  byTable.care_plan_entries = await fetchByColumn(
    "care_plan_entries",
    "admission_id",
    admissionIds,
  );
  byTable.transfers = await fetchByColumn("transfers", "patient_id", [patientId]);

  mergeRowsFromServer(byTable);
}

/** The moment before which local data may be incomplete (windowed hydration). */
export function windowCutoffMs(): number {
  return Date.parse(windowCutoffISO());
}

/**
 * Fetch the report-relevant rows for a date range straight from the server
 * (Stage 4). Reports normally compute from the local cache; when the selected
 * range reaches beyond the offline window, this fills in the older rows so
 * long-range reports stay complete while online. Returned rows are TRANSIENT —
 * merged into the report computation only, never into the cache (years of
 * history would defeat the windowing).
 */
export interface ServerReportRows {
  visits: unknown[];
  admissions: unknown[];
  diagnoses: unknown[];
  results: unknown[];
}

export async function fetchReportRows(
  startISO: string,
  endISO: string,
): Promise<ServerReportRows> {
  const supabase = getSupabaseClient();
  const paged = async (table: string, column: string): Promise<unknown[]> => {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .gte(column, startISO)
        .lte(column, endISO)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        if (isMissingTableError(error)) return rows;
        throw new Error(`report ${table}: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  };
  const [visits, admissions, diagnoses, results] = await Promise.all([
    paged("visits", "arrived_at"),
    paged("admissions", "created_at"),
    paged("diagnoses", "created_at"),
    paged("results", "created_at"),
  ]);
  return { visits, admissions, diagnoses, results };
}

/**
 * Server-side patient search fallback: when online, find patients whose visits
 * fall outside the hydrated window. Matches are merged into the cache (so a
 * subsequent open works offline) and returned.
 */
export async function searchPatientsServer(query: string): Promise<number> {
  const q = query.trim();
  if (!q) return 0;
  const supabase = getSupabaseClient();
  const like = `%${q}%`;
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .or(
      `full_name.ilike.${like},mrn.ilike.${like},national_id.ilike.${like},phone.ilike.${like}`,
    )
    .limit(20);
  if (error) throw new Error(`patient search: ${error.message}`);
  if (data && data.length > 0) {
    mergeRowsFromServer({ patients: data });
  }
  return data?.length ?? 0;
}
