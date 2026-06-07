/**
 * Shared auth-identity helpers (no secrets — safe on client and server).
 *
 * CareFlow staff log in with a *username + password*, not an email (Phase 18a).
 * Supabase Auth is email-keyed, so we map each username to a synthetic,
 * non-deliverable email. `email_confirm` is set at creation time, so no mail is
 * ever sent to this address — it is purely the auth primary key.
 *
 * Usernames are treated as globally unique at the auth layer (the synthetic
 * email must be unique). The `staff` table additionally enforces
 * `unique (hospital_id, username)`. When multi-tenant username collisions become
 * real (Phase 18b), switch this to encode the hospital id in the local part.
 */

/** Synthetic email domain. `.local` is never deliverable — intentional. */
export const SYNTH_EMAIL_DOMAIN = "careflow.local";

/** Normalize a username: trimmed, lower-cased. Used for both storage + lookup. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Map a staff username to its synthetic Supabase Auth email. */
export function synthEmail(username: string): string {
  return `${normalizeUsername(username)}@${SYNTH_EMAIL_DOMAIN}`;
}

/**
 * The shape we stash in a Supabase auth user's `user_metadata`. During Phase 18a
 * the app still reads its domain data from the mock layer, so the session needs
 * to know which *mock* identity an authenticated user maps to. Phase 18b (real
 * data layer) drops the `mock_*` fields and resolves the staff row from the DB.
 */
export interface StaffAuthMetadata {
  username: string;
  full_name: string;
  role: string;
  /** Supabase hospitals.id (real UUID). */
  hospital_id: string;
  /** Bridge to the mock data layer (Phase 18a only). */
  mock_hospital_id: string;
  mock_staff_id: string;
}
