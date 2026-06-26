"use server";

/**
 * Email-OTP delivery via Resend (server action).
 *
 * Replaces Supabase's built-in OTP email with our own delivery: we mint the
 * one-time code with the Supabase admin API (`generateLink`, which returns the
 * code WITHOUT sending an email) and deliver it through Resend. The client still
 * verifies the code with the anon `verifyOtp` (type "email"), so the session is
 * established in the browser exactly as before — only the delivery channel
 * changed.
 *
 * Runs server-side (service-role key + Resend key never reach the browser).
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendOtpEmail } from "@/lib/email/resend";
import { normalizeEmail } from "@careflow/shared/validation/email";
import { parseOrError } from "@careflow/shared/validation/primitives";
import { EmailOtpSchema } from "@careflow/shared/validation/schemas";

export type RequestOtpResult = { ok: true } | { ok: false; error: string };

// Lightweight in-memory throttle to blunt email-bombing (per server instance).
// Not distributed — a backstop, not the only line of defence (Supabase Auth has
// its own rate limits too).
const COOLDOWN_MS = 30_000;
const lastSentAt = new Map<string, number>();

function isAlreadyRegistered(message: string | undefined): boolean {
  return !!message && /already.*registered|already been registered|exists/i.test(message);
}

/**
 * Mint an OTP for `email` and deliver it via Resend. Returns a generic success
 * even when throttled, so the response never leaks whether an account exists or
 * how recently a code was requested.
 */
export async function requestEmailOtp(email: string): Promise<RequestOtpResult> {
  const parsed = parseOrError(EmailOtpSchema, { email });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const recipient = normalizeEmail(email);

  const now = Date.now();
  const previous = lastSentAt.get(recipient);
  if (previous && now - previous < COOLDOWN_MS) {
    return { ok: true }; // silently throttle; a valid code is already in flight
  }
  lastSentAt.set(recipient, now);

  try {
    const admin = getSupabaseAdmin();

    // Ensure the auth user exists (parity with the old shouldCreateUser:true).
    // A passwordless, email-confirmed user; "already registered" is expected for
    // returning owners (incl. Google sign-ups) and is ignored.
    const { error: createError } = await admin.auth.admin.createUser({
      email: recipient,
      email_confirm: true,
    });
    if (createError && !isAlreadyRegistered(createError.message)) {
      throw new Error(createError.message);
    }

    // Generate (do NOT send) the OTP, then deliver it ourselves via Resend.
    const { data, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: recipient,
    });
    if (linkError) throw new Error(linkError.message);

    const code = data.properties?.email_otp;
    if (!code) throw new Error("Could not generate a sign-in code.");

    await sendOtpEmail(recipient, code);
    return { ok: true };
  } catch (e) {
    // On failure, clear the cooldown so the user can retry immediately.
    lastSentAt.delete(recipient);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not send the sign-in code.",
    };
  }
}
