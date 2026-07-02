"use client";

/**
 * CareOrders (Phase 20) — the shared doctor↔nurse "Care & orders" panel for an
 * admitted patient. One list carries three kinds of item, color-coded by who
 * raised it, plus the nurse→doctor flag loop:
 *
 *  - Doctor adds a one-off **instruction** or a recurring **monitoring** order;
 *    both drop onto the nurse's list (monitoring shows a due/overdue chip driven
 *    by the same engine the MAR uses).
 *  - Nurse marks any item **done** (one tap) and can **flag the doctor** on a note
 *    while giving care; the flag sits on the doctor's view until acknowledged.
 *
 * Self-contained: it calls the mock-storage service directly and asks the parent
 * to refresh via `onChange`. Works for an admission in any department.
 */

import { useState } from "react";

import {
  Activity,
  Check,
  HeartHandshake,
  Plus,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { monitoringDoseStatus } from "@/components/care-plans/collaboration";
import { FREQUENCY_OPTIONS } from "@/components/medications/prescriptions";
import { useLocale, useT } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import {
  acknowledgeCarePlanEntry,
  addCarePlanEntry,
  addCarePlanItem,
  getStaffById,
  resolveCarePlanItem,
} from "@/services/mockStorage";
import type {
  CarePlanEntry,
  CarePlanItem,
  StaffRole,
} from "@careflow/shared";

const CLINICAL_ROLES: StaffRole[] = ["nurse", "doctor", "admin"];

/** Border accent token per item kind — "who asked" reads at a glance. */
function kindAccent(item: CarePlanItem): string {
  if (item.kind === "instruction") return "var(--status-diagnostics)";
  if (item.kind === "monitoring") return "var(--status-treatment)";
  return "var(--status-boarding)";
}

export function CareOrders({
  admissionId,
  items,
  entries,
  latestVitalsAt,
  actingRole,
  recorderId,
  onChange,
}: {
  admissionId: string;
  items: CarePlanItem[];
  entries: CarePlanEntry[];
  latestVitalsAt: string | null;
  actingRole: StaffRole | null;
  recorderId: string | null;
  onChange: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const isDoctor = actingRole === "doctor";
  const canWrite = actingRole !== null && CLINICAL_ROLES.includes(actingRole);

  const [instr, setInstr] = useState("");
  const [monitorWhat, setMonitorWhat] = useState("");
  const [monitorFreq, setMonitorFreq] = useState("every 4 hours");
  const [flag, setFlag] = useState("");

  const staffName = (id: string | null) =>
    id ? (getStaffById(id)?.full_name ?? "—") : "—";

  const active = items.filter((i) => i.status === "active");
  // Doctor orders (monitoring, then instruction) first; nursing needs after.
  const order = (i: CarePlanItem) =>
    i.kind === "monitoring" ? 0 : i.kind === "instruction" ? 1 : 2;
  const sorted = [...active].sort(
    (a, b) => order(a) - order(b) || a.created_at.localeCompare(b.created_at),
  );

  const openFlags = entries.filter((e) => e.needs_doctor && !e.acknowledged_at);
  const handover = entries
    .filter((e) => e.is_handover)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];

  const lastEntryAt = (itemId: string) =>
    entries
      .filter((e) => e.care_plan_item_id === itemId)
      .map((e) => e.recorded_at)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;

  const addInstruction = () => {
    if (!instr.trim()) return;
    addCarePlanItem(admissionId, {
      kind: "instruction",
      authored_role: "doctor",
      description: instr,
      created_by_id: recorderId,
    });
    setInstr("");
    onChange();
  };

  const addMonitoring = () => {
    if (!monitorWhat.trim()) return;
    addCarePlanItem(admissionId, {
      kind: "monitoring",
      authored_role: "doctor",
      monitors: "vitals",
      description: monitorWhat,
      frequency: monitorFreq,
      created_by_id: recorderId,
    });
    setMonitorWhat("");
    onChange();
  };

  const raiseFlag = () => {
    if (!flag.trim()) return;
    addCarePlanEntry(admissionId, {
      note: flag,
      needs_doctor: true,
      recorded_by_id: recorderId,
    });
    setFlag("");
    onChange();
  };

  const markDone = (id: string) => {
    resolveCarePlanItem(id);
    onChange();
  };

  const acknowledge = (id: string) => {
    acknowledgeCarePlanEntry(id, recorderId);
    onChange();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("carePlan.ordersBlock")}
        </h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {active.length}
        </span>
      </div>

      {/* Nurse → doctor flags awaiting acknowledgement */}
      {openFlags.map((e) => (
        <div
          key={e.id}
          className="flex flex-col gap-1.5 rounded-md border p-3 text-xs"
          style={{
            borderColor: "color-mix(in oklab, var(--status-treatment) 50%, transparent)",
            background: "color-mix(in oklab, var(--status-treatment) 8%, transparent)",
          }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--status-treatment)" }}
          >
            <TriangleAlert className="size-3" />
            {t("carePlan.flagged")}
          </span>
          <span>{e.note}</span>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-muted-foreground">
              {t("carePlan.raisedBy", { name: staffName(e.recorded_by_id) })} ·{" "}
              {formatDateTime(e.recorded_at, activeLocale)}
            </span>
            {isDoctor ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => acknowledge(e.id)}
              >
                <Check className="size-3" />
                {t("carePlan.acknowledge")}
              </Button>
            ) : (
              <span className="font-medium" style={{ color: "var(--status-treatment)" }}>
                {t("carePlan.awaitingDoctor")}
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Latest handover (nurse ↔ nurse) */}
      {handover ? (
        <div
          className="flex flex-col gap-1 rounded-md border p-3 text-xs"
          style={{
            borderColor: "color-mix(in oklab, var(--status-boarding) 40%, transparent)",
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

      {/* The shared list */}
      {sorted.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {t("carePlan.noNeeds")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((item) => {
            const isMonitoring = item.kind === "monitoring";
            const isInstruction = item.kind === "instruction";
            const Icon = isMonitoring
              ? Activity
              : isInstruction
                ? Stethoscope
                : item.category
                  ? CARE_NEED_CATEGORY_ICON[item.category]
                  : Activity;
            const kindLabel = isMonitoring
              ? t("carePlan.kindMonitoring")
              : isInstruction
                ? t("carePlan.kindInstruction")
                : item.category
                  ? t(CARE_NEED_CATEGORY_LABEL[item.category])
                  : t("carePlan.kindNursing");

            const dose = isMonitoring
              ? monitoringDoseStatus(
                  item,
                  item.monitors === "vitals" ? latestVitalsAt : lastEntryAt(item.id),
                )
              : null;
            const showChip =
              dose && (dose.state === "due" || dose.state === "overdue");

            return (
              <div
                key={item.id}
                className="flex items-start gap-2.5 rounded-md border border-l-[3px] border-border p-3 text-xs"
                style={{ borderLeftColor: kindAccent(item) }}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: kindAccent(item) }}
                    >
                      {kindLabel}
                    </span>
                    {showChip ? (
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                        style={{
                          color: "var(--status-treatment)",
                          background:
                            "color-mix(in oklab, var(--status-treatment) 14%, transparent)",
                        }}
                      >
                        {t(`doseState.${dose!.state}`)}
                      </span>
                    ) : null}
                  </div>
                  <span>{item.description}</span>
                  {item.frequency ? (
                    <span className="text-muted-foreground">{item.frequency}</span>
                  ) : null}
                </div>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => markDone(item.id)}
                  >
                    <Check className="size-3" />
                    {t("carePlan.markDone")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Doctor: add an instruction or a monitoring order */}
      {isDoctor ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={instr}
              onChange={(e) => setInstr(e.target.value)}
              placeholder={t("carePlan.addInstructionPlaceholder")}
              className="h-8 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addInstruction()}
            />
            <Button size="sm" className="h-8 shrink-0 gap-1 px-2 text-[11px]" onClick={addInstruction}>
              <Plus className="size-3" />
              {t("carePlan.addInstruction")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={monitorWhat}
              onChange={(e) => setMonitorWhat(e.target.value)}
              placeholder={t("carePlan.addMonitoringPlaceholder")}
              className="h-8 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addMonitoring()}
            />
            <select
              value={monitorFreq}
              onChange={(e) => setMonitorFreq(e.target.value)}
              className="h-8 shrink-0 rounded-md border border-input bg-transparent px-2 text-xs"
              aria-label={t("carePlan.kindMonitoring")}
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1 px-2 text-[11px]"
              onClick={addMonitoring}
            >
              <Activity className="size-3" />
              {t("carePlan.addMonitoring")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Nurse (and other clinical roles): flag something for the doctor */}
      {canWrite && !isDoctor ? (
        <div className="flex items-center gap-2">
          <Input
            value={flag}
            onChange={(e) => setFlag(e.target.value)}
            placeholder={t("carePlan.flagPlaceholder")}
            className="h-8 text-xs"
            onKeyDown={(e) => e.key === "Enter" && raiseFlag()}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1 px-2 text-[11px]"
            onClick={raiseFlag}
          >
            <TriangleAlert className="size-3" />
            {t("carePlan.flagForDoctor")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
