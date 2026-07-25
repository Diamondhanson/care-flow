"use client";

import type * as React from "react";
import { HeartHandshake } from "lucide-react";

import {
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type { CarePlanEntry, CarePlanItem } from "@/types/healthcare";

/** Read-only nursing care-plan summary (inpatient admissions only). */
export function CarePlanSummary({
  carePlanItems,
  carePlanEntries,
  className,
  style,
}: {
  carePlanItems: CarePlanItem[];
  carePlanEntries: CarePlanEntry[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const active = carePlanItems.filter((i) => i.status === "active");
  const handover = carePlanEntries.find((e) => e.is_handover) ?? null;

  return (
    <section className={className} style={style}>
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("carePlan.needsBlock")}
        </h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {active.length}
        </span>
      </div>
      {active.length === 0 && !handover ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {t("carePlan.noNeeds")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {handover ? (
            <div
              className="flex flex-col gap-1 rounded-md border p-3 text-xs"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--status-boarding) 40%, transparent)",
              }}
            >
              <span
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--status-boarding)" }}
              >
                <HeartHandshake className="size-3" />
                {t("carePlan.latestHandover")}
              </span>
              <span>{handover.note}</span>
              <span className="font-mono text-muted-foreground">
                {formatDateTime(handover.recorded_at, activeLocale)}
              </span>
            </div>
          ) : null}
          {active.map((item) => {
            const Icon = CARE_NEED_CATEGORY_ICON[item.category];
            return (
              <div
                key={item.id}
                className="flex items-start gap-2.5 rounded-md border border-border p-3 text-xs"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {t(CARE_NEED_CATEGORY_LABEL[item.category])}
                  </span>
                  <span>{item.description}</span>
                  {item.frequency ? (
                    <span className="text-muted-foreground">{item.frequency}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
