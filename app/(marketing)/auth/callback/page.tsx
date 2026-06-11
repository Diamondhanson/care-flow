"use client";

/**
 * OAuth return handler (`/auth/callback`) — where Google sends the user back
 * (Phase 18.5). The Supabase browser client (PKCE, `detectSessionInUrl`)
 * exchanges the `?code=…` for a session automatically on load; the AuthProvider
 * then resolves it. We just wait for that to settle and route:
 *   - resolved staff (has hospital) → `/dashboard`;
 *   - verified, no hospital yet      → `/onboarding`;
 *   - no session (error / denied)    → show an error with a way back.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

export default function AuthCallbackPage() {
  const { t } = useT();
  const router = useRouter();
  const { mounted, isAuthenticated, needsOnboarding } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    if (isAuthenticated) {
      router.replace("/dashboard");
    } else if (needsOnboarding) {
      router.replace("/onboarding");
    } else {
      // Mounted with no session — the exchange failed or was denied. Give the
      // client a brief grace window (the session event can land just after
      // mount) before declaring failure.
      const timer = setTimeout(() => setFailed(true), 4000);
      return () => clearTimeout(timer);
    }
  }, [mounted, isAuthenticated, needsOnboarding, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-24 text-center">
      {failed ? (
        <>
          <p role="alert" className="mb-4 text-sm text-destructive">
            {t("auth.callback.error")}
          </p>
          <Button variant="outline" onClick={() => router.replace("/login")}>
            {t("auth.callback.backToLogin")}
          </Button>
        </>
      ) : (
        <>
          <span className="mb-5 flex size-11 animate-pulse items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Activity className="size-6" strokeWidth={2.25} />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">
            {t("auth.callback.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.callback.subtitle")}
          </p>
        </>
      )}
    </div>
  );
}
