import { ShieldAlert, Stethoscope, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BoardColumn } from "@/components/live-board/stages";

export interface PatientCardData {
  visitId: string;
  mrn: string;
  displayName: string;
  isAnonymous: boolean;
  /** Bed/ward label for inpatients, else the department name. */
  location: string | null;
  reason: string | null;
  attendingDoctorName: string | null;
  gcs: number | null;
}

export function PatientCard({
  data,
  column,
  onSelect,
}: {
  data: PatientCardData;
  column: BoardColumn;
  onSelect?: (visitId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(data.visitId)}
      aria-label={`Open ${data.displayName}`}
      className={cn(
        "relative flex min-h-[44px] w-full flex-col gap-2 overflow-hidden rounded-md border border-border bg-card p-3 text-left",
        "transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: `var(--status-${column.token})` }}
      />

      <div className="flex items-start justify-between gap-2 pl-1.5">
        <span
          className={cn(
            "text-sm leading-tight font-medium",
            data.isAnonymous && "font-mono text-[13px]",
          )}
        >
          {data.displayName}
        </span>
        {data.isAnonymous ? (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-transparent text-[10px] uppercase tracking-wide"
            style={{
              backgroundColor: `var(--status-${column.token})`,
              color: `var(--status-${column.token}-foreground)`,
            }}
          >
            <ShieldAlert className="size-3" />
            Emergency
          </Badge>
        ) : null}
      </div>

      <span className="pl-1.5 font-mono text-[10px] tracking-wide text-muted-foreground">
        {data.mrn}
      </span>

      {data.reason ? (
        <p className="line-clamp-2 pl-1.5 text-xs text-muted-foreground">
          {data.reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1.5 text-[11px] text-muted-foreground">
        {data.location ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <MapPin className="size-3" />
            {data.location}
          </span>
        ) : null}
        {data.attendingDoctorName ? (
          <span className="inline-flex items-center gap-1">
            <Stethoscope className="size-3" />
            {data.attendingDoctorName}
          </span>
        ) : null}
        {data.gcs !== null ? (
          <span className="inline-flex items-center gap-1 font-mono">
            GCS {data.gcs}
          </span>
        ) : null}
      </div>
    </button>
  );
}
