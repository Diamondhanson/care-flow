"use server";

/**
 * Privileged auth actions (Phase 18a). Provisioning a staff login requires the
 * service_role key (to create a Supabase Auth user), so it runs server-side.
 *
 * CareFlow's model: an admin creates a staff member with a *username* and a
 * password — no email. We mint a Supabase Auth user keyed on a synthetic email
 * (`<username>@careflow.local`, never deliverable, `email_confirm` set) and stash
 * the staff identity in `user_metadata`. The browser then signs in normally with
 * the username + password.
 */

import { randomUUID } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeUsername,
  synthEmail,
  type StaffAuthMetadata,
} from "@/lib/supabase/identity";
import type { HospitalId, StaffId } from "@/types/healthcare";

export interface ProvisionStaffLoginInput {
  username: string;
  password: string;
  full_name: string;
  role: string;
  /** Supabase hospitals.id (real UUID). */
  hospital_id: string;
  /** Mock-layer bridge ids (Phase 18a). */
  mock_hospital_id: HospitalId;
  mock_staff_id: StaffId;
  /**
   * The caller's current Supabase access token (Stage 6). Sessions live in the
   * browser's localStorage — not cookies — so the server can't read them
   * itself; the client passes its JWT and we verify it here.
   */
  accessToken: string;
}

export type ProvisionResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Verify the caller's JWT and require them to be an admin of `hospitalId`.
 * Shared by the privileged staff actions (Stage 6 hardening — these actions
 * are remotely invokable endpoints, so each must authenticate its caller).
 */
async function requireHospitalAdmin(
  accessToken: string,
  hospitalId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accessToken) return { ok: false, error: "Not authorized." };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data?.user) {
    return {
      ok: false,
      error: "Your session could not be verified — please sign in again.",
    };
  }
  const caller = data.user;
  const { data: callerRow } = await admin
    .from("staff")
    .select("role, hospital_id")
    .eq("user_id", caller.id)
    .maybeSingle();
  const meta = caller.user_metadata as Partial<StaffAuthMetadata> | undefined;
  const role = callerRow?.role ?? meta?.role;
  const callerHospital = callerRow?.hospital_id ?? meta?.hospital_id;
  if (role !== "admin" || !callerHospital || callerHospital !== hospitalId) {
    return {
      ok: false,
      error: "Only administrators of this hospital can manage staff logins.",
    };
  }
  return { ok: true };
}

/** Create a Supabase Auth login for a staff member. Admin-only (caller is
 * verified from their access token). Idempotency is the caller's concern; a
 * duplicate username surfaces as a friendly error. */
export async function provisionStaffLogin(
  input: ProvisionStaffLoginInput,
): Promise<ProvisionResult> {
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false, error: "Username is required." };
  if (!input.password || input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  // Stage 6: this used to be callable with no caller check at all — anyone who
  // could reach the action endpoint could mint a login. Now the caller must be
  // a signed-in admin of the hospital the login is being created for.
  const auth = await requireHospitalAdmin(input.accessToken, input.hospital_id);
  if (!auth.ok) return auth;

  const metadata: StaffAuthMetadata = {
    username,
    full_name: input.full_name,
    role: input.role,
    hospital_id: input.hospital_id,
    mock_hospital_id: input.mock_hospital_id,
    mock_staff_id: input.mock_staff_id,
  };

  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email: synthEmail(username),
    password: input.password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (error) {
    const msg = /already.*registered|exists/i.test(error.message)
      ? `The username "${username}" is already taken.`
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true, userId: data.user.id };
}

export interface ResetStaffPasswordInput {
  /** Supabase Auth user id of the staff login whose password is being reset. */
  userId: string;
  /** The new password the admin is handing to the staff member. */
  password: string;
  /**
   * The caller's current Supabase access token. Sessions live in the browser's
   * localStorage (see lib/supabase/client.ts) — not cookies — so the server
   * can't read them itself; the client passes its JWT and we verify it here.
   */
  accessToken: string;
}

export type ResetStaffPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Reset a staff member's login password (admin-only). Unlike
 * {@link provisionStaffLogin} — which has no caller check of its own — this
 * action authenticates the caller from their access token and requires them to
 * be an **admin of the same hospital** as the target staff member before
 * touching the target's password.
 */
export async function resetStaffPassword(
  input: ResetStaffPasswordInput,
): Promise<ResetStaffPasswordResult> {
  if (!input.password || input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!input.userId || !input.accessToken) {
    return { ok: false, error: "Not authorized." };
  }

  const admin = getSupabaseAdmin();

  // 1. Authenticate the caller: validate the JWT and resolve its auth user.
  const { data: callerData, error: callerError } = await admin.auth.getUser(
    input.accessToken,
  );
  if (callerError || !callerData?.user) {
    return { ok: false, error: "Your session could not be verified — please sign in again." };
  }
  const caller = callerData.user;

  // 2. Authorize: the caller must be an admin. Prefer the DB staff row (source
  //    of truth); fall back to the auth metadata bridge for legacy logins whose
  //    staff row hasn't synced.
  const { data: callerRow } = await admin
    .from("staff")
    .select("role, hospital_id")
    .eq("user_id", caller.id)
    .maybeSingle();
  const callerMeta = caller.user_metadata as Partial<StaffAuthMetadata> | undefined;
  const callerRole = callerRow?.role ?? callerMeta?.role;
  const callerHospitalId = callerRow?.hospital_id ?? callerMeta?.hospital_id;
  if (callerRole !== "admin" || !callerHospitalId) {
    return { ok: false, error: "Only administrators can reset staff passwords." };
  }

  // 3. The target must belong to the caller's hospital. Resolve via the staff
  //    row keyed on user_id, falling back to the target auth user's metadata.
  const { data: targetRow } = await admin
    .from("staff")
    .select("hospital_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  let targetHospitalId: string | undefined = targetRow?.hospital_id;
  if (!targetHospitalId) {
    const { data: targetUser } = await admin.auth.admin.getUserById(input.userId);
    const targetMeta = targetUser?.user?.user_metadata as
      | Partial<StaffAuthMetadata>
      | undefined;
    targetHospitalId = targetMeta?.hospital_id ?? targetMeta?.mock_hospital_id;
  }
  if (!targetHospitalId || targetHospitalId !== callerHospitalId) {
    return { ok: false, error: "This staff member does not belong to your hospital." };
  }

  // 4. All checks passed — set the new password.
  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    password: input.password,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ===========================================================================
// Hospital onboarding (Block B / Phase 17) — REAL Supabase-backed tenant signup
// ===========================================================================

export interface ProvisionHospitalInput {
  /** Hospital (tenant) details. */
  name: string;
  region?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** The founding admin's profile + login. */
  admin_full_name: string;
  admin_username: string;
  admin_password: string;
  admin_email?: string | null;
}

export type ProvisionHospitalResult =
  | { ok: true; hospitalId: string; staffId: string; userId: string }
  | { ok: false; error: string };

/**
 * Register a brand-new hospital and its founding admin **in Supabase** — the
 * privileged half of signup that the client can't do (the `hospitals` table has
 * no client INSERT policy, and minting an auth user needs the service role).
 *
 * Runs as the service role (RLS bypassed) and provisions three linked things in
 * order, rolling back in reverse if any step fails so we never leave an orphan:
 *   1. the `hospitals` row (trial subscription),
 *   2. the Supabase Auth user (synthetic `<username>@careflow.local`, with the
 *      real hospital + a pre-generated staff id stamped into `user_metadata`),
 *   3. the founding admin `staff` row, linked to the auth user via `user_id`.
 *
 * Once this returns ok, the client signs in normally and hydrates: RLS resolves
 * `current_hospital_id()` from the new staff row, so the fresh tenant's data
 * (just these two rows, for now) loads into the local cache.
 */
export async function provisionHospital(
  input: ProvisionHospitalInput,
): Promise<ProvisionHospitalResult> {
  // Stage 6: this legacy path (retained as an integration-test helper — the
  // public signup is the verified-onboarding RPC) is still a remotely
  // invokable action endpoint, i.e. unauthenticated tenant creation. Disable
  // it in production unless explicitly re-enabled.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_LEGACY_PROVISIONING !== "1"
  ) {
    return { ok: false, error: "This signup path is disabled." };
  }
  const name = input.name?.trim();
  const fullName = input.admin_full_name?.trim();
  const username = normalizeUsername(input.admin_username);

  if (!name) return { ok: false, error: "Hospital name is required." };
  if (!fullName) return { ok: false, error: "Admin name is required." };
  if (!username) return { ok: false, error: "Username is required." };
  if (!input.admin_password || input.admin_password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const admin = getSupabaseAdmin();
  const email = input.admin_email?.trim() || input.contact_email?.trim() || null;

  // 1. Hospital (tenant) row.
  const { data: hospital, error: hospitalError } = await admin
    .from("hospitals")
    .insert({
      name,
      region: input.region?.trim() || null,
      contact_email: input.contact_email?.trim() || null,
      contact_phone: input.contact_phone?.trim() || null,
      subscription_status: "trial",
    })
    .select("id")
    .single();
  if (hospitalError || !hospital) {
    return {
      ok: false,
      error: hospitalError?.message ?? "Could not create the hospital.",
    };
  }
  const hospitalId = hospital.id as string;

  // 2. Auth login. Pre-generate the staff id so the metadata bridge is complete
  //    in one pass (sign-in requires mock_staff_id + mock_hospital_id present).
  const staffId = randomUUID();
  const metadata: StaffAuthMetadata = {
    username,
    full_name: fullName,
    role: "admin",
    hospital_id: hospitalId,
    // Fresh UUIDs from the admin provisioning path; brand them here.
    mock_hospital_id: hospitalId as HospitalId,
    mock_staff_id: staffId as StaffId,
  };
  const { data: created, error: userError } =
    await admin.auth.admin.createUser({
      email: synthEmail(username),
      password: input.admin_password,
      email_confirm: true,
      user_metadata: metadata,
    });
  if (userError || !created?.user) {
    await admin.from("hospitals").delete().eq("id", hospitalId);
    const msg =
      userError && /already.*registered|exists/i.test(userError.message)
        ? `The username "${username}" is already taken.`
        : (userError?.message ?? "Could not create the admin login.");
    return { ok: false, error: msg };
  }
  const userId = created.user.id;

  // 3. Founding admin staff row, linked to the auth user.
  const { error: staffError } = await admin.from("staff").insert({
    id: staffId,
    hospital_id: hospitalId,
    user_id: userId,
    full_name: fullName,
    role: "admin",
    username,
    email,
    is_active: true,
  });
  if (staffError) {
    await admin.auth.admin.deleteUser(userId);
    await admin.from("hospitals").delete().eq("id", hospitalId);
    return { ok: false, error: staffError.message };
  }

  return { ok: true, hospitalId, staffId, userId };
}
