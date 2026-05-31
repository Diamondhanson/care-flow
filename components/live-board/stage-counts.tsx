"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { getActiveVisits } from "@/services/mockStorage";
import { BOARD_COLUMNS, columnForStage } from "@/components/live-board/stages";

export function StageCounts() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const tally: Record<string, number> = Object.fromEntries(
      BOARD_COLUMNS.map((c) => [c.key, 0]),
    );
    for (const visit of getActiveVisits()) {
      const column = columnForStage(visit.stage);
      if (column) tally[column.key] += 1;
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
        {BOARD_COLUMNS.map((column) => (
          <Card key={column.key} className="relative overflow-hidden py-0">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: `var(--status-${column.token})` }}
            />
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `var(--status-${column.token})` }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {column.label}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="font-mono text-3xl font-semibold tabular-nums leading-none">
                  {counts ? counts[column.key] : "—"}
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
