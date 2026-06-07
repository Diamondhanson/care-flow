/**
 * Browser Supabase client (anon key). Used for real auth — sign-in, session
 * persistence, sign-out (Phase 18a). The anon key is safe to ship to the
 * browser; row-level security gates what it can read once the data layer is
 * wired (Phase 18b).
 *
 * Lazily initialized: importing this module is side-effect-free, so unit tests
 * (and any code path that never signs in) don't need the env vars present. The
 * client is created — and the env validated — on first actual use.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** The singleton browser client; persists the session to localStorage. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.",
    );
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
