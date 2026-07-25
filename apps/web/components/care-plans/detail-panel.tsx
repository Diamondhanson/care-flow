"use client";

import { BedDouble, HeartHandshake } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { patientName, unitLabel } from "@/components/care-plans/patient-row";
import { NeedCard } from "@/components/care-plans/need-card";
import { AddNeedForm } from "@/components/care-plans/add-need-form";
import { LogEntry, staffName } from "@/components/care-plans/entry-log";
import { RecordCareForm } from "@/components/care-plans/record-care-form";
import { type TFunction } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { PatientName } from "@/lib/patient-name";
import type { CarePlanPatient } from "@/services/mockStorage";
import type {
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
  CarePlanItemId,
} from "@careflow/shared";

/** Detail column — the selected patient's needs, care log, and handover. */
export function DetailPanel({
  selected,
  items,
  entries,
  activeLocale,
  onAddNeed,
  onResolve,
  onAddEntry,
  t,
}: {
  selected: CarePlanPatient;
  items: CarePlanItem[];
  entries: CarePlanEntry[];
  activeLocale: "en" | "fr";
  onAddNeed: (input: {
    category: CareNeedCategory;
    description: string;
    frequency: string;
    goal: string;
  }) => void;
  onResolve: (itemId: CarePlanItemId) => void;
  onAddEntry: (input: {
    note: string;
    careItemId: CarePlanItemId | null;
    isHandover: boolean;
  }) => void;
  t: TFunction;
}) {
  const activeItems = items.filter((i) => i.status === "active");
  const latestHandover = entries.find((e) => e.is_handover) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <PatientName
          name={patientName(selected, t)}
          format={!selected.patient?.is_emergency_anonymous}
          className={cn(
            "text-lg",
            selected.patient?.is_emergency_anonymous
              ? "font-mono"
              : "font-semibold",
          )}
        />
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BedDouble className="size-4" />
          {unitLabel(selected)}
        </span>
      </div>

      {/* Latest handover banner */}
      {latestHandover ? (
        <Card
          style={{
            borderColor:
              "color-mix(in oklab, var(--status-boarding) 40%, transparent)",
          }}
        >
          <CardContent className="flex flex-col gap-1 p-4">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: "var(--status-boarding)" }}
            >
              <HeartHandshake className="size-3.5" />
              {t("carePlan.latestHandover")}
            </span>
            <p className="text-sm">{latestHandover.note}</p>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {staffName(latestHandover.recorded_by_id)
                ? `${staffName(latestHandover.recorded_by_id)} · `
                : ""}
              {formatDateTime(latestHandover.recorded_at, activeLocale)}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* Care needs */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">
            {t("carePlan.needsBlock")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("carePlan.needsBlockHint")}
          </p>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("carePlan.noNeeds")}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {items.map((item) => (
              <NeedCard
                key={item.id}
                item={item}
                onResolve={() => onResolve(item.id)}
                t={t}
              />
            ))}
          </div>
        )}
        <AddNeedForm onAdd={onAddNeed} t={t} />
      </section>

      {/* Care log + handover */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">
            {t("carePlan.logBlock")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("carePlan.logBlockHint")}
          </p>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("carePlan.noLog")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry) => (
              <LogEntry
                key={entry.id}
                entry={entry}
                items={items}
                activeLocale={activeLocale}
                t={t}
              />
            ))}
          </div>
        )}
        <RecordCareForm
          activeItems={activeItems}
          onAdd={onAddEntry}
          t={t}
        />
      </section>
    </div>
  );
}
