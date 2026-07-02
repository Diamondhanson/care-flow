import { redirect } from "next/navigation";

import { getServerSupabase } from "./supabase/server";
import { getSupabaseAdmin } from "./supabase/admin";

/**
 * Owner-console authorization.
 *
 * Access is gated by a server-side **email allowlist** (`PLATFORM_ADMIN_EMAILS`,
 * comma-separated) — bootstrap-friendly (you know your email, not your future
 * auth uuid). On a successful check the signed-in user is recorded/refreshed in
 * the `platform_admins` table (for the audit record + future RLS). The allowlist
 * is the gate; the table is the ledger.
 *
 * Server-only. `requirePlatformAdmin()` redirects unauthenticated/unauthorized
 * visitors to /login, so a page can call it at the top and trust the result.
 */

export interface PlatformAdmin {
  userId: string;
  email: string;
  fullName: string | null;
}

function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Resolve the acting platform admin, or null if not signed in / not allowed. */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const email = user.email.toLowerCase();
  if (!allowlist().includes(email)) return null;

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? null;

  // Record the admin (service role; bypasses RLS on the no-policy table). Best
  // effort — never block access on a ledger write.
  try {
    await getSupabaseAdmin()
      .from("platform_admins")
      .upsert(
        { user_id: user.id, email, full_name: fullName },
        { onConflict: "user_id" },
      );
  } catch {
    /* ledger write is best-effort */
  }

  return { userId: user.id, email, fullName };
}

/** Require an authorized platform admin or redirect to /login. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) redirect("/login");
  return admin;
}
