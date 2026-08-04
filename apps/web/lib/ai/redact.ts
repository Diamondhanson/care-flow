/**
 * Server-side redaction pass (Phase 22, spec §6) — belt-and-braces.
 *
 * The client already omits direct identifiers from the context bundle, but
 * the server never assumes that: before a bundle is sent to the model or
 * logged into `ai_suggestions.context_json`, this pass walks the object and
 * DELETES any key that names a direct identifier (full name, phone, email,
 * national ID, address, …), wherever it appears.
 *
 * Pure and side-effect free so it unit-tests trivially.
 */

/**
 * Key names (normalized: lowercase, alphanumerics only) that must never
 * travel to the model. `mrn` and `anonymous_identifier` encode name initials
 * + birth date, so they count as identifiers too.
 */
const BANNED_KEYS = new Set([
  "fullname",
  "firstname",
  "lastname",
  "phone",
  "phonenumber",
  "email",
  "contactemail",
  "contactphone",
  "nationalid",
  "address",
  "mrn",
  "motherfirstname",
  "anonymousidentifier",
  "emergencycontactname",
  "emergencycontactphone",
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Deep-copy `value` with every banned key removed. `removed` lists the paths
 * that were stripped (useful in tests and for a server-side warning log —
 * a non-empty list means the client sent something it never should have).
 */
export function redactContext<T>(value: T): { value: T; removed: string[] } {
  const removed: string[] = [];

  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (BANNED_KEYS.has(normalizeKey(key))) {
          removed.push(path ? `${path}.${key}` : key);
          continue;
        }
        out[key] = walk(val, path ? `${path}.${key}` : key);
      }
      return out;
    }
    return node;
  };

  return { value: walk(value, "") as T, removed };
}
