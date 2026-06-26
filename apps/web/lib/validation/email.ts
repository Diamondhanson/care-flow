/**
 * Email validation + injection guards (security hardening).
 *
 * Two jobs:
 *   1. `isValidEmail` — a stricter, single source of truth for "is this a
 *      well-formed address" used by both client forms and server code (replaces
 *      three copies of a weak inline regex).
 *   2. `assertNoHeaderInjection` — the guardrail for transactional email. CR/LF
 *      and NUL bytes in a value that flows into an email header (To/Subject/etc.)
 *      or template let an attacker inject extra headers or smuggle content. This
 *      throws on any such byte. **When a real provider (e.g. Resend) is wired,
 *      every user-controlled variable passed into a subject/recipient/template
 *      MUST pass through this and be HTML-escaped before interpolation.**
 *
 * Kept dependency-free (no zod) so it can be imported anywhere, including the
 * edge/client, without pulling the schema layer.
 */

/** CR, LF, or NUL — the bytes used for email header injection / smuggling. */
const HEADER_INJECTION_RE = /[\r\n\x00]/;
/** Any C0 control char (incl. CR/LF/NUL/TAB) or DEL — disallowed in an address. */
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
/**
 * Pragmatic address shape: non-space/non-@ local part, an @, a domain, a dot,
 * and a TLD of at least two chars. Stricter than the legacy
 * `^[^\s@]+@[^\s@]+\.[^\s@]+$` (which accepted `a@b.c`). Full RFC 5322 is
 * intentionally not attempted — overbroad regexes are their own footgun.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMAIL_MAX_LENGTH = 254;

/** Trim + lowercase — the canonical form for comparison/storage. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** True if `value` is a well-formed, control-char-free email address. */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return (
    v.length > 0 &&
    v.length <= EMAIL_MAX_LENGTH &&
    !CONTROL_CHAR_RE.test(v) &&
    EMAIL_RE.test(v)
  );
}

/**
 * Throw if `value` contains a CR, LF, or NUL — the bytes used for email header
 * injection / content smuggling. Call this on any user-controlled string before
 * it reaches an email header, subject, recipient list, or template variable.
 */
export function assertNoHeaderInjection(value: string, field = "value"): void {
  if (HEADER_INJECTION_RE.test(value)) {
    throw new Error(`Invalid ${field}: control characters are not allowed.`);
  }
}
