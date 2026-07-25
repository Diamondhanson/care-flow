"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ALLERGY_CATEGORY_LABEL,
  ALLERGY_SEVERITY_LABEL,
  ALLERGY_SEVERITY_TOKEN,
  allergyDisplayState,
  highestSeverity,
  sortAllergiesBySeverity,
} from "@/components/allergies/allergies";
import { useT } from "@/components/locale-provider";
import type { Allergy } from "@careflow/shared";

/** Allergy safety banner — always visible, pinned to the top of the drawer. */
export function AllergiesPanel({
  allergies,
  noKnownAllergies,
}: {
  allergies: Allergy[];
  noKnownAllergies: boolean;
}) {
  const { t } = useT();

  const sortedAllergies = sortAllergiesBySeverity(allergies);
  const allergyState = allergyDisplayState(noKnownAllergies, allergies.length);
  const worstAllergy = highestSeverity(allergies);

  return (
    <div style={{ order: -10 }}>
      {allergyState === "has-allergies" ? (
        <section
          className="flex flex-col gap-2 rounded-md border p-3"
          style={{
            borderColor: `var(--status-${worstAllergy ? ALLERGY_SEVERITY_TOKEN[worstAllergy] : "treatment"})`,
            backgroundColor:
              "color-mix(in oklab, var(--status-treatment) 8%, transparent)",
          }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-4"
              style={{ color: "var(--status-treatment)" }}
            />
            <h3 className="text-sm font-semibold">
              {t("drawer.allergiesCount", { count: allergies.length })}
            </h3>
          </div>
          <ul className="flex flex-col gap-1.5">
            {sortedAllergies.map((a) => {
              const severityToken = ALLERGY_SEVERITY_TOKEN[a.severity];
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                >
                  {severityToken === "muted" ? (
                    <Badge
                      variant="outline"
                      className="border-transparent text-[10px] uppercase"
                    >
                      {t(ALLERGY_SEVERITY_LABEL[a.severity])}
                    </Badge>
                  ) : (
                    <StatusBadge tone={severityToken} variant="solid">
                      {t(ALLERGY_SEVERITY_LABEL[a.severity])}
                    </StatusBadge>
                  )}
                  <span className="font-medium">{a.substance}</span>
                  <span className="text-muted-foreground">
                    {t(ALLERGY_CATEGORY_LABEL[a.category])}
                    {a.reaction ? ` · ${a.reaction}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : allergyState === "none" ? (
        <section className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <CheckCircle2
            className="size-4"
            style={{ color: "var(--status-clearance)" }}
          />
          {t("drawer.noKnownAllergies")}
        </section>
      ) : (
        <section className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          <AlertTriangle className="size-4" />
          {t("drawer.allergiesNotAssessed")}
        </section>
      )}
    </div>
  );
}
