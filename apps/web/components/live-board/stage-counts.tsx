"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_DEPARTMENTS,
  getActiveVisitsForDepartment,
} from "@/services/mockStorage";
import { BOARD_COLUMNS, columnForStage } from "@/components/live-board/stages";
import { useT } from "@/components/locale-provider";
import type { Department } from "@/types/healthcare";

interface StageCountsProps {
  departmentId: string;
  departments: Department[];
  onDepartmentChange: (value: string) => void;
}

export function StageCounts({
  departmentId,
  departments,
  onDepartmentChange,
}: StageCountsProps) {
  const { t } = useT();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const tally: Record<string, number> = Object.fromEntries(
      BOARD_COLUMNS.map((c) => [c.key, 0]),
    );
    for (const visit of getActiveVisitsForDepartment(departmentId)) {
      const column = columnForStage(visit.stage);
      if (column) tally[column.key] += 1;
    }
    setCounts(tally);
  }, [departmentId]);

  const total = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : null;

  const activeDepartments = departments.filter((d) => d.is_active);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("liveBoard.title")}
            </h1>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {total ?? "—"} {t("liveBoard.active")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("liveBoard.subtitle")}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Button
          nativeButton={false}
          render={<Link href="/intake" />}
          className="order-first sm:order-last"
        >
          <ClipboardPlus className="size-4" />
          {t("liveBoard.register")}
        </Button>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
            {t("liveBoard.viewing")}
          </span>
          <Select
            items={{
              [ALL_DEPARTMENTS]: t("liveBoard.allDepartments"),
              ...Object.fromEntries(
                activeDepartments.map((d) => [d.id, d.name]),
              ),
            }}
            value={departmentId}
            onValueChange={(v) => onDepartmentChange((v as string) ?? ALL_DEPARTMENTS)}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPARTMENTS}>{t("liveBoard.allDepartments")}</SelectItem>
              {activeDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        </div>
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
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t(column.label)}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="font-mono text-3xl font-semibold tabular-nums leading-none">
                  {counts ? counts[column.key] : "—"}
                </span>
                <span className="text-xs text-muted-foreground">{t("liveBoard.patients")}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
