"use client";

import { CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { type TFunction } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { CarePlanItem } from "@careflow/shared";

/** A single care-need card with its resolve action. */
export function NeedCard({
  item,
  onResolve,
  t,
}: {
  item: CarePlanItem;
  onResolve: () => void;
  t: TFunction;
}) {
  const Icon = CARE_NEED_CATEGORY_ICON[item.category ?? "other"];
  const resolved = item.status === "resolved";
  return (
    <Card className={cn(resolved && "opacity-60")}>
      <CardContent className="flex items-start gap-3 p-4">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--status-treatment) 14%, transparent)",
            color: "var(--status-treatment)",
          }}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t(CARE_NEED_CATEGORY_LABEL[item.category ?? "other"])}
            </span>
            {resolved ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <CheckCircle2 className="size-3" />
                {t("carePlan.statusResolved")}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm">{item.description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {item.frequency ? (
              <span>
                {t("carePlan.field.frequency")}: {item.frequency}
              </span>
            ) : null}
            {item.goal ? (
              <span>
                {t("carePlan.field.goal")}: {item.goal}
              </span>
            ) : null}
          </div>
        </div>
        {!resolved ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onResolve}
          >
            {t("carePlan.resolve")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
