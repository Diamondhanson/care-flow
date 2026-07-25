"use client";

import { useState } from "react";
import type * as React from "react";
import { Activity } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { addTreatmentLog } from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type { StaffId, VisitId } from "@careflow/shared";
import type { MessageKey } from "@/i18n";

type NumField = "" | string;

type VitalFields = {
  spo2: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  temperature_c: number | null;
  weight_kg: number | null;
  gcs_score: number | null;
};

/**
 * Hard clinical bounds for the vitals form — values outside these ranges are
 * physiologically implausible (likely typos) and are refused with an inline
 * error rather than saved. Only fields the user actually filled are checked.
 */
const VITAL_BOUNDS: {
  field: keyof VitalFields;
  labelKey: MessageKey;
  min: number;
  max: number;
}[] = [
  { field: "spo2", labelKey: "drawer.vitalsSpo2", min: 0, max: 100 },
  { field: "bp_systolic", labelKey: "drawer.vitalsSys", min: 20, max: 300 },
  { field: "bp_diastolic", labelKey: "drawer.vitalsDia", min: 20, max: 300 },
  { field: "pulse", labelKey: "drawer.vitalsPulse", min: 10, max: 350 },
  { field: "temperature_c", labelKey: "drawer.vitalsTemp", min: 25, max: 45 },
  { field: "weight_kg", labelKey: "drawer.vitalsWeight", min: 0.3, max: 500 },
  { field: "gcs_score", labelKey: "drawer.vitalsGcs", min: 3, max: 15 },
];

/** Maps a VitalsSchema field name to its i18n label key, so an engine-side
 *  validation error can still name the exact field that's out of range. */
const VITALS_FIELD_LABEL_KEY: Record<string, MessageKey> = {
  spo2: "drawer.vitalsSpo2",
  pulse: "drawer.vitalsPulse",
  bp_systolic: "drawer.vitalsSys",
  bp_diastolic: "drawer.vitalsDia",
  temperature_c: "drawer.vitalsTemp",
  weight_kg: "drawer.vitalsWeight",
  gcs_score: "drawer.vitalsGcs",
};

function num(v: NumField): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Vitals + GCS + notes log entry, with hard range validation. */
export function VitalsForm({
  visitId,
  recorderId,
  resetKey,
  onSaved,
  className,
  style,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  resetKey: string;
  onSaved: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();

  const [spo2, setSpo2] = useState<NumField>("");
  const [sys, setSys] = useState<NumField>("");
  const [dia, setDia] = useState<NumField>("");
  const [pulse, setPulse] = useState<NumField>("");
  const [temp, setTemp] = useState<NumField>("");
  const [weight, setWeight] = useState<NumField>("");
  const [gcs, setGcs] = useState<NumField>("");
  const [notes, setNotes] = useState("");
  const [vitalsError, setVitalsError] = useState<string | null>(null);

  // Reset the log entry form on drawer open / after a save.
  useFormReset(resetKey, () => {
    setSpo2("");
    setSys("");
    setDia("");
    setPulse("");
    setTemp("");
    setWeight("");
    setGcs("");
    setNotes("");
    setVitalsError(null);
  });

  function handleLog() {
    const fields: VitalFields = {
      spo2: num(spo2),
      bp_systolic: num(sys),
      bp_diastolic: num(dia),
      pulse: num(pulse),
      temperature_c: num(temp),
      weight_kg: num(weight),
      gcs_score: num(gcs),
    };
    const hasVitals = Object.values(fields).some((v) => v !== null);
    if (!hasVitals && !notes.trim()) {
      return;
    }
    // Hard clinical bounds — refuse to save physiologically implausible values
    // (only fields the user actually filled are checked).
    const outOfRange = VITAL_BOUNDS.find((b) => {
      const value = fields[b.field];
      return value !== null && (value < b.min || value > b.max);
    });
    if (outOfRange) {
      setVitalsError(
        t("drawer.vitalsOutOfRange", {
          field: t(outOfRange.labelKey),
          min: outOfRange.min,
          max: outOfRange.max,
        }),
      );
      return;
    }
    // Surface an engine-side validation failure instead of silently dropping
    // the entry: a thrown error here must never lose the nurse's observation
    // without telling them.
    try {
      addTreatmentLog(visitId, {
        recorded_by_id: recorderId,
        ...fields,
        notes: notes.trim() || null,
      });
      setVitalsError(null);
      onSaved();
    } catch (err) {
      // Name the offending field(s) (e.g. GCS out of its 3–15 range) so the
      // nurse knows exactly what to fix, rather than a generic "check values".
      const issues = (err as { issues?: { path: (string | number)[] }[] }).issues;
      const labels = issues
        ? Array.from(
            new Set(
              issues
                .map((i) => VITALS_FIELD_LABEL_KEY[String(i.path[0])])
                .filter(Boolean),
            ),
          ).map((k) => t(k))
        : [];
      setVitalsError(
        labels.length
          ? t("drawer.vitalsInvalidFields", { fields: labels.join(", ") })
          : t("drawer.vitalsInvalid"),
      );
    }
  }

  return (
    <section className={className} style={style}>
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("drawer.logVitals")}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FieldNum label={t("drawer.vitalsSpo2")} id="spo2" value={spo2} onChange={setSpo2} />
        <FieldNum label={t("drawer.vitalsPulse")} id="pulse" value={pulse} onChange={setPulse} />
        <FieldNum label={t("drawer.vitalsSys")} id="sys" value={sys} onChange={setSys} />
        <FieldNum label={t("drawer.vitalsDia")} id="dia" value={dia} onChange={setDia} />
        <FieldNum label={t("drawer.vitalsTemp")} id="temp" value={temp} onChange={setTemp} step="0.1" />
        <FieldNum label={t("drawer.vitalsWeight")} id="weight" value={weight} onChange={setWeight} step="0.1" />
        <FieldNum label={t("drawer.vitalsGcs")} id="gcs" value={gcs} onChange={setGcs} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">{t("drawer.notes")}</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("drawer.notesPlaceholder")}
        />
      </div>
      {vitalsError ? (
        <p role="alert" className="text-sm text-destructive">
          {vitalsError}
        </p>
      ) : null}
      <Button onClick={handleLog} className="self-end">
        {t("drawer.saveLog")}
      </Button>
    </section>
  );
}

function FieldNum({
  label,
  id,
  value,
  onChange,
  step,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
    </div>
  );
}
