/**
 * Server-side, RLS-BOUND Supabase client for Route Handlers (Phase 22).
 *
 * CareFlow sessions live in the browser's localStorage (see
 * app/actions/auth.ts), so the server can't read them on its own. API routes
 * therefore authenticate with a bearer token: the client sends its Supabase
 * access token in the `Authorization` header, and this module builds a
 * Supabase client bound to that token — every query it makes runs AS the
 * caller, so RLS confines it to the caller's own hospital. No service-role
 * key is involved anywhere on this path.
 *
 * Server-only: same runtime guard as lib/supabase/admin.ts.
 */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { StaffRole } from "@careflow/shared";

/** Thrown by the guards below; route handlers map it to an HTTP response. */
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** A caller who passed authentication + staff lookup. */
export interface CallerIdentity {
  supabase: SupabaseClient;
  user: User;
  staff: {
    id: string;
    role: StaffRole;
    hospital_id: string;
    full_name: string;
  };
}

/** Build a per-request client that runs every query as the token's user. */
export function getBearerClient(accessToken: string): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/server.ts is server-only and must never run in the browser.",
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new AuthError(
      503,
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Verify the request's bearer token and resolve the caller's staff row
 * (id / role / hospital) through the RLS-bound client itself. Throws
 * AuthError(401) for a missing/invalid token, 403 when the user has no
 * active staff row or an insufficient role.
 */
export async function requireStaff(
  request: Request,
  allowedRoles: readonly StaffRole[],
): Promise<CallerIdentity> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new AuthError(401, "Missing Authorization: Bearer <access token> header.");
  }

  const supabase = getBearerClient(token);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new AuthError(401, "Invalid or expired session token.");
  }

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("id, role, hospital_id, full_name, is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (staffError) {
    throw new AuthError(500, `Staff lookup failed: ${staffError.message}`);
  }
  if (!staff || !staff.is_active) {
    throw new AuthError(403, "No active staff profile for this account.");
  }
  if (!allowedRoles.includes(staff.role as StaffRole)) {
    throw new AuthError(403, `This feature requires role: ${allowedRoles.join(" / ")}.`);
  }

  return {
    supabase,
    user: userData.user,
    staff: {
      id: staff.id as string,
      role: staff.role as StaffRole,
      hospital_id: staff.hospital_id as string,
      full_name: (staff.full_name as string) ?? "",
    },
  };
}
