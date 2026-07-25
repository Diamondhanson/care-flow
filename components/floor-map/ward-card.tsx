"use client";

import { Pencil } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { tallyBeds } from "@/components/floor-map/floor-map";
import { BedTile, tokenColor } from "@/components/floor-map/bed-tile";
import { useT } from "@/components/locale-provider";
import type { Bed, Ward } from "@/types/healthcare";

export interface BedView {
  bed: Bed;
  occupantName: string | null;
}

export interface WardView {
  ward: Ward;
  departmentName: string | null;
  beds: BedView[];
}

export function WardCard({
  view,
  onEdit,
}: {
  view: WardView;
  onEdit: () => void;
}) {
  const { t } = useT();
  const { ward, departmentName, beds } = view;
  const tally = tallyBeds(beds.map((b) => b.bed));

  return (
    <Card className={ward.is_active ? "" : "opacity-70"}>
      <CardContent className="@container flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          {/* Full-width until the *card itself* is wide enough to share the row,
              so the tally chips + edit button wrap below the title instead of
              squeezing the ward name to a single letter. A container query (not
              a viewport breakpoint) is used because the card's width depends on
              the grid/stack it sits in, not on the screen width. */}
          <div className="flex min-w-0 basis-full flex-col gap-0.5 @[30rem]:flex-1 @[30rem]:basis-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{ward.name}</span>
              {!ward.is_active ? (
                <Badge variant="outline">{t("departments.archived")}</Badge>
              ) : null}
            </div>
            {departmentName ? (
              <span className="text-xs text-muted-foreground">
                {departmentName}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <TallyChip token="treatment" label={t("floorMap.occupied")} value={tally.occupied} />
            <TallyChip token="clearance" label={t("floorMap.free")} value={tally.available} />
            <TallyChip token="muted" label={t("floorMap.other")} value={tally.unavailable} />
          </div>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" /> {t("floorMap.edit")}
          </Button>
        </div>

        <Separator />

        {beds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("floorMap.noBeds")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {beds.map(({ bed, occupantName }) => (
              <BedTile key={bed.id} bed={bed} occupantName={occupantName} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TallyChip({
  token,
  label,
  value,
}: {
  token: "treatment" | "clearance" | "muted";
  label: string;
  value: number;
}) {
  const color = tokenColor(token);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        color,
      }}
    >
      <span className="font-mono tabular-nums">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}
