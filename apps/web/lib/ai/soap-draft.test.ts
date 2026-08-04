import { describe, expect, it } from "vitest";

import { mergeChipValue, textToChipLines } from "@/lib/ai/soap-draft";

describe("textToChipLines", () => {
  it("splits prose into one chip per sentence", () => {
    expect(
      textToChipLines(
        "Consider community-acquired pneumonia. Malaria should be excluded! Review in 48 hours?",
      ),
    ).toEqual([
      "Consider community-acquired pneumonia.",
      "Malaria should be excluded!",
      "Review in 48 hours?",
    ]);
  });

  it("also splits on newlines and drops empties", () => {
    expect(textToChipLines("Line one\n\n  Line two  \n")).toEqual(["Line one", "Line two"]);
  });

  it("keeps a single sentence as a single chip", () => {
    expect(textToChipLines("Encourage fluids and antipyretics")).toEqual([
      "Encourage fluids and antipyretics",
    ]);
  });
});

describe("mergeChipValue", () => {
  it("fills an empty field", () => {
    expect(mergeChipValue("", "First point. Second point.")).toBe(
      "First point.\nSecond point.",
    );
  });

  it("appends to existing chips without disturbing them", () => {
    expect(mergeChipValue("Doctor's own chip", "AI point one. AI point two.")).toBe(
      "Doctor's own chip\nAI point one.\nAI point two.",
    );
  });

  it("skips lines the field already contains", () => {
    expect(mergeChipValue("AI point one.", "AI point one. AI point two.")).toBe(
      "AI point one.\nAI point two.",
    );
  });
});
