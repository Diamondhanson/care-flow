"use client";

/**
 * Moment 2 draft cards (Phase 22, spec §10): suggested diagnoses (Add →
 * existing create-diagnosis service), editable medications guarded by a
 * BLOCKING allergy banner (critical flags must be acknowledged before
 * Prescribe enables), and an informational disposition card that points the
 * doctor at the existing care-stage controls — it never auto-admits.
 */

import { useState } from "react";
import { Check, Plus, ShieldAlert, X } from "lucide-react";

import type { AiSafetyFlag, ResultsSuggestion } from "@careflow/shared/types/ai";
import type { StaffId, VisitId } from "@careflow/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/locale-provider";
import { msgKey } from "@/i18n";
import { recordDecision } from "@/lib/ai/api-client";
import { addDiagnosis, addPrescription } from "@/services/mockStorage";

import { ConfidenceBadge, SourceChips, WhyLine } from "./suggestion-bits";

/** A critical allergy_check flag naming this drug blocks its Prescribe. */
function conflictsFor(drugName: string, flags: AiSafetyFlag[]): AiSafetyFlag[] {
  const needle = drugName.trim().toLowerCase();
  return flags.filter(
    (f) =>
      f.severity === "critical" &&
      f.source === "allergy_check" &&
      f.message.toLowerCase().includes(needle),
  );
}

function MedicationRow({
  med,
  flags,
  acknowledged,
  onPrescribe,
}: {
  med: ResultsSuggestion["medications"][number];
  flags: AiSafetyFlag[];
  acknowledged: boolean;
  onPrescribe: (final: typeof med) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(med);
  const [state, setState] = useState<"draft" | "saved" | "dismissed">("draft");

  const conflicts = conflictsFor(med.drugName, flags);
  const blocked = conflicts.length > 0 && !acknowledged;

  if (state === "dismissed") return null;

  const field = (
    key: "dose" | "route" | "frequency" | "duration",
    labelKey: "ai.med.dose" | "ai.med.route" | "ai.med.frequency" | "ai.med.duration",
  ) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t(labelKey)}
      </span>
      <Input
        value={draft[key] ?? ""}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value || null })}
        disabled={state === "saved"}
        className="h-8 font-mono text-xs"
      />
    </label>
  );

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-background p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{draft.drugName}</span>
        <ConfidenceBadge level={med.confidence} />
        {state === "saved" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" style={{ color: "var(--success)" }} />
            {t("ai.prescribed")}
          </span>
        ) : null}
      </div>

      {conflicts.length > 0 ? (
        <p
          className="flex items-start gap-2 rounded-md px-2.5 py-2 text-xs font-medium"
          style={{
            backgroundColor: "color-mix(in oklab, var(--destructive) 12%, transparent)",
            color: "var(--destructive)",
          }}
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{conflicts.map((c) => c.message).join(" ")}</span>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field("dose", "ai.med.dose")}
        {field("route", "ai.med.route")}
        {field("frequency", "ai.med.frequency")}
        {field("duration", "ai.med.duration")}
      </div>
      <WhyLine rationale={med.reason} />

      {state === "draft" ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={blocked}
            title={blocked ? t("ai.allergyWarning") : undefined}
            onClick={() => {
              onPrescribe(draft);
              setState("saved");
            }}
          >
            <Check className="size-3.5" />
            {t("ai.prescribe")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState("dismissed")}>
            <X className="size-3.5" />
            {t("ai.dismiss")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ResultsCards({
  suggestion,
  suggestionId,
  visitId,
  recorderId,
  onMutated,
}: {
  suggestion: ResultsSuggestion;
  suggestionId: string;
  visitId: VisitId;
  recorderId: StaffId | null;
  onMutated: () => void;
}) {
  const { t } = useT();
  const [addedDx, setAddedDx] = useState<Set<number>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);

  const criticalFlags = suggestion.safetyFlags.filter((f) => f.severity === "critical");
  const infoFlags = suggestion.safetyFlags.filter((f) => f.severity !== "critical");

  function addDx(index: number) {
    const dx = suggestion.diagnoses[index];
    if (!dx) return;
    addDiagnosis(visitId, {
      diagnosed_by_id: recorderId,
      icd10_code: dx.icd10,
      description: dx.description,
      is_primary: dx.isPrimary,
    });
    recordDecision(suggestionId, "accepted", { part: "diagnosis", value: dx });
    setAddedDx((prev) => new Set(prev).add(index));
    onMutated();
  }

  function prescribe(final: ResultsSuggestion["medications"][number], original: ResultsSuggestion["medications"][number]) {
    addPrescription(visitId, {
      prescribed_by_id: recorderId,
      drug_name: final.drugName,
      dose: final.dose,
      route: final.route,
      frequency: final.frequency,
      duration: final.duration,
      instructions: final.instructions,
    });
    const edited = JSON.stringify(final) !== JSON.stringify(original);
    recordDecision(suggestionId, edited ? "edited" : "accepted", {
      part: "medication",
      value: final,
    });
    onMutated();
  }

  if (suggestion.insufficientData) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        {t("ai.insufficientData")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Blocking allergy banner — critical flags must be acknowledged. */}
      {criticalFlags.length > 0 ? (
        <div
          className="flex flex-col gap-2 rounded-md border p-3"
          style={{
            borderColor: "color-mix(in oklab, var(--destructive) 45%, transparent)",
            backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
          }}
        >
          <p
            className="flex items-start gap-2 text-sm font-semibold"
            style={{ color: "var(--destructive)" }}
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {t("ai.allergyWarning")}
          </p>
          <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--destructive)" }}>
            {criticalFlags.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="size-4 accent-current"
            />
            {t("ai.allergyAcknowledge")}
          </label>
        </div>
      ) : null}

      {suggestion.diagnoses.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          <h4 className="text-xs font-semibold">{t("ai.diagnoses")}</h4>
          <ul className="flex flex-col gap-2">
            {suggestion.diagnoses.map((dx, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {dx.description}
                    {dx.icd10 ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {dx.icd10}
                      </span>
                    ) : null}
                    {dx.isPrimary ? (
                      <span className="rounded border border-border px-1 text-[10px] uppercase text-muted-foreground">
                        {t("ai.primary")}
                      </span>
                    ) : null}
                    <ConfidenceBadge level={dx.confidence} />
                  </span>
                  <WhyLine rationale={dx.rationale} />
                  <SourceChips sources={dx.sources} />
                </div>
                {addedDx.has(i) ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5" style={{ color: "var(--success)" }} />
                    {t("ai.added")}
                  </span>
                ) : (
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => addDx(i)}>
                    <Plus className="size-3.5" />
                    {t("ai.add")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {suggestion.medications.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          <h4 className="text-xs font-semibold">{t("ai.medications")}</h4>
          <ul className="flex flex-col gap-2">
            {suggestion.medications.map((med, i) => (
              <MedicationRow
                key={i}
                med={med}
                flags={suggestion.safetyFlags}
                acknowledged={acknowledged}
                onPrescribe={(final) => prescribe(final, med)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
        <h4 className="flex items-center gap-2 text-xs font-semibold">
          {t("ai.disposition")}
          <ConfidenceBadge level={suggestion.disposition.confidence} />
        </h4>
        <p className="text-sm font-medium">
          {t(msgKey(`ai.dispo.${suggestion.disposition.recommendation}`))}
          {suggestion.disposition.suggestedWard ? (
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {suggestion.disposition.suggestedWard}
            </span>
          ) : null}
        </p>
        <WhyLine rationale={suggestion.disposition.rationale} />
        <p className="text-xs text-muted-foreground">{t("ai.dispositionNote")}</p>
      </div>

      {infoFlags.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {infoFlags.map((f, i) => (
            <li
              key={i}
              className="text-xs"
              style={{
                color:
                  f.severity === "warning"
                    ? "var(--status-warning)"
                    : "var(--muted-foreground)",
              }}
            >
              {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
