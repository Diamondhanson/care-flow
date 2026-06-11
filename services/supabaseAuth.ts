/**
 * supabaseAuth — real Supabase Auth, replacing the mock session (Phase 18a).
 *
 * Staff sign in with a username + password; we map the username to its synthetic
 * email and call `supabase.auth.signInWithPassword`. The authenticated user's
 * `user_metadata` carries everything the UI needs (name, role, hospital) plus a
 * bridge to the still-mock data layer (`mock_*` ids). Phase 18b swaps the data
 * layer to Postgres and drops the bridge.
 *
 * This module is browser-side (imports the anon client). Privileged work
 * (creating logins) lives in the server action `app/actions/auth.ts`.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  synthEmail,
  type StaffAuthMetadata,
} from "@/lib/supabase/identity";
import type { User } from "@supabase/supabase-js";

/** The resolved, signed-in identity (auth uid + the staff metadata). */
export interface AuthIdentity extends StaffAuthMetadata {
  userId: string;
}

/** Pull a usable identity out of a Supabase user's metadata, or null. */
export function metaToIdentity(user: User | null | undefined): AuthIdentity | null {
  if (!user) return null;
  const m = (user.user_metadata ?? {}) as Partial<StaffAuthMetadata>;
  if (!m.mock_staff_id || !m.mock_hospital_id) return null;
  return {
    userId: user.id,
    username: m.username ?? "",
    full_name: m.full_name ?? "",
    role: m.role ?? "",
    hospital_id: m.hospital_id ?? "",
    mock_hospital_id: m.mock_hospital_id,
    mock_staff_id: m.mock_staff_id,
  };
}

/** Sign in with a staff username + password. Throws on bad credentials. */
export async function signInWithUsername(
  username: string,
  password: string,
): Promise<AuthIdentity> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: synthEmail(username),
    password,
  });
  if (error) throw error;
  const identity = metaToIdentity(data.user);
  if (!identity) {
    // Authenticated, but the login is not linked to a staff record.
    await supabase.auth.signOut();
    throw new Error("This login is not linked to a staff account.");
  }
  return identity;
}

/** Resolve the persisted session's identity, or null when signed out. */
export async function getActiveIdentity(): Promise<AuthIdentity | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return metaToIdentity(data.session?.user);
}

// ===========================================================================
// Verified tenant onboarding (Phase 18.5) — Google + email-OTP founder sign-in
// ===========================================================================
// A founding admin verifies their identity FIRST (here), then creates their
// hospital via `createHospitalForCurrentUser` (the SECURITY DEFINER RPC). Unlike
// the staff path above, these users are NOT keyed on a synthetic email and have
// no mock_* metadata until a hospital exists — so the session may resolve to a
// raw auth user with no staff identity yet (the "needs onboarding" state, which
// the AuthProvider handles).

/** The raw signed-in Supabase user (verified email/Google), or null. */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.user ?? null;
}

/**
 * Subscribe to raw auth-user changes (sign-in / sign-out / token refresh /
 * OAuth-return). The callback gets the Supabase user or null. Returns an
 * unsubscribe function. Use this (rather than {@link onAuthChange}) when you
 * need to react to verified-but-not-yet-onboarded sessions too.
 */
export function onAuthUserChange(
  cb: (user: User | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(
    (_event, session) => {
      cb(session?.user ?? null);
    },
  );
  return () => data.subscription.unsubscribe();
}

/**
 * Start Google OAuth for founder sign-in. Redirects the browser to Google and
 * back to `redirectTo` (our `/auth/callback`), where the PKCE code is exchanged
 * for a session. Resolves once the redirect has been kicked off (the page then
 * navigates away), or throws if the provider call fails.
 */
export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

/**
 * Send a one-time login code to `email`. `shouldCreateUser` is true so a
 * brand-new founder is provisioned on first verification. The user then enters
 * the 6-digit code (see {@link verifyEmailOtp}).
 *
 * NOTE: the email Supabase sends must use the `{{ .Token }}` template so it
 * delivers a CODE, not a magic link (configured in Supabase — a manual step).
 */
export async function sendEmailOtp(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Verify the emailed OTP code, establishing a session. Throws on a bad code. */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<User> {
  const { data, error } = await getSupabaseClient().auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw error;
  if (!data.user) throw new Error("Verification failed.");
  return data.user;
}

/** Hospital details for {@link createHospitalForCurrentUser}. */
export interface CreateHospitalInput {
  name: string;
  region?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  admin_full_name?: string | null;
}

/**
 * Create the signed-in (verified) user's hospital + founding-admin staff row via
 * the `create_hospital_and_admin` SECURITY DEFINER RPC, and return the new
 * hospital id. Enforces one-hospital-per-owner server-side (a second attempt
 * surfaces a friendly "already belongs to a hospital" error). Must be called
 * with an active verified session.
 */
export async function createHospitalForCurrentUser(
  input: CreateHospitalInput,
): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc(
    "create_hospital_and_admin",
    {
      p_name: input.name.trim(),
      p_region: input.region?.trim() || null,
      p_contact_email: input.contact_email?.trim() || null,
      p_contact_phone: input.contact_phone?.trim() || null,
      p_admin_full_name: input.admin_full_name?.trim() || null,
    },
  );
  if (error) {
    if (/already belongs to a hospital/i.test(error.message)) {
      throw new Error("This account already has a hospital.");
    }
    throw new Error(error.message);
  }
  return data as string;
}

/** Clear the Supabase session. */
export async function signOutSupabase(): Promise<void> {
  await getSupabaseClient().auth.signOut();
}

/**
 * Subscribe to auth-state changes (sign-in / sign-out / token refresh). Returns
 * an unsubscribe function. The callback receives the resolved identity or null.
 */
export function onAuthChange(
  cb: (identity: AuthIdentity | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange(
    (_event, session) => {
      cb(metaToIdentity(session?.user));
    },
  );
  return () => data.subscription.unsubscribe();
}
