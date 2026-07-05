"use client";

/**
 * RequireAuth — the client-side auth boundary for the `(app)` route group.
 *
 * Until the client hydrates we render a neutral splash (identical on server and
 * first client paint, so there is no hydration mismatch). Once mounted, an
 * unauthenticated visitor is redirected to `/login`; an authenticated one sees
 * the dashboard. On the Supabase cutover this gate is backed by a real session
 * (and ideally also enforced server-side), but the component contract is stable.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";

import { useAuth } from "@/components/auth-provider";

function Splash() {
  return (
    <div className="flex h-svh items-center justify-center bg-background text-foreground">
      <span className="flex size-11 animate-pulse items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <Activity className="size-6" strokeWidth={2.25} />
      </span>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { mounted, isAuthenticated, needsOnboarding } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!mounted || isAuthenticated) return;
    // A verified user without a hospital yet belongs in the onboarding step,
    // not back at the login screen (Phase 18.5).
    router.replace(needsOnboarding ? "/onboarding" : "/login");
  }, [mounted, isAuthenticated, needsOnboarding, router]);

  if (!mounted || !isAuthenticated) {
    return <Splash />;
  }

  return <>{children}</>;
}
