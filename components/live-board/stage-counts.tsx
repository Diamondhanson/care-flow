"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { getActiveAdmissions } from "@/services/mockStorage";
import type { AdmissionStage } from "@/types/healthcare";

const STAGES = [
  { label: "Boarding", token: "boarding", stage: "boarding" },
  { label: "Treatment", token: "treatment", stage: "treatment" },
  { label: "Discharge Planning", token: "discharge", stage: "discharge_planning" },
  { label: "Followed Up", token: "clearance", stage: "followed_up" },
] as const satisfies ReadonlyArray<{
  label: string;
  token: string;
  stage: AdmissionStage;
}>;

export function StageCounts() {
  const [counts, setCounts] = useState<Record<AdmissionStage, number> | null>(
    null,
  );

  useEffect(() => {
    const active = getActiveAdmissions();
    const tally: Record<AdmissionStage, number> = {
      boarding: 0,
      treatment: 0,
      discharge_planning: 0,
      followed_up: 0,
    };
    for (const admission of active) {
      tally[admission.stage] += 1;
    }
    setCounts(tally);
  }, []);

  const total = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Live Board</h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {total ?? "—"} active
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Track every patient from admission through recovery follow-up.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage) => (
          <Card key={stage.token} className="relative overflow-hidden py-0">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: `var(--status-${stage.token})` }}
            />
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `var(--status-${stage.token})` }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {stage.label}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="font-mono text-3xl font-semibold tabular-nums leading-none">
                  {counts ? counts[stage.stage] : "—"}
                </span>
                <span className="text-xs text-muted-foreground">patients</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
