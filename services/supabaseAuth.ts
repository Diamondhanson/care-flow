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
function metaToIdentity(user: User | null | undefined): AuthIdentity | null {
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
