"use client";

import { useT } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type { Consultation, TreatmentRecord } from "@careflow/shared";

/** Compact SOAP note renderer used in the doctor console's prior record. */
export function ConsultationNote({ consultation }: { consultation: Consultation }) {
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const rows: { label: string; value: string | null }[] = [
    { label: "S", value: consultation.subjective },
    // Compiled Review-of-Systems narrative (Phase 21); rows hydrated from a
    // pre-Phase-21 hosted schema may lack the field entirely.
    { label: "ROS", value: consultation.ros_summary ?? null },
    { label: "O", value: consultation.examination },
    { label: "A", value: consultation.assessment },
    { label: "P", value: consultation.plan },
  ].filter((r) => r.value);

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="font-mono text-[11px] text-muted-foreground">
        {formatDateTime(consultation.created_at, activeLocale)}
      </span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground">{t("drawer.emptyNote")}</span>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex gap-2">
            <span className="font-mono font-semibold text-muted-foreground">
              {r.label}
            </span>
            <span>{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** One-line monospace vitals summary ("SpO₂ 98% · BP 120/80 · …"). */
export function VitalsLine({ record }: { record: TreatmentRecord }) {
  const parts: string[] = [];
  if (record.spo2 !== null) parts.push(`SpO₂ ${record.spo2}%`);
  if (record.bp_systolic !== null && record.bp_diastolic !== null)
    parts.push(`BP ${record.bp_systolic}/${record.bp_diastolic}`);
  if (record.pulse !== null) parts.push(`HR ${record.pulse}`);
  if (record.temperature_c !== null) parts.push(`${record.temperature_c}°C`);
  if (record.weight_kg != null) parts.push(`${record.weight_kg} kg`);
  if (parts.length === 0) return null;
  return <span className="font-mono text-muted-foreground">{parts.join(" · ")}</span>;
}
