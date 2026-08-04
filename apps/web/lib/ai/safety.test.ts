import { describe, expect, it } from "vitest";

import { checkAllergies } from "@/lib/ai/safety";

const allergy = (substance: string, reaction: string | null = null) => ({
  substance,
  category: "drug" as string | null,
  reaction,
  severity: "severe" as string | null,
});

describe("checkAllergies", () => {
  it("flags a direct substance match", () => {
    const flags = checkAllergies([{ drugName: "Ibuprofen" }], [allergy("ibuprofen")]);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.severity).toBe("critical");
    expect(flags[0]!.source).toBe("allergy_check");
  });

  it("flags a same-class drug (penicillin allergy vs amoxicillin)", () => {
    const flags = checkAllergies(
      [{ drugName: "Amoxicillin" }],
      [allergy("Penicillin", "Anaphylaxis")],
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.message).toContain("Amoxicillin");
    expect(flags[0]!.message).toContain("Penicillin");
    expect(flags[0]!.message).toContain("Anaphylaxis");
  });

  it("flags co-amoxiclav for a penicillin-allergic patient", () => {
    const flags = checkAllergies([{ drugName: "Co-amoxiclav 625mg" }], [allergy("penicillin")]);
    expect(flags).toHaveLength(1);
  });

  it("does not flag an unrelated drug", () => {
    const flags = checkAllergies(
      [{ drugName: "Paracetamol" }, { drugName: "Artemether" }],
      [allergy("Penicillin"), allergy("Peanuts")],
    );
    expect(flags).toEqual([]);
  });

  it("emits at most one flag per suggested drug", () => {
    const flags = checkAllergies(
      [{ drugName: "Amoxicillin" }],
      [allergy("penicillin"), allergy("amoxicillin")],
    );
    expect(flags).toHaveLength(1);
  });

  it("handles food allergies without false positives", () => {
    const flags = checkAllergies([{ drugName: "Ceftriaxone" }], [allergy("Peanuts")]);
    expect(flags).toEqual([]);
  });
});
