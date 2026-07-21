"use client";

import {
  ShieldAlert,
  Stethoscope,
  MapPin,
  ArrowRight,
  BellRing,
  ListChecks,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PatientName } from "@/lib/patient-name";
import { useT } from "@/components/locale-provider";
import { useRole } from "@/components/role-provider";
import type { BoardColumn } from "@/components/live-board/stages";
import type { TriageLevel } from "@careflow/shared";

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
  /** Emergency-severity acuity (1 = critical … 5 = non-urgent); null until triaged. */
  triage: TriageLevel | null;
  /** i18n key for the "next step" nudge, or null at the final stage. */
  nextStepKey: string | null;
  /** Phase 20 — items the nurse currently owes this patient (due meds/monitoring/instructions). */
  dueCount: number;
  /** Phase 20 — things needing the doctor (open nurse flags + concerning vitals). */
  needsYouCount: number;
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
  const { t } = useT();
  const { mounted, actingRole } = useRole();
  const isDoctorView = actingRole === "doctor";
  const collabCount = isDoctorView ? data.needsYouCount : data.dueCount;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(data.visitId)}
      aria-label={t("liveBoard.openPatient", { name: data.displayName })}
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
        <PatientName
          name={data.displayName}
          format={!data.isAnonymous}
          className={cn(
            "text-sm leading-tight",
            data.isAnonymous && "font-mono text-[13px]",
          )}
        />
        <div className="flex shrink-0 items-center gap-1">
          {mounted && collabCount > 0 ? (
            <Badge
              variant="outline"
              className="gap-1 border-transparent px-1.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--status-treatment) 18%, transparent)",
                color: "var(--status-treatment)",
              }}
            >
              {isDoctorView ? (
                <BellRing className="size-3" />
              ) : (
                <ListChecks className="size-3" />
              )}
              {t(isDoctorView ? "carePlan.needsYouBadge" : "carePlan.dueBadge", {
                n: String(collabCount),
              })}
            </Badge>
          ) : null}
          {data.triage !== null ? (
            <Badge
              variant="outline"
              title={t(`liveBoard.triage.${data.triage}`)}
              className="gap-1 border-transparent px-1.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums"
              style={{
                backgroundColor: `var(--triage-${data.triage})`,
                color: "var(--triage-foreground)",
              }}
            >
              {t("liveBoard.triage.label", { level: String(data.triage) })}
            </Badge>
          ) : null}
          {data.isAnonymous ? (
            <Badge
              variant="outline"
              className="gap-1 border-transparent text-[10px] uppercase tracking-wide"
              style={{
                backgroundColor: `var(--status-${column.token})`,
                color: `var(--status-${column.token}-foreground)`,
              }}
            >
              <ShieldAlert className="size-3" />
              {t("liveBoard.emergency")}
            </Badge>
          ) : null}
        </div>
      </div>

      <span className="pl-1.5 font-mono text-[11px] tracking-wide text-muted-foreground">
        {data.mrn}
      </span>

      {data.reason ? (
        <p className="line-clamp-2 pl-1.5 text-[13px] text-muted-foreground">
          {data.reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1.5 text-xs text-muted-foreground">
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

      {data.nextStepKey ? (
        <span
          className="ml-1.5 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: `var(--status-${column.token})`,
            color: `var(--status-${column.token}-foreground)`,
          }}
        >
          <ArrowRight className="size-3" />
          {t(data.nextStepKey)}
        </span>
      ) : null}
    </button>
  );
}
