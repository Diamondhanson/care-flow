/**
 * Resend transactional email (server-only).
 *
 * Delivers the sign-in OTP code. The OTP is minted by Supabase Auth
 * (`admin.generateLink`) and handed to us, so the only user-controlled value
 * here is the recipient address — which is validated and run through the
 * header-injection guard before it reaches Resend. The email body is fully
 * static except for the 6-digit code (digits only), so there is no template
 * injection / XSS surface.
 *
 * This module must never be imported into a client bundle (it reads the secret
 * API key); a `window` guard enforces that, mirroring lib/supabase/admin.ts.
 */

import { Resend } from "resend";

import { assertNoHeaderInjection, isValidEmail } from "@/lib/validation/email";

let client: Resend | null = null;

function getResend(): Resend {
  if (typeof window !== "undefined") {
    throw new Error("lib/email/resend.ts is server-only and must never run in the browser.");
  }
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY env var.");
  client = new Resend(apiKey);
  return client;
}

/** Default sender. Resend requires a verified domain; `onboarding@resend.dev`
 *  is Resend's shared test sender (test mode delivers only to the account email). */
const FROM = process.env.RESEND_FROM || "CareFlow <onboarding@resend.dev>";
const REPLY_TO = process.env.RESEND_REPLY_TO || undefined;

const SUBJECT = "Your CareFlow sign-in code";

// CareFlow design theme, translated to email-safe inline styles (no CSS vars, no
// SVG — Gmail strips both). Calm slate base (#f1f5f9 / #f8fafc), white card,
// dark-slate primary header (#0f172a) mirroring the app's primary, Geist-Mono-
// style monospace for the code. Table-based for Outlook/Gmail robustness.
function otpHtml(code: string): string {
  const mono = "'Geist Mono','SF Mono',ui-monospace,Menlo,Consolas,monospace";
  const sans = "'Geist','Segoe UI',Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;font-family:${sans};">
            <!-- Primary header band (mirrors the app's dark-slate primary) -->
            <tr>
              <td style="background:#0f172a;padding:20px 28px;" bgcolor="#0f172a">
                <span style="color:#f8fafc;font-size:17px;font-weight:700;letter-spacing:-0.01em;">CareFlow</span>
                <span style="color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;float:right;padding-top:5px;">Hospital&nbsp;Operations</span>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px 28px 8px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#64748b;">Secure sign-in</div>
                <h1 style="margin:8px 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Your sign-in code</h1>
                <p style="margin:0 0 22px;font-size:14px;line-height:1.5;color:#64748b;">Enter this code in CareFlow to finish signing in. It works once.</p>
                <!-- Code -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
                      <span style="font-family:${mono};font-size:34px;font-weight:700;letter-spacing:10px;color:#0f172a;">${code}</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">This code expires in 5&nbsp;minutes. If you didn't request it, you can safely ignore this email.</p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #f1f5f9;">
                <span style="font-size:12px;color:#94a3b8;">CareFlow — clinical operations &amp; lightweight EMR.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function otpText(code: string): string {
  return `Your CareFlow sign-in code: ${code}\n\nThis code expires in 5 minutes. If you didn't request it, you can ignore this email.`;
}

/**
 * Send the OTP code to `to`. Throws on an invalid recipient, a header-injection
 * attempt, a non-6-digit code, or a Resend API error.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const recipient = to.trim();
  if (!isValidEmail(recipient)) throw new Error("Invalid recipient email.");
  assertNoHeaderInjection(recipient, "recipient");
  // Length is whatever the Supabase project mints (6–8 digits); sanity-check
  // it's digits only rather than pinning an exact length.
  if (!/^\d{4,12}$/.test(code)) throw new Error("Invalid OTP code.");

  const { error } = await getResend().emails.send({
    from: FROM,
    to: recipient,
    replyTo: REPLY_TO,
    subject: SUBJECT,
    html: otpHtml(code),
    text: otpText(code),
  });
  if (error) throw new Error(error.message || "Failed to send the email.");
}
