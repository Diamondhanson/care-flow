"use client";

import { BedDouble, HeartHandshake } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { type TFunction } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import type { CarePlanPatient } from "@/services/mockStorage";

/** The patient's display name, honoring the anonymous-emergency tag. */
export function patientName(p: CarePlanPatient, t: TFunction): string {
  const patient = p.patient;
  if (!patient) return t("meds.unknownPatient");
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

/** Ward · bed unit label for an admitted patient. */
export function unitLabel(p: CarePlanPatient): string {
  const ward = p.ward?.name ?? "—";
  return p.bed ? `${ward} · ${p.bed.label}` : ward;
}

/** Left-rail patient row. */
export function PatientRow({
  patient,
  active,
  onSelect,
  t,
}: {
  patient: CarePlanPatient;
  active: boolean;
  onSelect: () => void;
  t: TFunction;
}) {
  const isAnonymous = patient.patient?.is_emergency_anonymous ?? false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative flex w-full flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
        active
          ? "border-primary/40 bg-accent"
          : "border-border bg-card hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm",
            isAnonymous ? "font-mono" : "font-medium",
          )}
        >
          {patientName(patient, t)}
        </span>
        {patient.activeNeeds > 0 ? (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {t("carePlan.needsActive", { count: patient.activeNeeds })}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BedDouble className="size-3.5" />
        <span className="truncate">{unitLabel(patient)}</span>
      </div>
      {patient.latestHandover ? (
        <span
          className="inline-flex w-fit items-center gap-1 text-[11px] font-medium"
          style={{ color: "var(--status-boarding)" }}
        >
          <HeartHandshake className="size-3" />
          {t("carePlan.handoverWaiting")}
        </span>
      ) : null}
    </button>
  );
}
