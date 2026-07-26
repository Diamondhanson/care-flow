"use client";

import { useState } from "react";
import type * as React from "react";
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Eye,
  HeartOff,
  Home,
  Lock,
  Send,
  ShieldAlert,
} from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  evaluateDischargeReadiness,
  recordDeath,
  recordDisposition,
  updateVisitStage,
  type Disposition,
} from "@/services/mockStorage";
import { nextStage, stageLabel, tokenForStage } from "@/components/live-board/stages";
import {
  DispositionDialogs,
  type DispositionDialogKind,
} from "@/components/live-board/drawer/disposition-dialogs";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type {
  Admission,
  Bed,
  Patient,
  StaffId,
  Visit,
  Ward,
} from "@careflow/shared";
import type { MessageKey } from "@/i18n";

const DISPOSITIONS: {
  value: Disposition;
  labelKey: MessageKey;
  icon: typeof Home;
}[] = [
  { value: "discharge_home", labelKey: "drawer.dispositionDischargeHome", icon: Home },
  { value: "admit", labelKey: "drawer.dispositionAdmit", icon: BedDouble },
  { value: "observation", labelKey: "drawer.dispositionObservation", icon: Eye },
  { value: "refer", labelKey: "drawer.dispositionRefer", icon: Send },
];

/**
 * Disposition decision grid — part of the doctor console. Discharge home
 * records immediately; admit / observation / referral each open a centered
 * dialog (see {@link DispositionDialogs}) to capture their structured details
 * before recording.
 */
export function DispositionGrid({
  visit,
  displayName,
  wards,
  beds,
  recorderId,
  onMutated,
}: {
  visit: Visit;
  displayName: string;
  wards: Ward[];
  beds: Bed[];
  recorderId: StaffId | null;
  onMutated: () => void;
}) {
  const { t } = useT();

  // Disposition detail dialogs — admit (placement), observation, referral.
  const [dispoDialog, setDispoDialog] = useState<DispositionDialogKind | null>(
    null,
  );

  function handleDisposition(disposition: Disposition) {
    if (
      disposition === "admit" ||
      disposition === "observation" ||
      disposition === "refer"
    ) {
      setDispoDialog(disposition);
      return;
    }
    recordDisposition(visit.id, disposition, recorderId);
    onMutated();
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">{t("drawer.disposition")}</span>
        <p className="text-xs text-muted-foreground">{t("drawer.dispositionHint")}</p>
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => {
            const Icon = d.icon;
            return (
              <Button
                key={d.value}
                variant="outline"
                onClick={() => handleDisposition(d.value)}
                className="justify-start"
              >
                <Icon className="size-4" />
                {t(d.labelKey)}
              </Button>
            );
          })}
        </div>
      </div>

      <DispositionDialogs
        kind={dispoDialog}
        visit={visit}
        displayName={displayName}
        wards={wards}
        beds={beds}
        recorderId={recorderId}
        onClose={() => setDispoDialog(null)}
        onSubmitted={() => {
          setDispoDialog(null);
          onMutated();
        }}
      />
    </>
  );
}

/**
 * Care stage progression + closing actions. Discharge is a closing action, so
 * it's gated behind an explicit confirm step that states the outcome before
 * the visit drops off the board; recording a death is confirm-gated too, with
 * an optional note, and is exempt from the discharge clearance gates.
 *
 * The confirm steps are tied to the open patient — the orchestrator remounts
 * this component (via `key`) when the visit changes, and `resetKey` refreshes
 * do not clear an in-progress confirmation.
 */
export function CareStageSection({
  visit,
  admission,
  patient,
  displayName,
  recorderId,
  onMutated,
  onClosed,
  className,
  style,
}: {
  visit: Visit;
  admission: Admission | null;
  patient: Patient;
  displayName: string;
  recorderId: StaffId | null;
  /** Refresh after a non-closing mutation (stage advance). */
  onMutated: () => void;
  /** The visit closed (discharge/death) — notify the board and close the drawer. */
  onClosed: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  // Discharge is a closing action, so it's gated behind an explicit confirm
  // step; a death is confirm-gated too, with an optional cause note.
  const [confirmingDischarge, setConfirmingDischarge] = useState(false);
  const [confirmingDeath, setConfirmingDeath] = useState(false);
  const [deathNote, setDeathNote] = useState("");

  const currentToken = tokenForStage(visit.stage);
  const target = nextStage(visit.stage, visit.visit_type);
  const readiness = admission
    ? evaluateDischargeReadiness(admission, patient)
    : { ready: true, blockers: [] as MessageKey[] };
  const advancingToDischarge = target === "discharged";
  const dischargeBlocked = advancingToDischarge && !readiness.ready;
  const isDeceased = visit.stage === "deceased";
  // A death can be recorded from any active stage (incl. on arrival), but not
  // once the visit has already closed (discharged / followed-up / deceased).
  const canRecordDeath = visit.status === "open" && !isDeceased;

  function handleAdvance() {
    if (!target) return;
    if (advancingToDischarge && !readiness.ready) return;
    updateVisitStage(visit.id, target);
    if (advancingToDischarge) {
      // Discharged — the visit closes and drops off the active board.
      onClosed();
    } else {
      onMutated();
    }
  }

  function handleRecordDeath() {
    recordDeath(visit.id, recorderId, deathNote.trim() || null);
    // The visit closes and drops off the active board, like a discharge.
    onClosed();
  }

  return (
    <section className={className} style={style}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {t("drawer.careStage")}
      </h3>
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{
            backgroundColor: isDeceased
              ? "var(--status-deceased)"
              : `var(--status-${currentToken})`,
          }}
        />
        <span className="text-sm font-medium">{t(stageLabel(visit.stage))}</span>
      </div>

      {isDeceased ? (
        <div
          className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm"
          style={{
            borderColor: "var(--status-deceased)",
            backgroundColor:
              "color-mix(in oklab, var(--status-deceased) 12%, transparent)",
          }}
        >
          <HeartOff
            className="size-4 shrink-0"
            style={{ color: "var(--status-deceased)" }}
          />
          <span>
            {visit.closed_at
              ? t("drawer.deceasedRecordedOn", {
                  date: formatDateTime(visit.closed_at, activeLocale),
                })
              : t("drawer.deceasedRecorded")}
          </span>
        </div>
      ) : target === null ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <CheckCircle2
            className="size-4 shrink-0"
            style={{ color: "var(--status-clearance)" }}
          />
          {t("drawer.journeyComplete")}
        </div>
      ) : (
        <>
          {dischargeBlocked ? (
            <div
              className="flex flex-col gap-2 rounded-md border p-3 text-xs"
              style={{
                borderColor: "var(--status-treatment)",
                backgroundColor:
                  "color-mix(in oklab, var(--status-treatment) 12%, transparent)",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldAlert
                  className="size-4 shrink-0"
                  style={{ color: "var(--status-treatment)" }}
                />
                {t("drawer.dischargeBlocked")}
              </div>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {readiness.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <Lock className="mt-0.5 size-3 shrink-0" />
                    <span>{t(b)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {advancingToDischarge && confirmingDischarge && !dischargeBlocked ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                {t("drawer.dischargeConfirmBody", { name: displayName })}
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDischarge(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button size="sm" onClick={handleAdvance}>
                  <CheckCircle2 className="size-4" />
                  {t("drawer.dischargeConfirm")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={
                advancingToDischarge
                  ? () => setConfirmingDischarge(true)
                  : handleAdvance
              }
              disabled={dischargeBlocked}
              className="self-end"
            >
              {advancingToDischarge ? (
                <>{t("drawer.dischargeFollowUp")}</>
              ) : (
                <>{t("drawer.advanceTo", { stage: t(stageLabel(target)) })}</>
              )}
              {dischargeBlocked ? (
                <Lock className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </Button>
          )}
        </>
      )}

      {/* Record death — confirm-gated terminal outcome, available at any
          active stage; bypasses the discharge clearance gate. */}
      {canRecordDeath ? (
        confirmingDeath ? (
          <div
            className="flex flex-col gap-3 rounded-md border p-3"
            style={{
              borderColor: "var(--status-deceased)",
              backgroundColor:
                "color-mix(in oklab, var(--status-deceased) 10%, transparent)",
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <HeartOff
                className="size-4 shrink-0"
                style={{ color: "var(--status-deceased)" }}
              />
              {t("drawer.recordDeathConfirmTitle")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("drawer.recordDeathConfirmBody", { name: displayName })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="death-note">{t("drawer.recordDeathNote")}</Label>
              <Textarea
                id="death-note"
                value={deathNote}
                onChange={(e) => setDeathNote(e.target.value)}
                placeholder={t("drawer.recordDeathNotePlaceholder")}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirmingDeath(false);
                  setDeathNote("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleRecordDeath}
                style={{
                  backgroundColor: "var(--status-deceased)",
                  color: "var(--status-deceased-foreground)",
                }}
              >
                <HeartOff className="size-4" />
                {t("drawer.recordDeathConfirm")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDeath(true)}
            className="self-end text-muted-foreground hover:text-foreground"
          >
            <HeartOff className="size-4" />
            {t("drawer.recordDeath")}
          </Button>
        )
      ) : null}
    </section>
  );
}
