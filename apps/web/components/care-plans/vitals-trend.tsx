"use client";

/**
 * VitalsTrend (Phase 20) — a compact "how are the vitals changing" view for the
 * doctor, over the latest N readings a nurse has charted. Out-of-range values are
 * highlighted so a deteriorating trend reads at a glance. Pure presentation over
 * the existing `treatment_records` (no new data).
 */

import { useLocale, useT } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type { TreatmentRecord } from "@careflow/shared";

const HIGH = "var(--status-treatment)";

function flag(value: number | null, low: number, high: number): boolean {
  return value != null && (value < low || value > high);
}

function Cell({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <td
      className="px-2 py-1 text-right font-mono tabular-nums"
      style={alert ? { color: HIGH, fontWeight: 600 } : undefined}
    >
      {children}
    </td>
  );
}

export function VitalsTrend({
  records,
  limit = 6,
}: {
  records: TreatmentRecord[];
  limit?: number;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  if (records.length === 0) return null;

  // Newest first; show up to `limit` readings.
  const rows = [...records]
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    .slice(0, limit);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("carePlan.vitalsTrend")}
      </span>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">{t("carePlan.vTime")}</th>
              <th className="px-2 py-1 text-right font-medium">SpO₂</th>
              <th className="px-2 py-1 text-right font-medium">BP</th>
              <th className="px-2 py-1 text-right font-medium">{t("carePlan.vPulse")}</th>
              <th className="px-2 py-1 text-right font-medium">{t("carePlan.vTemp")}</th>
              <th className="px-2 py-1 text-right font-medium">GCS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-2 py-1 text-left font-mono text-muted-foreground">
                  {formatDateTime(r.recorded_at, activeLocale)}
                </td>
                <Cell alert={flag(r.spo2, 92, 200)}>{r.spo2 ?? "—"}</Cell>
                <Cell alert={flag(r.bp_systolic, 90, 180)}>
                  {r.bp_systolic != null && r.bp_diastolic != null
                    ? `${r.bp_systolic}/${r.bp_diastolic}`
                    : "—"}
                </Cell>
                <Cell alert={flag(r.pulse, 50, 120)}>{r.pulse ?? "—"}</Cell>
                <Cell alert={flag(r.temperature_c, 35, 38.5)}>
                  {r.temperature_c ?? "—"}
                </Cell>
                <Cell alert={flag(r.gcs_score, 13, 15)}>{r.gcs_score ?? "—"}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
