import { describe, expect, it } from "vitest";

import type {
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
} from "@/types/healthcare";
import {
  CARE_NEED_CATEGORIES,
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
  activeNeedCount,
  hasHandoverWaiting,
  latestHandover,
  sortCarePlanItems,
} from "./care-plans";
import { translate } from "@/i18n";

function item(
  status: CarePlanItem["status"],
  created_at: string,
): Pick<CarePlanItem, "status" | "created_at"> {
  return { status, created_at };
}

function entry(
  is_handover: boolean,
  recorded_at: string,
): Pick<CarePlanEntry, "is_handover" | "recorded_at"> {
  return { is_handover, recorded_at };
}

describe("category maps", () => {
  it("labels and icons every category in the canonical list", () => {
    for (const cat of CARE_NEED_CATEGORIES) {
      expect(CARE_NEED_CATEGORY_LABEL[cat]).toBeTruthy();
      expect(CARE_NEED_CATEGORY_ICON[cat]).toBeTruthy();
      // The label key resolves to non-empty English copy.
      expect(translate("en", CARE_NEED_CATEGORY_LABEL[cat]).length).toBeGreaterThan(0);
    }
  });

  it("covers all 14 Henderson components with no duplicates", () => {
    expect(CARE_NEED_CATEGORIES).toHaveLength(14);
    expect(new Set(CARE_NEED_CATEGORIES).size).toBe(14);
  });

  it("resolves a couple of known labels", () => {
    expect(translate("en", CARE_NEED_CATEGORY_LABEL.hygiene)).toBe("Hygiene");
    expect(translate("fr", CARE_NEED_CATEGORY_LABEL.safety)).toBe("Sécurité");
  });
});

describe("sortCarePlanItems", () => {
  it("puts active needs before resolved, oldest-first within a status", () => {
    const sorted = sortCarePlanItems([
      item("resolved", "2026-01-03T00:00:00Z"),
      item("active", "2026-01-02T00:00:00Z"),
      item("resolved", "2026-01-01T00:00:00Z"),
      item("active", "2026-01-04T00:00:00Z"),
    ]);
    expect(sorted.map((i) => `${i.status}@${i.created_at}`)).toEqual([
      "active@2026-01-02T00:00:00Z",
      "active@2026-01-04T00:00:00Z",
      "resolved@2026-01-01T00:00:00Z",
      "resolved@2026-01-03T00:00:00Z",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      item("resolved", "2026-01-02T00:00:00Z"),
      item("active", "2026-01-01T00:00:00Z"),
    ];
    sortCarePlanItems(input);
    expect(input[0].status).toBe("resolved");
  });
});

describe("activeNeedCount", () => {
  it("counts only active items", () => {
    expect(
      activeNeedCount([
        item("active", "a"),
        item("resolved", "b"),
        item("active", "c"),
      ]),
    ).toBe(2);
  });

  it("is zero for an empty list", () => {
    expect(activeNeedCount([])).toBe(0);
  });
});

describe("latestHandover", () => {
  it("returns the most recent handover note, ignoring non-handover entries", () => {
    const result = latestHandover([
      entry(false, "2026-01-05T00:00:00Z"),
      entry(true, "2026-01-02T00:00:00Z"),
      entry(true, "2026-01-04T00:00:00Z"),
    ]);
    expect(result?.recorded_at).toBe("2026-01-04T00:00:00Z");
  });

  it("returns null when there is no handover", () => {
    expect(latestHandover([entry(false, "2026-01-01T00:00:00Z")])).toBeNull();
    expect(latestHandover([])).toBeNull();
  });
});

describe("hasHandoverWaiting", () => {
  it("is true when at least one handover exists", () => {
    expect(hasHandoverWaiting([entry(false, "a"), entry(true, "b")])).toBe(true);
  });

  it("is false with no handover entries", () => {
    expect(hasHandoverWaiting([entry(false, "a")])).toBe(false);
    expect(hasHandoverWaiting([])).toBe(false);
  });
});

// Exhaustiveness guard: a representative category resolves in both locales so a
// missing i18n key fails here as well as in tsc.
describe("i18n parity for categories", () => {
  it.each(CARE_NEED_CATEGORIES)("%s resolves in en and fr", (cat: CareNeedCategory) => {
    expect(translate("en", CARE_NEED_CATEGORY_LABEL[cat])).not.toContain("carePlan.");
    expect(translate("fr", CARE_NEED_CATEGORY_LABEL[cat])).not.toContain("carePlan.");
  });
});
