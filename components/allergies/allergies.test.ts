import { describe, expect, it } from "vitest";

import type { Allergy, AllergySeverity } from "@/types/healthcare";
import {
  ALLERGY_CATEGORY_LABEL,
  ALLERGY_SEVERITY_LABEL,
  ALLERGY_SEVERITY_RANK,
  ALLERGY_SEVERITY_TOKEN,
  allergyDisplayState,
  categoryForAllergen,
  highestSeverity,
  sortAllergiesBySeverity,
} from "./allergies";
import { translate } from "@/i18n";

function alg(
  severity: AllergySeverity,
  substance: string,
): Pick<Allergy, "severity" | "substance"> {
  return { severity, substance };
}

describe("label & token maps", () => {
  it("labels every category and severity", () => {
    expect(translate("en", ALLERGY_CATEGORY_LABEL.drug)).toBe("Drug");
    expect(translate("en", ALLERGY_CATEGORY_LABEL.environmental)).toBe("Environmental");
    expect(translate("en", ALLERGY_SEVERITY_LABEL.life_threatening)).toBe("Life-threatening");
  });

  it("escalates the worst severities to the alert token", () => {
    expect(ALLERGY_SEVERITY_TOKEN.life_threatening).toBe("treatment");
    expect(ALLERGY_SEVERITY_TOKEN.severe).toBe("treatment");
    expect(ALLERGY_SEVERITY_TOKEN.moderate).toBe("boarding");
    expect(ALLERGY_SEVERITY_TOKEN.mild).toBe("muted");
  });

  it("ranks life-threatening first and mild last", () => {
    expect(ALLERGY_SEVERITY_RANK.life_threatening).toBeLessThan(
      ALLERGY_SEVERITY_RANK.severe,
    );
    expect(ALLERGY_SEVERITY_RANK.mild).toBeGreaterThan(
      ALLERGY_SEVERITY_RANK.moderate,
    );
  });
});

describe("categoryForAllergen", () => {
  it("matches a known allergen case-insensitively", () => {
    expect(categoryForAllergen("penicillin")).toBe("drug");
    expect(categoryForAllergen("  Peanuts ")).toBe("food");
    expect(categoryForAllergen("Latex")).toBe("environmental");
  });

  it("returns null for an unknown substance", () => {
    expect(categoryForAllergen("Moondust")).toBeNull();
  });
});

describe("sortAllergiesBySeverity", () => {
  it("orders worst-first, then alphabetical within a level", () => {
    const sorted = sortAllergiesBySeverity([
      alg("mild", "Pollen"),
      alg("life_threatening", "Peanuts"),
      alg("moderate", "Aspirin"),
      alg("moderate", "Almonds"),
    ]);
    expect(sorted.map((a) => a.substance)).toEqual([
      "Peanuts",
      "Almonds",
      "Aspirin",
      "Pollen",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [alg("mild", "Pollen"), alg("severe", "Penicillin")];
    sortAllergiesBySeverity(input);
    expect(input[0].substance).toBe("Pollen");
  });
});

describe("highestSeverity", () => {
  it("returns the most dangerous level present", () => {
    expect(
      highestSeverity([alg("mild", "A"), alg("severe", "B"), alg("moderate", "C")]),
    ).toBe("severe");
  });

  it("returns null for an empty list", () => {
    expect(highestSeverity([])).toBeNull();
  });
});

describe("allergyDisplayState", () => {
  it("is has-allergies whenever any allergy exists, regardless of flag", () => {
    expect(allergyDisplayState(false, 2)).toBe("has-allergies");
    expect(allergyDisplayState(true, 1)).toBe("has-allergies");
  });

  it("is none only when confirmed and empty", () => {
    expect(allergyDisplayState(true, 0)).toBe("none");
  });

  it("is unassessed when empty and unconfirmed", () => {
    expect(allergyDisplayState(false, 0)).toBe("unassessed");
  });
});
