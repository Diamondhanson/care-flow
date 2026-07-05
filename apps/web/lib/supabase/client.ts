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
      // Verified-onboarding (Phase 18.5) adds Google OAuth, which returns to
      // `/auth/callback?code=…`. The PKCE flow stores a code verifier in this
      // client's storage at redirect time and exchanges the code for a session
      // on return; `detectSessionInUrl` lets the client complete that exchange
      // automatically. Email-OTP and the legacy username/password path don't use
      // the URL, so this is inert for them.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return client;
}
