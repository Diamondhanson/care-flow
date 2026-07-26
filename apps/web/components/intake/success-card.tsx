"use client";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { PatientName } from "@/lib/patient-name";

export interface SubmitResult {
  displayName: string;
  isAnonymous: boolean;
  mrn: string;
}

/** Confirmation shown once a visit has been opened. */
export function IntakeSuccessCard({
  result,
  onRegisterAnother,
}: {
  result: SubmitResult;
  onRegisterAnother: () => void;
}) {
  const { t } = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircle2 className="size-10 text-[var(--status-clearance)]" />
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">{t("intake.visitOpened")}</p>
            <p className="text-sm text-muted-foreground">
              {t("intake.visitOpenedHint")}
            </p>
          </div>
          <div className="flex w-full flex-col gap-1 rounded-md border border-border bg-muted/40 p-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {result.isAnonymous ? t("intake.emergencyTag") : t("intake.patient")}
            </span>
            <PatientName
              name={result.displayName}
              format={!result.isAnonymous}
              className={result.isAnonymous ? "font-mono text-sm" : "text-sm"}
            />
            {result.mrn ? (
              <span className="font-mono text-xs text-muted-foreground">
                {t("intake.patientIdTag")} {result.mrn}
              </span>
            ) : null}
          </div>
          <div className="flex gap-3">
            <Button nativeButton={false} render={<Link href="/dashboard" />}>
              {t("intake.viewOnBoard")} <ArrowRight className="size-4" />
            </Button>
            <Button variant="outline" onClick={onRegisterAnother}>
              {t("intake.registerAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
