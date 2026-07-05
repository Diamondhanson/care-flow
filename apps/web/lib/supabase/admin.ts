/**
 * Server-only Supabase admin client (service_role key). Bypasses RLS — used for
 * privileged tasks like provisioning staff logins (`auth.admin.createUser`).
 *
 * NEVER import the returned client into a client component. There is no
 * `server-only` package installed, so the boundary is enforced with a runtime
 * guard: calling this in a browser bundle throws immediately. Only `"use server"`
 * actions / route handlers / node scripts may use it.
 *
 * Lazily initialized so importing the module is side-effect-free (unit tests and
 * client bundles that only reference the server action's type don't trip the env
 * check or the window guard).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

/** The privileged service-role client. No session persistence. */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/admin.ts is server-only and must never run in the browser.",
    );
  }
  if (admin) return admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
  }

  admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
