"use client";

import { ShieldAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/components/locale-provider";

/** Emergency toggle */
export function EmergencyToggleCard({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const { t } = useT();
  return (
    <Card
      className={
        checked ? "border-[var(--status-treatment)] bg-muted/30" : ""
      }
    >
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 size-5 shrink-0"
            style={{ color: "var(--status-treatment)" }}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="emergency" className="text-sm font-medium">
              {t("intake.emergencyToggle")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("intake.emergencyToggleHint")}
            </p>
          </div>
        </div>
        <Switch
          id="emergency"
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
      </CardContent>
    </Card>
  );
}
