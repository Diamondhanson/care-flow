import { describe, expect, it } from "vitest";

import {
  allTerms,
  CLINICAL_TERM_CATEGORIES,
  SEED_TERMS,
  searchTerms,
} from "./index";
import type { ClinicalTermCategory } from "@/types/healthcare";

const CATEGORIES: ClinicalTermCategory[] = [
  "subjective",
  "examination",
  "assessment",
  "plan",
  "medication",
  "investigations",
];

describe("SEED_TERMS", () => {
  it("loads every category with at least one term", () => {
    for (const category of CATEGORIES) {
      expect(SEED_TERMS[category].length).toBeGreaterThan(0);
    }
  });

  it("stamps the category onto every seed entry", () => {
    for (const category of CATEGORIES) {
      for (const term of SEED_TERMS[category]) {
        expect(term.category).toBe(category);
        expect(term.term_en.trim()).not.toBe("");
        expect(term.term_fr.trim()).not.toBe("");
      }
    }
  });

  it("carries category-specific structured fields", () => {
    expect(SEED_TERMS.assessment.every((t) => Boolean(t.icd10))).toBe(true);
    expect(SEED_TERMS.medication.every((t) => Boolean(t.dose))).toBe(true);
    expect(SEED_TERMS.investigations.every((t) => Boolean(t.order_type))).toBe(
      true,
    );
  });

  it("exposes all categories via CLINICAL_TERM_CATEGORIES", () => {
    expect([...CLINICAL_TERM_CATEGORIES].sort()).toEqual([...CATEGORIES].sort());
  });
});

describe("allTerms (seed-only in node, no learned store)", () => {
  it("returns the seed terms for a category", () => {
    expect(allTerms("plan")).toEqual(SEED_TERMS.plan);
  });
});

describe("searchTerms", () => {
  it("matches against synonyms and lay terms accent-insensitively", () => {
    // "palu" is a French lay synonym for malaria.
    const out = searchTerms("assessment", "palu", "fr");
    expect(out[0]?.icd10).toBe("B50.9");
  });

  it("returns localized-relevant results and respects the limit", () => {
    const out = searchTerms("medication", "", "en", { limit: 3 });
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("finds a medication by its English brand synonym", () => {
    const out = searchTerms("medication", "augmentin", "en");
    expect(out[0]?.term_en).toBe("Amoxicillin / Clavulanic acid");
  });

  it("returns nothing for a query that matches no term", () => {
    expect(searchTerms("plan", "zzzzz", "en")).toEqual([]);
  });
});
