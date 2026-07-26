import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADMISSION_STATUSES,
  ALLERGY_CATEGORIES,
  ALLERGY_SEVERITIES,
  BED_STATUSES,
  BILLING_CATEGORIES,
  BILLING_UNITS,
  BODY_SYSTEMS,
  CARE_ITEM_KINDS,
  CARE_NEED_CATEGORIES,
  CARE_PLAN_ITEM_STATUSES,
  CARE_STAGES,
  CHARGE_SOURCES,
  CHARGE_STATUSES,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STATUSES,
  MAR_STATUSES,
  MARITAL_STATUSES,
  MEAL_TIMINGS,
  ORDER_STATUSES,
  ORDER_TYPES,
  PATIENT_HISTORY_TYPES,
  PRESCRIPTION_STATUSES,
  ROS_ANSWER_TYPES,
  ROS_QUESTION_KINDS,
  SEXES,
  STAFF_ROLES,
  SUBSCRIPTION_STATUSES,
  USAGE_EVENT_TYPES,
  VISIT_STATUSES,
  VISIT_TYPES,
} from "./healthcare";

/**
 * Schema ↔ types enum-parity guard.
 *
 * Every status enum is declared twice: once as a Postgres
 * `create type … as enum (…)` in `packages/db/schema.sql`, and once as an
 * `as const` member array (deriving the union type) in `types/healthcare.ts`.
 * This test reads the schema at runtime and asserts the two lists are
 * identical — member set AND order (order is semantic for Postgres enums:
 * it drives comparison/sort) — so hand-edited drift fails CI with a message
 * naming the drifted enum.
 *
 * It also asserts the mapping below covers every enum found in the schema, so
 * a NEW Postgres enum added without a TS counterpart fails too.
 *
 * Not covered here (by design):
 *  - `triage_level` — not a Postgres enum at all: `visits.triage_level` is a
 *    `smallint` with a between-1-and-5 check; the TS `TriageLevel` union is
 *    numeric (1|2|3|4|5) and cannot drift via this file's string regex.
 *  - text-with-check columns are NOT `create type … as enum` declarations, so
 *    the enum regex never sees them. The three that mirror TS unions
 *    (`follow_up_tasks.kind` / `follow_up_tasks.status` /
 *    `prescriptions.meal_timing`) are still guarded: a second regex parses
 *    their `check (col in (…))` lists (including the nullable
 *    `col is null or col in (…)` form) and asserts parity against
 *    FOLLOW_UP_KINDS / FOLLOW_UP_STATUSES / MEAL_TIMINGS below.
 */

const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/schema.sql",
);

/** Postgres enum type name → the exported `as const` member array. */
const ENUM_TO_ARRAY: Record<string, readonly string[]> = {
  staff_role: STAFF_ROLES,
  sex_type: SEXES,
  visit_type: VISIT_TYPES,
  visit_status: VISIT_STATUSES,
  care_stage: CARE_STAGES,
  order_type: ORDER_TYPES,
  order_status: ORDER_STATUSES,
  bed_status: BED_STATUSES,
  admission_status: ADMISSION_STATUSES,
  prescription_status: PRESCRIPTION_STATUSES,
  mar_status: MAR_STATUSES,
  allergy_category: ALLERGY_CATEGORIES,
  allergy_severity: ALLERGY_SEVERITIES,
  body_system: BODY_SYSTEMS,
  ros_answer_type: ROS_ANSWER_TYPES,
  ros_question_kind: ROS_QUESTION_KINDS,
  patient_history_type: PATIENT_HISTORY_TYPES,
  marital_status: MARITAL_STATUSES,
  care_need_category: CARE_NEED_CATEGORIES,
  care_plan_item_status: CARE_PLAN_ITEM_STATUSES,
  care_item_kind: CARE_ITEM_KINDS,
  subscription_status: SUBSCRIPTION_STATUSES,
  billing_category: BILLING_CATEGORIES,
  billing_unit: BILLING_UNITS,
  charge_source: CHARGE_SOURCES,
  charge_status: CHARGE_STATUSES,
  usage_event_type: USAGE_EVENT_TYPES,
};

/**
 * Postgres enums that intentionally have NO TS member array. Empty today —
 * every enum in schema.sql has a TS union. Add an entry (with a comment
 * explaining why) if a future enum is deliberately server-only.
 */
const SKIP: readonly string[] = [];

/** `check (col in ('a','b'))` column → the exported member array. */
const CHECK_TO_ARRAY: Record<string, readonly string[]> = {
  kind: FOLLOW_UP_KINDS,
  status: FOLLOW_UP_STATUSES,
  meal_timing: MEAL_TIMINGS,
};

// ---------------------------------------------------------------------------
// Extraction (pure, unit-tested below with a deliberately drifted fixture)
// ---------------------------------------------------------------------------

/** Extract every `create type <name> as enum (…)` member list from SQL. */
export function extractPgEnums(sql: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const decl = /create\s+type\s+(\w+)\s+as\s+enum\s*\(([^)]*)\)/gi;
  for (const m of sql.matchAll(decl)) {
    const members = [...m[2].matchAll(/'([^']*)'/g)].map((q) => q[1]);
    enums.set(m[1], members);
  }
  return enums;
}

/**
 * Extract every `check (<col> in ('a','b'))` member list from SQL, including
 * the nullable form `check (<col> is null or <col> in ('a','b'))` used for
 * optional columns like `prescriptions.meal_timing`.
 */
export function extractCheckInConstraints(sql: string): Map<string, string[]> {
  const checks = new Map<string, string[]>();
  const decl =
    /check\s*\(\s*(\w+)\s+(?:is\s+null\s+or\s+\1\s+)?in\s*\(([^)]*)\)\s*\)/gi;
  for (const m of sql.matchAll(decl)) {
    const members = [...m[2].matchAll(/'([^']*)'/g)].map((q) => q[1]);
    checks.set(m[1], members);
  }
  return checks;
}

/**
 * Compare one SQL member list against its TS array. Returns a human-readable
 * drift description, or null when identical (same members, same order).
 */
export function diffEnum(
  name: string,
  sqlMembers: readonly string[],
  tsMembers: readonly string[],
): string | null {
  const missingInTs = sqlMembers.filter((v) => !tsMembers.includes(v));
  const extraInTs = tsMembers.filter((v) => !sqlMembers.includes(v));
  if (missingInTs.length > 0 || extraInTs.length > 0) {
    return (
      `Enum "${name}" drifted between packages/db/schema.sql and types/healthcare.ts:` +
      (missingInTs.length > 0 ? ` missing in TS: [${missingInTs.join(", ")}]` : "") +
      (extraInTs.length > 0 ? ` extra in TS: [${extraInTs.join(", ")}]` : "")
    );
  }
  if (sqlMembers.join("|") !== tsMembers.join("|")) {
    return (
      `Enum "${name}" has the same members but a different ORDER ` +
      `(order is semantic for Postgres enums). SQL: [${sqlMembers.join(", ")}] ` +
      `vs TS: [${tsMembers.join(", ")}]`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// The parity tests
// ---------------------------------------------------------------------------

describe("schema.sql ↔ types/healthcare.ts enum parity", () => {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  const pgEnums = extractPgEnums(sql);

  it("finds the expected enum declarations in schema.sql (regex sanity)", () => {
    // If the schema's enum syntax ever changes shape, fail loudly rather than
    // silently comparing nothing.
    expect(pgEnums.size).toBeGreaterThanOrEqual(25);
    expect(pgEnums.get("visit_status")).toEqual(["open", "closed", "cancelled"]);
  });

  it("maps every Postgres enum to a TS member array (or an explicit SKIP)", () => {
    const unmapped = [...pgEnums.keys()].filter(
      (name) => !(name in ENUM_TO_ARRAY) && !SKIP.includes(name),
    );
    expect(
      unmapped,
      `New Postgres enum(s) with no TS counterpart: [${unmapped.join(", ")}]. ` +
        "Add a derived union + member array in types/healthcare.ts and map it " +
        "in ENUM_TO_ARRAY, or add it to SKIP with a comment explaining why.",
    ).toEqual([]);
  });

  it("has no stale mapping entries (every mapped enum exists in the schema)", () => {
    const stale = Object.keys(ENUM_TO_ARRAY).filter((name) => !pgEnums.has(name));
    expect(
      stale,
      `ENUM_TO_ARRAY maps enum(s) that no longer exist in schema.sql: [${stale.join(", ")}]`,
    ).toEqual([]);
  });

  it("every enum's member list matches exactly (same members, same order)", () => {
    const drift = Object.entries(ENUM_TO_ARRAY)
      .map(([name, tsMembers]) => diffEnum(name, pgEnums.get(name) ?? [], tsMembers))
      .filter((d): d is string => d !== null);
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("check-constraint unions (follow-up kind/status, meal timing) match", () => {
    const checks = extractCheckInConstraints(sql);
    // kind/status live on follow_up_tasks; meal_timing on prescriptions. The
    // column names are the only `check (col in (…))` constraints in the schema
    // today.
    for (const [column, tsMembers] of Object.entries(CHECK_TO_ARRAY)) {
      const sqlMembers = checks.get(column);
      expect(
        sqlMembers,
        `Expected a check (${column} in (…)) constraint in schema.sql`,
      ).toBeDefined();
      const drift = diffEnum(`check:${column}`, sqlMembers ?? [], tsMembers);
      expect(drift, drift ?? "").toBeNull();
    }
  });
});

describe("drift detection (self-test on a mutated copy)", () => {
  it("catches a member removed from the SQL side", () => {
    const mutated = extractPgEnums(
      "create type visit_status as enum ('open', 'closed');",
    );
    expect(
      diffEnum("visit_status", mutated.get("visit_status")!, VISIT_STATUSES),
    ).toMatch(/extra in TS: \[cancelled\]/);
  });

  it("catches a member added on the SQL side", () => {
    const mutated = extractPgEnums(
      "create type visit_status as enum ('open', 'closed', 'cancelled', 'archived');",
    );
    expect(
      diffEnum("visit_status", mutated.get("visit_status")!, VISIT_STATUSES),
    ).toMatch(/missing in TS: \[archived\]/);
  });

  it("catches a re-ordered member list", () => {
    const mutated = extractPgEnums(
      "create type visit_status as enum ('closed', 'open', 'cancelled');",
    );
    expect(
      diffEnum("visit_status", mutated.get("visit_status")!, VISIT_STATUSES),
    ).toMatch(/different ORDER/);
  });

  it("parses the nullable check form (col is null or col in (…))", () => {
    const checks = extractCheckInConstraints(
      "alter table p add constraint c check (meal_timing is null or meal_timing in ('with_meals','without_meals','neutral'));",
    );
    expect(checks.get("meal_timing")).toEqual([
      "with_meals",
      "without_meals",
      "neutral",
    ]);
  });
});
