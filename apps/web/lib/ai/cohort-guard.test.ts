import { describe, expect, it } from "vitest";

import {
  CohortGuardError,
  describeCohortQuery,
  validateCohortQuery,
} from "@/lib/ai/cohort-guard";

const good = {
  table: "diagnoses",
  columns: ["description", "icd10_code", "created_at"],
  filters: [{ column: "description", op: "ilike", value: "%malaria%" }],
  orderBy: { column: "created_at", ascending: false },
  limit: 50,
};

describe("validateCohortQuery", () => {
  it("accepts a well-formed whitelisted query", () => {
    const q = validateCohortQuery(good);
    expect(q.table).toBe("diagnoses");
    expect(q.limit).toBe(50);
  });

  it("rejects a non-whitelisted table", () => {
    expect(() => validateCohortQuery({ ...good, table: "staff" })).toThrow(CohortGuardError);
    expect(() => validateCohortQuery({ ...good, table: "patients" })).toThrow(
      CohortGuardError,
    );
  });

  it("rejects a column that does not belong to the chosen table", () => {
    expect(() =>
      validateCohortQuery({ ...good, columns: ["description", "drug_name"] }),
    ).toThrow(/drug_name/);
  });

  it("rejects identifier columns outright (never whitelisted)", () => {
    expect(() => validateCohortQuery({ ...good, columns: ["full_name"] })).toThrow(
      CohortGuardError,
    );
  });

  it("rejects filters on un-whitelisted columns", () => {
    expect(() =>
      validateCohortQuery({
        ...good,
        filters: [{ column: "hospital_id", op: "eq", value: "x" }],
      }),
    ).toThrow(/hospital_id/);
  });

  it("rejects an oversized limit", () => {
    expect(() => validateCohortQuery({ ...good, limit: 5000 })).toThrow(CohortGuardError);
  });

  it("rejects value/op mismatches", () => {
    expect(() =>
      validateCohortQuery({
        ...good,
        filters: [{ column: "description", op: "in", value: "not-an-array" }],
      }),
    ).toThrow(CohortGuardError);
    expect(() =>
      validateCohortQuery({
        ...good,
        filters: [{ column: "description", op: "is_null", value: "x" }],
      }),
    ).toThrow(CohortGuardError);
    expect(() =>
      validateCohortQuery({
        ...good,
        filters: [{ column: "description", op: "eq" }],
      }),
    ).toThrow(CohortGuardError);
  });

  it("rejects anything that is not a plain read intent", () => {
    expect(() => validateCohortQuery("DELETE FROM visits")).toThrow(CohortGuardError);
    expect(() => validateCohortQuery(null)).toThrow(CohortGuardError);
  });
});

describe("describeCohortQuery", () => {
  it("produces a human-readable, hospital-scoped preview", () => {
    const preview = describeCohortQuery(validateCohortQuery(good));
    expect(preview).toContain("diagnoses");
    expect(preview).toContain("%malaria%");
    expect(preview).toContain("scoped to this hospital");
  });
});
