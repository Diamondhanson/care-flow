"use client";

import type { LucideIcon } from "lucide-react";
import { ShieldAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useRole } from "@/components/role-provider";
import { useT } from "@/components/locale-provider";
import type { StaffRole } from "@careflow/shared";
import type { MessageKey } from "@/i18n";

/**
 * RoleGate (Stage 6) — the single, reusable page-level role gate.
 *
 * Renders its children only when the acting role is in `allow`; otherwise a
 * clear access-denied card. Centralizes what was previously a hand-rolled
 * per-page pattern so every gated page looks and behaves the same.
 *
 * Scope note: this is a UX gate, not the security boundary. Data access is
 * enforced server-side by Postgres row-level security regardless of what the
 * client renders — and nav hiding (Phase 14) intentionally does NOT block
 * routes. Gate only pages with a real policy (e.g. billing).
 */
export function RoleGate({
  allow,
  icon: Icon = ShieldAlert,
  titleKey,
  bodyKey,
  children,
}: {
  allow: readonly StaffRole[];
  icon?: LucideIcon;
  /** i18n key for the page name shown on the denied card. */
  titleKey: MessageKey;
  /** i18n key for the denial explanation. */
  bodyKey: MessageKey;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const { actingRole, mounted } = useRole();

  // Until the client hydrates, render children so SSR/first paint stay stable;
  // the gate re-evaluates immediately after mount.
  if (mounted && actingRole && !allow.includes(actingRole)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Icon className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="text-sm font-medium">{t(titleKey)}</p>
            <p className="text-xs text-muted-foreground">{t(bodyKey)}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
