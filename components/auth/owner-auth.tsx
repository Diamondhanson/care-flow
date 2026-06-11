"use client";

/**
 * OwnerAuth — verified-identity sign-in for hospital owners (Phase 18.5).
 *
 * Two passwordless paths, shared by `/signup` (new owner) and `/login`
 * (returning owner):
 *   - Google OAuth → redirects to `/auth/callback`, which routes the verified
 *     user to onboarding (no hospital yet) or the dashboard (already has one).
 *   - Email OTP → request a 6-digit code, enter it, get a session. On success we
 *     send the user to `redirectAfter` (default `/onboarding`, which itself
 *     forwards to the dashboard when the user already owns a hospital).
 *
 * Staff (doctors/nurses) do NOT use this — they sign in with a username +
 * password on the main login form.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

/** Google's multicolor "G" mark. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function OwnerAuth({
  redirectAfter = "/onboarding",
}: {
  redirectAfter?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const { signInWithGoogle, requestEmailOtp, confirmEmailOtp } = useAuth();

  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      await signInWithGoogle(redirectTo);
      // The browser navigates to Google; nothing else runs here on success.
    } catch {
      setError(t("auth.owner.googleError"));
      setGoogleBusy(false);
    }
  }

  async function sendCode() {
    if (busy || email.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await requestEmailOtp(email.trim());
      setStep("verify");
    } catch {
      setError(t("auth.owner.sendError"));
    } finally {
      setBusy(false);
    }
  }

  function handleSendCode(event: React.FormEvent) {
    event.preventDefault();
    void sendCode();
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await confirmEmailOtp(email.trim(), code.trim());
      router.push(redirectAfter);
    } catch {
      setError(t("auth.owner.verifyError"));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2.5"
        onClick={handleGoogle}
        disabled={googleBusy}
      >
        <GoogleIcon className="size-4" />
        {googleBusy
          ? t("auth.owner.googleSubmitting")
          : t("auth.owner.googleButton")}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
          {t("auth.owner.or")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {step === "request" ? (
        <form onSubmit={handleSendCode} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="owner-email">{t("auth.owner.emailLabel")}</Label>
            <Input
              id="owner-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.owner.emailPlaceholder")}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            disabled={busy || email.trim() === ""}
          >
            {busy ? t("auth.owner.sending") : t("auth.owner.sendCode")}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("auth.owner.codeSentTo", { email: email.trim() })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="owner-code">{t("auth.owner.codeLabel")}</Label>
            <Input
              id="owner-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder={t("auth.owner.codePlaceholder")}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || code.trim().length < 6}
          >
            {busy ? t("auth.owner.verifying") : t("auth.owner.verify")}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setStep("request");
                setCode("");
                setError(null);
              }}
            >
              {t("auth.owner.changeEmail")}
            </button>
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
              disabled={busy}
              onClick={() => void sendCode()}
            >
              {t("auth.owner.resend")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
