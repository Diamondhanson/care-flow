import { describe, expect, it } from "vitest";

import { redactContext } from "@/lib/ai/redact";

describe("redactContext", () => {
  it("strips direct identifiers wherever they appear", () => {
    const input = {
      patient: {
        id: "x",
        full_name: "Jane Doe",
        phone: "+237 6 00 00 00 00",
        email: "jane@example.com",
        national_id: "CM123",
        initials: "JD",
      },
      nested: [{ mother_first_name: "N", address: "Douala", ok: true }],
      mrn: "981120JD - N",
    };

    const { value, removed } = redactContext(input);

    expect(removed.sort()).toEqual(
      [
        "patient.full_name",
        "patient.phone",
        "patient.email",
        "patient.national_id",
        "nested[0].mother_first_name",
        "nested[0].address",
        "mrn",
      ].sort(),
    );
    expect(JSON.stringify(value)).not.toMatch(/Jane|jane@|CM123|Douala|981120/);
    expect((value as { patient: { initials: string } }).patient.initials).toBe("JD");
    expect((value as { nested: { ok: boolean }[] }).nested[0]!.ok).toBe(true);
  });

  it("matches key variants case- and separator-insensitively", () => {
    const { removed } = redactContext({ FullName: "x", "national-id": "y", eMail: "z" });
    expect(removed).toHaveLength(3);
  });

  it("leaves a clean bundle untouched", () => {
    const clean = { patient: { initials: "AB", ageYears: 40 }, subjective: "cough" };
    const { value, removed } = redactContext(clean);
    expect(removed).toEqual([]);
    expect(value).toEqual(clean);
  });
});
