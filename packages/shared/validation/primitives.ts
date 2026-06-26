/**
 * Reusable Zod primitives (security hardening).
 *
 * Design rule: these are **validation-only** — no transforms. A schema built
 * from them never rewrites the value (no trim/lowercase/coerce), it only accepts
 * or rejects. Callers keep their existing normalization (`?.trim() || null`),
 * so adding validation cannot change a stored value — it can only reject
 * malicious / oversized / malformed input. This guarantees zero behaviour
 * regression for data the app already accepts.
 *
 * Internal record references use {@link zId} (a relaxed 1–64 char string), NOT a
 * UUID: the local-first layer mints non-UUID ids like `dept_icu` / `ward_er`.
 * Real Postgres UUIDs (e.g. a server-action `hospital_id`) use {@link zUuid}.
 */

import { z } from "zod";

import { isValidEmail } from "./email";

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/; // C0 controls (incl. CR/LF/NUL/TAB) + DEL
const noControlChars = (v: string) => !CONTROL_CHAR_RE.test(v);
const noNulByte = (v: string) => !v.includes("\x00");

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** Required single-line text: non-empty after trim, capped, no control chars. */
export const zReqLine = (max: number) =>
  z
    .string()
    .max(max, `Too long (max ${max} characters).`)
    .refine((v) => v.trim().length > 0, "This field is required.")
    .refine(noControlChars, "Control characters are not allowed.");

/** Optional single-line text (string | null | undefined): capped, no control chars. */
export const zOptLine = (max: number) =>
  z
    .string()
    .max(max, `Too long (max ${max} characters).`)
    .refine(noControlChars, "Control characters are not allowed.")
    .nullish();

/** Optional multi-line free text (notes, complaints): capped, NUL rejected (newlines allowed). */
export const zOptText = (max: number) =>
  z
    .string()
    .max(max, `Too long (max ${max} characters).`)
    .refine(noNulByte, "Control characters are not allowed.")
    .nullish();

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** Internal (local-first) record id — relaxed, since seeds use ids like `dept_icu`. */
export const zId = z
  .string()
  .min(1, "An id is required.")
  .max(64, "Id is too long.")
  .refine(noControlChars, "Invalid id.");

export const zOptId = zId.nullish();

/** A real Postgres UUID — used only where Supabase supplies one (e.g. hospital_id). */
export const zUuid = z.uuid("Must be a valid id.");

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const zEmail = z.string().refine(isValidEmail, "Enter a valid email address.");

/** Optional email: accepts "", null, or undefined as "absent". */
export const zOptEmail = z
  .string()
  .refine((v) => v.trim() === "" || isValidEmail(v), "Enter a valid email address.")
  .nullish();

const isE164 = (v: string) => /^\+[1-9]\d{6,14}$/.test(v.trim());

export const zPhoneE164 = z.string().refine(isE164, "Enter a valid phone number.");

/** Optional phone: accepts "", null, or undefined as "absent". */
export const zOptPhone = z
  .string()
  .refine((v) => v.trim() === "" || isE164(v), "Enter a valid phone number.")
  .nullish();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const zPassword = z
  .string()
  .min(6, "Password must be at least 6 characters.")
  .max(128, "Password is too long.");

/** Username AFTER `normalizeUsername` (lowercased): letters, digits, . _ - only. */
export const zUsername = z
  .string()
  .regex(/^[a-z0-9._-]{3,40}$/, "Username must be 3–40 characters: letters, numbers, . _ or -");

/** A numeric OTP code. Length is set by the Supabase project (6–8 digits seen in
 *  practice — the hosted project mints 8), so accept that range rather than a
 *  hard 6. We deliver whatever Supabase mints, so the entered code must match. */
export const zOtpToken = z
  .string()
  .refine((v) => /^\d{6,8}$/.test(v.trim()), "Enter the code from your email.");

// ---------------------------------------------------------------------------
// Clinical enums (mirror types/healthcare.ts + the staff_role DB enum)
// ---------------------------------------------------------------------------

export const zStaffRole = z.enum([
  "doctor",
  "nurse",
  "admin",
  "lab_tech",
  "pharmacist",
  "receptionist",
]);

export const zSex = z.enum(["male", "female", "other", "unknown"]);

export const zVisitType = z.enum(["outpatient", "inpatient", "emergency"]);

export const zMarStatus = z.enum(["given", "held", "refused", "missed"]);

export const zCareStage = z.enum([
  "registration",
  "triage",
  "consultation",
  "diagnostics",
  "treatment",
  "discharge_planning",
  "discharged",
  "followed_up",
  "deceased",
]);

/** Triage acuity 1–5 (or null/undefined when untriaged). */
export const zTriageLevel = z.number().int().gte(1).lte(5).nullish();

/** Optional ISO date `YYYY-MM-DD` (or null/undefined). */
export const zOptIsoDate = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
  .nullish();

/** A bounded optional number (vitals etc.): null/undefined allowed. */
export const zOptNumber = (min: number, max: number) =>
  z.number().gte(min, `Must be ≥ ${min}.`).lte(max, `Must be ≤ ${max}.`).nullish();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** safeParse → a friendly `{ ok, error }` result for the server-action shape. */
export function parseOrError<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid input." };
}
