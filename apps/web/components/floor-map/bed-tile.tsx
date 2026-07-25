"use client";

import { BedDouble, User } from "lucide-react";

import {
  BED_STATUS_LABEL,
  BED_STATUS_TOKEN,
} from "@/components/floor-map/floor-map";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { PatientName } from "@/lib/patient-name";
import type { Bed } from "@careflow/shared";

/**
 * Resolve a bed-status token to a CSS color. `maintenance` maps to the `muted`
 * token, which has no clinical `--status-*` variable, so fall back to the
 * semantic muted foreground.
 */
export function tokenColor(token: string): string {
  return token === "muted" ? "var(--muted-foreground)" : `var(--status-${token})`;
}

export function BedTile({
  bed,
  occupantName,
  occupantAnonymous,
}: {
  bed: Bed;
  occupantName: string | null;
  occupantAnonymous: boolean;
}) {
  const { t } = useT();
  const token = BED_STATUS_TOKEN[bed.status];
  const color = tokenColor(token);
  const isOccupied = bed.status === "occupied";
  return (
    <div
      className="flex flex-col gap-1 rounded-md border p-2.5"
      style={{
        borderColor: `color-mix(in oklab, ${color} 35%, var(--border))`,
        backgroundColor: `color-mix(in oklab, ${color} 6%, transparent)`,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          <BedDouble className="size-3.5 shrink-0 text-muted-foreground" />
          {bed.label}
        </span>
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      {isOccupied ? (
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <User className="size-3 shrink-0" />
          {occupantName ? (
            <PatientName
              name={occupantName}
              format={!occupantAnonymous}
              className={cn("truncate", occupantAnonymous && "font-mono")}
            />
          ) : (
            t("floorMap.occupied")
          )}
        </span>
      ) : (
        <span className="text-xs font-medium" style={{ color }}>
          {t(BED_STATUS_LABEL[bed.status])}
        </span>
      )}
    </div>
  );
}
