"use client";

import { HeartHandshake } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CARE_NEED_CATEGORY_LABEL } from "@/components/care-plans/care-plans";
import { getStaffById } from "@/services/mockStorage";
import { type TFunction } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type { CarePlanEntry, CarePlanItem, StaffId } from "@careflow/shared";

export function staffName(id: StaffId | null): string | null {
  if (!id) return null;
  return getStaffById(id)?.full_name ?? null;
}

/** Append-only care log entry. */
export function LogEntry({
  entry,
  items,
  activeLocale,
  t,
}: {
  entry: CarePlanEntry;
  items: CarePlanItem[];
  activeLocale: "en" | "fr";
  t: TFunction;
}) {
  const need = entry.care_plan_item_id
    ? items.find((i) => i.id === entry.care_plan_item_id)
    : undefined;
  const by = staffName(entry.recorded_by_id);
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {entry.is_handover ? (
          <Badge
            className="gap-1 text-[10px] uppercase"
            style={{
              backgroundColor: "var(--status-boarding)",
              color: "var(--status-boarding-foreground)",
            }}
          >
            <HeartHandshake className="size-3" />
            {t("carePlan.handoverTag")}
          </Badge>
        ) : null}
        {need ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("carePlan.forNeed", {
              need: t(CARE_NEED_CATEGORY_LABEL[need.category ?? "other"]),
            })}
          </span>
        ) : null}
      </div>
      <p className="text-sm">{entry.note}</p>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {by ? `${by} · ` : ""}
        {formatDateTime(entry.recorded_at, activeLocale)}
      </span>
    </div>
  );
}
