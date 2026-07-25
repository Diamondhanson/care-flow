"use client";

import { AlertTriangle } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

/**
 * Shown on the auth screens when the Supabase env vars are missing (fresh or
 * misconfigured checkout). Replaces the old behavior — a cryptic throw on boot
 * and a generic "sign-in failed" — with a clear, actionable explanation.
 */
export function BackendNotice() {
  const { backendConfigured } = useAuth();
  if (backendConfigured) return null;

  return <BackendNoticeCard />;
}

function BackendNoticeCard() {
  const { t } = useT();
  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 p-4"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-status-warning"
        aria-hidden
      />
      <div>
        <p className="text-sm font-medium text-foreground">
          {t("auth.backendMissing.title")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("auth.backendMissing.body")}
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
          NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY
        </p>
      </div>
    </div>
  );
}
