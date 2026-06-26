import { describe, expect, it } from "vitest";

import { en } from "./en";
import { fr } from "./fr";

/**
 * en/fr key-parity guard. `fr satisfies Messages` already enforces parity at
 * compile time, but this runtime test fails CI with a readable diff if the two
 * dictionaries ever drift — so a missing French string surfaces as a test
 * failure rather than a silent English fallback during a demo.
 */

/** Flatten a nested message dictionary to the set of its leaf dot-paths. */
function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n key parity", () => {
  const enKeys = new Set(leafKeys(en));
  const frKeys = new Set(leafKeys(fr));

  it("fr defines every en key (no English fallback at runtime)", () => {
    const missingInFr = [...enKeys].filter((k) => !frKeys.has(k)).sort();
    expect(missingInFr).toEqual([]);
  });

  it("fr defines no keys absent from en (no orphaned French strings)", () => {
    const extraInFr = [...frKeys].filter((k) => !enKeys.has(k)).sort();
    expect(extraInFr).toEqual([]);
  });

  it("both dictionaries expose the identical key set", () => {
    expect([...frKeys].sort()).toEqual([...enKeys].sort());
  });
});
