/**
 * supabaseData — the read (download) half of the Phase 18b data layer.
 *
 * The app keeps a fast local cache (see {@link ./mockStorage}); this module
 * fills that cache from Supabase. On sign-in we pull every table the cache
 * mirrors — Row-Level-Security automatically scopes each query to the signed-in
 * user's hospital, so we never pass a hospital id. Field names already match the
 * Postgres columns (snake_case), so a fetched row drops straight into its
 * collection with no translation.
 *
 * Browser-only: it uses the anon client's authenticated session. Importing the
 * module is side-effect-free (lazy client), so node tests stay hermetic.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import { replaceDatabaseFromTables, SUPABASE_TABLES } from "@/services/mockStorage";

/** Supabase caps a single response at 1000 rows; page through in chunks. */
const PAGE_SIZE = 1000;

/**
 * A table the app knows about but the hosted schema doesn't have yet (schema.sql
 * committed but not applied — e.g. Phase 21's patient_history / ros_responses).
 * Postgres reports 42P01 ("undefined table"); PostgREST reports PGRST205
 * ("could not find the table in the schema cache").
 */
function isMissingTableError(error: { code?: string; message: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error.message)
  );
}

/** Fetch every row of one table (RLS-scoped), paging until exhausted. */
async function fetchAllRows(table: string): Promise<unknown[]> {
  const supabase = getSupabaseClient();
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
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
 * Download the signed-in user's hospital data from Supabase into the local
 * cache, replacing whatever was there. Call after a session resolves (sign-in
 * or restored session) and before reading from the cache. Tables are fetched in
 * parallel; the cache is replaced atomically once all have arrived.
 */
export async function hydrateFromSupabase(): Promise<void> {
  const results = await Promise.all(
    SUPABASE_TABLES.map(async (table) => [table, await fetchAllRows(table)] as const),
  );
  const byTable: Record<string, unknown[]> = {};
  for (const [table, rows] of results) byTable[table] = rows;
  replaceDatabaseFromTables(byTable);
}
