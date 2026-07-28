/**
 * Regression guard for the "silently empty table" hydration bug.
 *
 * Windowed hydration filters each table on a timestamp column. Four tables
 * (admissions, treatment_records, results, care_plan_entries) have NO
 * `created_at` — they use admitted_at / recorded_at. Filtering those on
 * `created_at` makes Postgres raise 42703, which the fetch layer used to
 * swallow as "missing table" and hydrate as EMPTY. The visible damage: no
 * admitted patients on the care-plan board, zeroed admission stats, and vitals
 * / lab results vanishing from the record after a reload.
 *
 * This test reads the real schema and asserts every window column exists, so
 * adding a table with a non-standard timestamp can never regress it silently.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { windowColumnFor } from "@/services/supabaseData";

const SCHEMA = readFileSync(
  join(process.cwd(), "../../packages/db/schema.sql"),
  "utf8",
);

/** Column names declared in one `create table if not exists <name> (...)` block. */
function columnsOf(table: string): string[] {
  const start = SCHEMA.indexOf(`create table if not exists ${table} (`);
  if (start === -1) return [];
  const end = SCHEMA.indexOf("\n);", start);
  return SCHEMA.slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => /^[a-z_]+$/.test(name));
}

/** Every table hydration windows by time (i.e. not fetched in full). */
const WINDOWED_TABLES = [
  "visits",
  "consultations",
  "diagnoses",
  "ros_responses",
  "orders",
  "results",
  "prescriptions",
  "medication_administrations",
  "treatment_records",
  "admissions",
  "transfers",
  "care_plan_items",
  "care_plan_entries",
  "charges",
  "notifications",
  "follow_up_tasks",
];

describe("windowed hydration filter columns", () => {
  it("resolves the four tables that have no created_at to their real column", () => {
    expect(windowColumnFor("admissions")).toBe("admitted_at");
    expect(windowColumnFor("treatment_records")).toBe("recorded_at");
    expect(windowColumnFor("results")).toBe("recorded_at");
    expect(windowColumnFor("care_plan_entries")).toBe("recorded_at");
  });

  it("defaults every other table to created_at", () => {
    expect(windowColumnFor("consultations")).toBe("created_at");
    expect(windowColumnFor("orders")).toBe("created_at");
  });

  it.each(WINDOWED_TABLES)(
    "%s is filtered on a column that exists in schema.sql",
    (table) => {
      const columns = columnsOf(table);
      expect(columns.length).toBeGreaterThan(0);
      expect(columns).toContain(windowColumnFor(table));
    },
  );
});
