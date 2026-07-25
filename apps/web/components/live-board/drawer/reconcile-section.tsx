"use client";

import { useState } from "react";
import type * as React from "react";
import { Merge, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ReconcileDialog,
  type ReconcileTarget,
} from "@/components/reconciliation/reconcile-dialog";
import { useT } from "@/components/locale-provider";
import type { Patient } from "@careflow/shared";

/**
 * Phase 16.8 reconcile flow — give the anonymous record a real identity, or
 * merge it into an existing verified patient. Rendered only for
 * emergency-anonymous patients; owns the dialog open state.
 */
export function ReconcileSection({
  patient,
  displayName,
  verified,
  onDone,
  className,
  style,
}: {
  patient: Patient;
  displayName: string;
  /** Verified (non-anonymous) patients this record could merge into. */
  verified: Patient[];
  /** Both dialog outcomes keep the visit alive — reload the drawer data. */
  onDone: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const [reconcileOpen, setReconcileOpen] = useState(false);

  return (
    <>
      <section className={className} style={style}>
        <div className="flex items-center gap-2">
          <Merge className="size-4" style={{ color: "var(--status-treatment)" }} />
          <h3 className="text-sm font-medium">{t("drawer.reconcileTitle")}</h3>
        </div>
        <p className="text-xs text-muted-foreground">{t("drawer.reconcileHint")}</p>
        <Button onClick={() => setReconcileOpen(true)} className="self-start">
          <UserCheck className="size-4" />
          {t("reconciliation.reconcile")}
        </Button>
      </section>

      <ReconcileDialog
        target={
          reconcileOpen && patient.is_emergency_anonymous
            ? ({
                patientId: patient.id,
                identifier: displayName,
              } satisfies ReconcileTarget)
            : null
        }
        verified={verified}
        onClose={() => setReconcileOpen(false)}
        onDone={() => {
          // Both dialog outcomes (new identity or merge) keep the visit alive,
          // so the drawer stays open and simply reloads the now-verified patient.
          setReconcileOpen(false);
          onDone();
        }}
      />
    </>
  );
}
