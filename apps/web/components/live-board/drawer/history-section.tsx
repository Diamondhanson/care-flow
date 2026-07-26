"use client";

import { useEffect, useRef } from "react";
import type * as React from "react";
import { ClipboardList, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchPatientHistory } from "@/services/supabaseData";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { stageLabel, tokenForStage } from "@/components/live-board/stages";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDate, formatDateTime } from "@/i18n/format";
import { VitalsLine } from "@/components/live-board/drawer/record-views";
import { cn } from "@/lib/utils";
import type { TreatmentRecord, Visit } from "@careflow/shared";

/** In-visit treatment log — every vitals/notes entry, most recent first. */
export function TreatmentHistorySection({
  records,
  className,
  style,
}: {
  records: TreatmentRecord[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  return (
    <section className={className} style={style}>
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("drawer.treatmentHistory")}
        </h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {records.length}
        </span>
      </div>
      {records.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("drawer.noEntries")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-muted-foreground">
                  {formatDateTime(r.recorded_at, activeLocale)}
                </span>
                {r.gcs_score !== null ? (
                  <span className="font-mono">GCS {r.gcs_score}</span>
                ) : null}
              </div>
              <VitalsLine record={r} />
              {r.notes ? <span>{r.notes}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Cross-visit timeline — every visit on this patient's record, most recent
 * first. The device only caches ~12 months of records (Stage 4 windowed
 * hydration), so when this section mounts and we're online it backfills the
 * patient's full visit history from the server — at most once per patient per
 * drawer-open (the guard set clears when the drawer closes and the section
 * unmounts). The merge bumps `cacheVersion`, which re-runs the shared load
 * effect, so the list refreshes on its own. Offline/failed fetches are
 * swallowed: the cached window is simply what's shown.
 */
export function PastVisitsSection({
  patientId,
  currentVisitId,
  patientVisits,
  className,
  style,
}: {
  patientId: string;
  currentVisitId: string;
  patientVisits: Visit[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const historyFetchedFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (historyFetchedFor.current.has(patientId)) return;
    if (!isSupabaseConfigured() || !navigator.onLine) return;
    historyFetchedFor.current.add(patientId);
    fetchPatientHistory(patientId).catch(() => {
      // Offline or server error — show whatever is cached.
    });
  }, [patientId]);

  return (
    <section className={className} style={style}>
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("drawer.historyTitle")}
        </h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {patientVisits.length}
        </span>
      </div>
      {patientVisits.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("drawer.historyEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {patientVisits.map((pv) => (
            <li
              key={pv.id}
              className={cn(
                "flex flex-col gap-1 rounded-md border border-border p-3 text-xs",
                pv.id === currentVisitId && "bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-muted-foreground">
                  {formatDate(pv.arrived_at, activeLocale)}
                </span>
                {pv.id === currentVisitId ? (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {t("drawer.historyCurrent")}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(VISIT_TYPE_LABEL[pv.visit_type])}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        pv.stage === "deceased"
                          ? "var(--status-deceased)"
                          : `var(--status-${tokenForStage(pv.stage)})`,
                    }}
                  />
                  {t(stageLabel(pv.stage))}
                </span>
              </div>
              <span className="text-muted-foreground">
                {pv.chief_complaint ?? t("drawer.noChiefComplaint")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
