"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { type TFunction } from "@/components/locale-provider";
import { formatXaf } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { Patient, Visit, VisitId } from "@/types/healthcare";

/** A visit joined with its patient, for the picker + bill header. */
export interface VisitRow {
  visit: Visit;
  patient: Patient | undefined;
}

export function patientDisplayName(patient: Patient | undefined, t: TFunction): string {
  if (!patient) return t("meds.unknownPatient");
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

// ---------------------------------------------------------------------------
// Left rail — visit picker
// ---------------------------------------------------------------------------

function VisitPickerRow({
  row,
  active,
  total,
  locale,
  onSelect,
  t,
}: {
  row: VisitRow;
  active: boolean;
  total: number;
  locale: "en" | "fr";
  onSelect: () => void;
  t: TFunction;
}) {
  const isAnon = row.patient?.is_emergency_anonymous ?? false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
        active ? "border-primary/40 bg-accent" : "border-border bg-card hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("truncate text-sm", isAnon ? "font-mono" : "font-medium")}>
          {patientDisplayName(row.patient, t)}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatXaf(total, locale)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{row.patient?.mrn || "—"}</span>
      </div>
    </button>
  );
}

/** Master rail: search box + open/closed visit groups. */
export function VisitPicker({
  rows,
  selectedId,
  totals,
  locale,
  onSelect,
  t,
}: {
  rows: VisitRow[];
  selectedId: string | null;
  /** Per-visit grand totals keyed by visit id. */
  totals: Map<string, number>;
  locale: "en" | "fr";
  onSelect: (visitId: VisitId) => void;
  t: TFunction;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = patientDisplayName(r.patient, t).toLowerCase();
      const mrn = (r.patient?.mrn ?? "").toLowerCase();
      return name.includes(q) || mrn.includes(q);
    });
  }, [rows, search, t]);

  const openRows = filtered.filter((r) => r.visit.status === "open");
  const closedRows = filtered.filter((r) => r.visit.status !== "open");

  return (
    <aside className="flex flex-col gap-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("billing.searchPlaceholder")}
      />
      {filtered.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t("billing.noVisitsHint")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {openRows.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("billing.openVisits")}
              </p>
              {openRows.map((r) => (
                <VisitPickerRow
                  key={r.visit.id}
                  row={r}
                  active={r.visit.id === selectedId}
                  total={totals.get(r.visit.id) ?? 0}
                  locale={locale}
                  onSelect={() => onSelect(r.visit.id)}
                  t={t}
                />
              ))}
            </div>
          ) : null}
          {closedRows.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {t("billing.closedVisits")}
              </p>
              {closedRows.map((r) => (
                <VisitPickerRow
                  key={r.visit.id}
                  row={r}
                  active={r.visit.id === selectedId}
                  total={totals.get(r.visit.id) ?? 0}
                  locale={locale}
                  onSelect={() => onSelect(r.visit.id)}
                  t={t}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
