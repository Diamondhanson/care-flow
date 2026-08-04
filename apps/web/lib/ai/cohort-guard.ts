/**
 * Cohort query guard (Phase 22, spec §11) — the ONLY path from a model
 * output to a database read. The model returns a structured filter object
 * (never SQL); this module:
 *
 *   1. zod-parses the shape (CohortQuerySchema),
 *   2. checks table/column membership against the shared whitelist,
 *   3. checks operator/value coherence,
 *   4. builds the query with the supabase-js query builder through the
 *      caller's bearer-token RLS client — so even a guard bug cannot cross
 *      the tenant boundary (RLS re-enforces it).
 *
 * Validation failures throw CohortGuardError; the route handler retries the
 * model once with the error message, then gives up cleanly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COHORT_TABLE_COLUMNS,
  CohortQuerySchema,
  type CohortQuery,
} from "@careflow/shared/types/ai";

export class CohortGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CohortGuardError";
  }
}

const OPS_WITHOUT_VALUE = new Set(["is_null", "not_null"]);

/** Parse + whitelist-check a raw model output into a safe CohortQuery. */
export function validateCohortQuery(raw: unknown): CohortQuery {
  const parsed = CohortQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new CohortGuardError(`query shape invalid: ${parsed.error.message}`);
  }
  const q = parsed.data;
  const allowed: readonly string[] = COHORT_TABLE_COLUMNS[q.table];

  for (const col of q.columns) {
    if (!allowed.includes(col)) {
      throw new CohortGuardError(
        `column "${col}" is not allowed on table "${q.table}" (allowed: ${allowed.join(", ")})`,
      );
    }
  }
  for (const f of q.filters) {
    if (!allowed.includes(f.column)) {
      throw new CohortGuardError(
        `filter column "${f.column}" is not allowed on table "${q.table}"`,
      );
    }
    if (OPS_WITHOUT_VALUE.has(f.op)) {
      if (f.value !== null && f.value !== undefined) {
        throw new CohortGuardError(`op "${f.op}" must not carry a value`);
      }
    } else if (f.value === null || f.value === undefined) {
      throw new CohortGuardError(`op "${f.op}" on "${f.column}" requires a value`);
    }
    if (f.op === "in" && !Array.isArray(f.value)) {
      throw new CohortGuardError(`op "in" on "${f.column}" requires an array value`);
    }
    if (f.op === "ilike" && typeof f.value !== "string") {
      throw new CohortGuardError(`op "ilike" on "${f.column}" requires a string value`);
    }
  }
  if (q.orderBy && !allowed.includes(q.orderBy.column)) {
    throw new CohortGuardError(
      `orderBy column "${q.orderBy.column}" is not allowed on table "${q.table}"`,
    );
  }
  return q;
}

/** Human-readable description of the query — shown to the clinician. */
export function describeCohortQuery(q: CohortQuery): string {
  const filters =
    q.filters.length === 0
      ? "no filters"
      : q.filters
          .map((f) =>
            OPS_WITHOUT_VALUE.has(f.op)
              ? `${f.column} ${f.op === "is_null" ? "is empty" : "is set"}`
              : `${f.column} ${f.op} ${JSON.stringify(f.value)}`,
          )
          .join(" AND ");
  const head =
    q.aggregate === "count"
      ? `COUNT rows in "${q.table}"`
      : `READ ${q.columns.join(", ")} FROM "${q.table}"`;
  const order = q.orderBy
    ? ` ordered by ${q.orderBy.column} ${q.orderBy.ascending ? "ascending" : "descending"}`
    : "";
  return `${head} WHERE ${filters}${order}, limit ${q.limit} — scoped to this hospital only.`;
}

export interface CohortQueryResult {
  rows: Record<string, unknown>[];
  /** Total matching rows (may exceed rows.length when capped by limit). */
  totalCount: number | null;
}

/** Execute a validated query through the caller's RLS-bound client. */
export async function runCohortQuery(
  supabase: SupabaseClient,
  q: CohortQuery,
): Promise<CohortQueryResult> {
  let query = supabase
    .from(q.table)
    .select(q.columns.join(","), { count: "exact", head: q.aggregate === "count" });

  for (const f of q.filters) {
    switch (f.op) {
      case "eq":
        query = query.eq(f.column, f.value);
        break;
      case "neq":
        query = query.neq(f.column, f.value);
        break;
      case "gt":
        query = query.gt(f.column, f.value);
        break;
      case "gte":
        query = query.gte(f.column, f.value);
        break;
      case "lt":
        query = query.lt(f.column, f.value);
        break;
      case "lte":
        query = query.lte(f.column, f.value);
        break;
      case "ilike":
        query = query.ilike(f.column, String(f.value));
        break;
      case "in":
        query = query.in(f.column, f.value as (string | number)[]);
        break;
      case "is_null":
        query = query.is(f.column, null);
        break;
      case "not_null":
        query = query.not(f.column, "is", null);
        break;
    }
  }

  if (q.orderBy) {
    query = query.order(q.orderBy.column, { ascending: q.orderBy.ascending });
  }
  if (q.aggregate !== "count") {
    query = query.limit(q.limit);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new CohortGuardError(`query execution failed: ${error.message}`);
  }
  return {
    rows: (data ?? []) as unknown as Record<string, unknown>[],
    totalCount: count ?? null,
  };
}
