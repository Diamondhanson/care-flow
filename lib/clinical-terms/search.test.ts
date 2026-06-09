import { describe, expect, it } from "vitest";

import type { ClinicalTerm } from "@/types/healthcare";
import {
  applyCustomTerm,
  applyTermUse,
  dedupeTerms,
  displayTerm,
  EMPTY_LEARNED,
  matchScore,
  matchStrings,
  normalizeText,
  rankTerms,
  termKey,
  type UsageMap,
} from "./search";

function term(partial: Partial<ClinicalTerm>): ClinicalTerm {
  return {
    category: "subjective",
    term_en: "Fever",
    term_fr: "Fièvre",
    ...partial,
  };
}

describe("normalizeText", () => {
  it("lowercases, strips diacritics and trims", () => {
    expect(normalizeText("  Fièvre ")).toBe("fievre");
    expect(normalizeText("CÉPHALÉE")).toBe("cephalee");
  });
});

describe("matchStrings", () => {
  it("includes canonical terms and synonyms in both languages, dropping empties", () => {
    const strings = matchStrings(
      term({
        term_en: "Fever",
        term_fr: "Fièvre",
        synonyms_en: ["pyrexia", ""],
        synonyms_fr: ["température élevée"],
      }),
    );
    expect(strings).toEqual([
      "Fever",
      "Fièvre",
      "pyrexia",
      "température élevée",
    ]);
  });
});

describe("matchScore", () => {
  const t = term({
    term_en: "Abdominal pain",
    term_fr: "Douleur abdominale",
    synonyms_en: ["belly pain"],
  });

  it("returns 1 for an empty query (everything matches equally)", () => {
    expect(matchScore(t, "")).toBe(1);
  });

  it("scores exact > prefix > word-prefix > substring", () => {
    expect(matchScore(t, normalizeText("abdominal pain"))).toBe(3);
    expect(matchScore(t, normalizeText("abdo"))).toBe(2);
    expect(matchScore(t, normalizeText("pain"))).toBe(1); // word inside
    expect(matchScore(t, normalizeText("inal"))).toBe(0.5); // substring only
  });

  it("is accent-insensitive across languages", () => {
    expect(matchScore(t, normalizeText("douleur"))).toBe(2);
    expect(matchScore(t, normalizeText("DOULEUR"))).toBe(2);
  });

  it("returns 0 when nothing matches", () => {
    expect(matchScore(t, normalizeText("xyz"))).toBe(0);
  });
});

describe("termKey", () => {
  it("is category + normalized canonical English", () => {
    expect(termKey("assessment", { term_en: "Malaria " })).toBe(
      "assessment::malaria",
    );
  });
});

describe("displayTerm", () => {
  it("prefers the active locale, falling back to the other language", () => {
    expect(displayTerm(term({ term_en: "Fever", term_fr: "Fièvre" }), "fr")).toBe(
      "Fièvre",
    );
    expect(displayTerm(term({ term_en: "Fever", term_fr: "" }), "fr")).toBe(
      "Fever",
    );
  });
});

describe("dedupeTerms", () => {
  it("keeps the first occurrence of each key across lists", () => {
    const custom = term({ term_en: "Malaria", category: "assessment", icd10: "B54" });
    const seed = term({ term_en: "Malaria", category: "assessment", icd10: null });
    const out = dedupeTerms([custom], [seed]);
    expect(out).toHaveLength(1);
    expect(out[0].icd10).toBe("B54"); // custom (first) wins
  });
});

describe("rankTerms", () => {
  const terms: ClinicalTerm[] = [
    term({ term_en: "Fever", term_fr: "Fièvre" }),
    term({ term_en: "Febrile seizure", term_fr: "Convulsion fébrile" }),
    term({ term_en: "Headache", term_fr: "Céphalée" }),
  ];

  it("filters out non-matches; equal scores fall through to alphabetical", () => {
    // Both "Fever" and "Febrile seizure" prefix-match "fe" (score 2); with no
    // usage, the tie breaks alphabetically ("Febrile" < "Fever").
    const out = rankTerms(terms, "fe", "en", {});
    expect(out.map((t) => t.term_en)).toEqual(["Febrile seizure", "Fever"]);
  });

  it("breaks ties by usage count then recency", () => {
    const usage: UsageMap = {
      [termKey("subjective", { term_en: "Febrile seizure" })]: {
        count: 5,
        lastUsedAt: 1000,
      },
    };
    const out = rankTerms(terms, "fe", "en", usage);
    expect(out[0].term_en).toBe("Febrile seizure"); // higher usage floats up
  });

  it("returns everything for an empty query, capped at limit", () => {
    const out = rankTerms(terms, "", "en", {}, 2);
    expect(out).toHaveLength(2);
  });
});

describe("applyTermUse", () => {
  it("increments count and stamps recency immutably", () => {
    const s1 = applyTermUse(EMPTY_LEARNED, "subjective", { term_en: "Fever" }, 100);
    const key = termKey("subjective", { term_en: "Fever" });
    expect(s1.usage[key]).toEqual({ count: 1, lastUsedAt: 100 });
    const s2 = applyTermUse(s1, "subjective", { term_en: "Fever" }, 200);
    expect(s2.usage[key]).toEqual({ count: 2, lastUsedAt: 200 });
    expect(EMPTY_LEARNED.usage[key]).toBeUndefined(); // original untouched
  });
});

describe("applyCustomTerm", () => {
  it("adds a new custom term", () => {
    const { state, term: added } = applyCustomTerm(
      EMPTY_LEARNED,
      "medication",
      "  Quinine ",
    );
    expect(added.term_en).toBe("Quinine");
    expect(added.term_fr).toBe("Quinine");
    expect(added.category).toBe("medication");
    expect(state.custom).toHaveLength(1);
  });

  it("carries extra structured fields", () => {
    const { term: added } = applyCustomTerm(EMPTY_LEARNED, "medication", "Quinine", {
      dose: "600 mg",
      route: "IV",
    });
    expect(added.dose).toBe("600 mg");
    expect(added.route).toBe("IV");
  });

  it("is idempotent by key (returns the existing term untouched)", () => {
    const first = applyCustomTerm(EMPTY_LEARNED, "medication", "Quinine");
    const second = applyCustomTerm(first.state, "medication", "quinine");
    expect(second.state).toBe(first.state); // no new state object
    expect(second.term).toBe(first.term);
  });
});
