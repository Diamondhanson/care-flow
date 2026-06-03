import { describe, expect, it } from "vitest";

import type { BedStatus } from "@/types/healthcare";
import {
  BED_STATUS_LABEL,
  BED_STATUS_TOKEN,
  MANUAL_BED_STATUSES,
  groupByFloor,
  hasAvailableBed,
  nextBedLabels,
  tallyBeds,
} from "./floor-map";
import { translate } from "@/i18n";

function bed(status: BedStatus): { status: BedStatus } {
  return { status };
}

describe("label & token maps", () => {
  it("labels and tokenizes every bed status", () => {
    expect(translate("en", BED_STATUS_LABEL.free)).toBe("Free");
    expect(translate("en", BED_STATUS_LABEL.maintenance)).toBe("Maintenance");
    expect(BED_STATUS_TOKEN.occupied).toBe("treatment");
    expect(BED_STATUS_TOKEN.free).toBe("clearance");
  });

  it("never offers 'occupied' as a manual status", () => {
    expect(MANUAL_BED_STATUSES).not.toContain("occupied");
    expect(MANUAL_BED_STATUSES).toContain("free");
  });
});

describe("tallyBeds", () => {
  it("splits beds into occupied / available / unavailable", () => {
    const t = tallyBeds([
      bed("occupied"),
      bed("occupied"),
      bed("free"),
      bed("reserved"),
      bed("cleaning"),
      bed("maintenance"),
    ]);
    expect(t).toEqual({
      total: 6,
      occupied: 2,
      available: 1,
      unavailable: 3,
    });
  });

  it("is all zeroes for an empty ward", () => {
    expect(tallyBeds([])).toEqual({
      total: 0,
      occupied: 0,
      available: 0,
      unavailable: 0,
    });
  });
});

describe("hasAvailableBed", () => {
  it("is true only when a free bed exists", () => {
    expect(hasAvailableBed([bed("occupied"), bed("free")])).toBe(true);
    expect(hasAvailableBed([bed("occupied"), bed("cleaning")])).toBe(false);
    expect(hasAvailableBed([])).toBe(false);
  });
});

describe("nextBedLabels", () => {
  it("starts a fresh ward at Bed 1", () => {
    expect(nextBedLabels([], 3)).toEqual(["Bed 1", "Bed 2", "Bed 3"]);
  });

  it("continues past the highest existing trailing number", () => {
    expect(nextBedLabels(["Bed 1", "Bed 2"], 2)).toEqual(["Bed 3", "Bed 4"]);
  });

  it("reads the trailing number out of arbitrary labels", () => {
    expect(nextBedLabels(["ICU-04", "B-09"], 1)).toEqual(["Bed 10"]);
  });

  it("returns nothing for a non-positive count", () => {
    expect(nextBedLabels(["Bed 5"], 0)).toEqual([]);
    expect(nextBedLabels(["Bed 5"], -2)).toEqual([]);
  });
});

describe("groupByFloor", () => {
  it("buckets by floor in first-seen order, unassigned last", () => {
    const grouped = groupByFloor([
      { floor_label: "2nd Floor", id: "a" },
      { floor_label: null, id: "b" },
      { floor_label: "2nd Floor", id: "c" },
      { floor_label: "3rd Floor", id: "d" },
      { floor_label: "  ", id: "e" },
    ]);
    expect(grouped.map((g) => g.floor)).toEqual([
      "2nd Floor",
      "3rd Floor",
      "Unassigned floor",
    ]);
    expect(grouped[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(grouped[2].items.map((i) => i.id)).toEqual(["b", "e"]);
  });
});
