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

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeUsername,
  synthEmail,
  type StaffAuthMetadata,
} from "@/lib/supabase/identity";

export interface ProvisionStaffLoginInput {
  username: string;
  password: string;
  full_name: string;
  role: string;
  /** Supabase hospitals.id (real UUID). */
  hospital_id: string;
  /** Mock-layer bridge ids (Phase 18a). */
  mock_hospital_id: string;
  mock_staff_id: string;
}

export type ProvisionResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/** Create a Supabase Auth login for a staff member. Idempotency is the caller's
 * concern; a duplicate username surfaces as a friendly error. */
export async function provisionStaffLogin(
  input: ProvisionStaffLoginInput,
): Promise<ProvisionResult> {
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false, error: "Username is required." };
  if (!input.password || input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

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
