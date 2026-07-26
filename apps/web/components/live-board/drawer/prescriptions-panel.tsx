"use client";

import { useState } from "react";
import { AlertTriangle, Pill } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FREQUENCY_OPTIONS,
  MEAL_TIMING_LABEL,
  MEAL_TIMING_OPTIONS,
  PRESCRIPTION_STATUS_LABEL,
  PRESCRIPTION_STATUS_TOKEN,
  ROUTE_OPTIONS,
} from "@/components/medications/prescriptions";
import {
  ALLERGY_SEVERITY_LABEL,
  allergyDisplayState,
  sortAllergiesBySeverity,
} from "@/components/allergies/allergies";
import { TermAutocomplete } from "@/components/clinical-terms/term-autocomplete";
import { displayTerm } from "@/lib/clinical-terms/search";
import {
  addPrescription,
  deletePrescription,
  updatePrescription,
  type AddPrescriptionInput,
  type UpdatePrescriptionInput,
} from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import { DeleteControl } from "@/components/live-board/drawer/delete-control";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type {
  Allergy,
  ClinicalTerm,
  MarStatus,
  MealTiming,
  MedicationAdministration,
  Prescription,
  PrescriptionId,
  StaffId,
  VisitId,
} from "@careflow/shared";

/** Dot colour for a MAR status in the doctor's read-only administration log. */
const MAR_STATUS_COLOR: Record<MarStatus, string> = {
  given: "var(--status-clearance)",
  held: "var(--status-boarding)",
  refused: "var(--status-treatment)",
  suspended: "var(--status-discharge)",
  missed: "var(--muted-foreground)",
};

/**
 * Prescriptions — instant-added from the drug picker, refined inline per row
 * (dose / route / frequency quick-pick / duration / meal timing /
 * instructions). Shows the drug-allergy warning banner above the list, the
 * nurse's MAR log per prescription, and a two-step delete for mistakes.
 */
export function PrescriptionsPanel({
  visitId,
  recorderId,
  prescriptions,
  medAdmins,
  allergies,
  noKnownAllergies,
  resetKey,
  onMutated,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  prescriptions: Prescription[];
  /** MAR log per prescription id — what the nurse did with each dose. */
  medAdmins: Record<string, MedicationAdministration[]>;
  allergies: Allergy[];
  noKnownAllergies: boolean;
  resetKey: string;
  onMutated: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [rxDraft, setRxDraft] = useState("");
  // A two-step confirm for deleting a mistaken prescription.
  const [pendingDeleteId, setPendingDeleteId] = useState<PrescriptionId | null>(
    null,
  );

  // Reset the draft (and any armed delete) on drawer open / after a save.
  useFormReset(resetKey, () => {
    setRxDraft("");
    setPendingDeleteId(null);
  });

  const allergyState = allergyDisplayState(noKnownAllergies, allergies.length);
  const drugAllergies = sortAllergiesBySeverity(allergies).filter(
    (a) => a.category === "drug",
  );

  // Frequency + meal-timing quick-picks for the prescription editor. The current
  // value is folded into the option list so a free-text frequency coming from a
  // clinical-term pick still renders (and stays selectable) in the dropdown.
  const freqOptions = (current: string | null | undefined): string[] =>
    current && !FREQUENCY_OPTIONS.includes(current)
      ? [current, ...FREQUENCY_OPTIONS]
      : FREQUENCY_OPTIONS;
  const freqItems = (
    current: string | null | undefined,
  ): Record<string, string> =>
    Object.fromEntries(freqOptions(current).map((f) => [f, f]));
  const mealTimingItems: Record<string, string> = Object.fromEntries(
    MEAL_TIMING_OPTIONS.map((m) => [m, t(MEAL_TIMING_LABEL[m])]),
  );

  function handleAddPrescription(
    input: Omit<AddPrescriptionInput, "prescribed_by_id">,
  ) {
    if (!input.drug_name.trim()) return;
    addPrescription(visitId, { prescribed_by_id: recorderId, ...input });
    onMutated();
  }

  function handleUpdatePrescription(
    prescriptionId: PrescriptionId,
    input: UpdatePrescriptionInput,
  ) {
    updatePrescription(prescriptionId, input);
    onMutated();
  }

  function handleDeletePrescription(prescriptionId: PrescriptionId) {
    deletePrescription(prescriptionId);
    setPendingDeleteId(null);
    onMutated();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Pill className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("drawer.prescriptions")}</span>
      </div>

      {drugAllergies.length > 0 ? (
        <div
          className="flex items-start gap-2 rounded-md border p-2.5 text-xs"
          style={{
            borderColor: "var(--status-treatment)",
            backgroundColor:
              "color-mix(in oklab, var(--status-treatment) 8%, transparent)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0"
            style={{ color: "var(--status-treatment)" }}
          />
          <span>
            <span className="font-medium">{t("drawer.drugAllergiesLabel")}</span>{" "}
            {drugAllergies
              .map(
                (a) =>
                  `${a.substance} (${t(ALLERGY_SEVERITY_LABEL[a.severity]).toLowerCase()})`,
              )
              .join(", ")}
            . {t("drawer.reviewBeforePrescribing")}
          </span>
        </div>
      ) : allergyState === "unassessed" ? (
        <p className="text-xs text-muted-foreground">
          {t("drawer.allergiesNotAssessedRx")}
        </p>
      ) : null}

      <datalist id="route-options">
        {ROUTE_OPTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {prescriptions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {prescriptions.map((p) => {
            const token = PRESCRIPTION_STATUS_TOKEN[p.status];
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{p.drug_name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {token === "muted" ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-transparent text-[10px] uppercase"
                      >
                        {t(PRESCRIPTION_STATUS_LABEL[p.status])}
                      </Badge>
                    ) : (
                      <StatusBadge tone={token} variant="solid">
                        {t(PRESCRIPTION_STATUS_LABEL[p.status])}
                      </StatusBadge>
                    )}
                    <DeleteControl
                      armed={pendingDeleteId === p.id}
                      onArm={() => setPendingDeleteId(p.id)}
                      onCancel={() => setPendingDeleteId(null)}
                      onConfirm={() => handleDeletePrescription(p.id)}
                      label={t("drawer.deletePrescription")}
                      confirmLabel={t("drawer.confirmDelete")}
                      cancelLabel={t("drawer.cancelDelete")}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    key={`dose:${p.dose ?? ""}`}
                    defaultValue={p.dose ?? ""}
                    onBlur={(e) =>
                      handleUpdatePrescription(p.id, {
                        dose: e.target.value,
                      })
                    }
                    placeholder={t("drawer.dosePlaceholder")}
                    className="h-7 font-mono text-xs"
                  />
                  <Input
                    key={`route:${p.route ?? ""}`}
                    list="route-options"
                    defaultValue={p.route ?? ""}
                    onBlur={(e) =>
                      handleUpdatePrescription(p.id, {
                        route: e.target.value,
                      })
                    }
                    placeholder={t("drawer.routePlaceholder")}
                    className="h-7 text-xs"
                  />
                  <Select
                    value={p.frequency ?? null}
                    onValueChange={(v) =>
                      handleUpdatePrescription(p.id, {
                        frequency: (v as string) ?? null,
                      })
                    }
                    items={freqItems(p.frequency)}
                  >
                    <SelectTrigger className="h-7 w-full text-xs">
                      <SelectValue
                        placeholder={t("drawer.frequencyPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {freqOptions(p.frequency).map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    key={`dur:${p.duration ?? ""}`}
                    defaultValue={p.duration ?? ""}
                    onBlur={(e) =>
                      handleUpdatePrescription(p.id, {
                        duration: e.target.value,
                      })
                    }
                    placeholder={t("drawer.durationPlaceholder")}
                    className="h-7 text-xs"
                  />
                </div>
                <Select
                  value={p.meal_timing ?? null}
                  onValueChange={(v) =>
                    handleUpdatePrescription(p.id, {
                      meal_timing: v as MealTiming,
                    })
                  }
                  items={mealTimingItems}
                >
                  <SelectTrigger className="h-7 w-full text-xs">
                    <SelectValue
                      placeholder={t("drawer.mealTimingPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_TIMING_OPTIONS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(MEAL_TIMING_LABEL[m])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  key={`instr:${p.instructions ?? ""}`}
                  defaultValue={p.instructions ?? ""}
                  onBlur={(e) =>
                    handleUpdatePrescription(p.id, {
                      instructions: e.target.value,
                    })
                  }
                  placeholder={t("drawer.instructionsPlaceholder")}
                  className="h-7 text-xs"
                />

                {/* MAR log — read-only; what the nurse did with each
                    dose (given / held / refused / suspended + reason). */}
                {(medAdmins[p.id]?.length ?? 0) > 0 ? (
                  <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("drawer.marLog")}
                    </span>
                    {[...(medAdmins[p.id] ?? [])]
                      .sort((a, b) =>
                        (
                          b.administered_at ??
                          b.scheduled_for ??
                          b.created_at
                        ).localeCompare(
                          a.administered_at ??
                            a.scheduled_for ??
                            a.created_at,
                        ),
                      )
                      .slice(0, 5)
                      .map((m) => (
                        <div
                          key={m.id}
                          className="flex items-start justify-between gap-2 text-[11px]"
                        >
                          <span className="flex min-w-0 items-start gap-1.5">
                            <span
                              aria-hidden
                              className="mt-1 size-1.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: MAR_STATUS_COLOR[m.status],
                              }}
                            />
                            <span className="min-w-0">
                              <span className="font-medium">
                                {t(`marStatus.${m.status}`)}
                              </span>
                              {m.notes ? (
                                <span className="text-muted-foreground">
                                  {" — "}
                                  {m.notes}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {formatDateTime(
                              m.administered_at ??
                                m.scheduled_for ??
                                m.created_at,
                              activeLocale,
                              { dateStyle: "short", timeStyle: "short" },
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("drawer.noPrescriptions")}
        </p>
      )}

      {/* New prescription — instant add on select */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rx-drug" className="text-xs">
          {t("drawer.drug")}
        </Label>
        <TermAutocomplete
          id="rx-drug"
          category="medication"
          value={rxDraft}
          onChange={setRxDraft}
          clearOnSelect
          onSelectTerm={(term: ClinicalTerm) =>
            handleAddPrescription({
              drug_name: displayTerm(term, activeLocale),
              dose: term.dose,
              route: term.route,
              frequency: term.frequency,
            })
          }
          onCommit={(label) => handleAddPrescription({ drug_name: label })}
          placeholder={t("drawer.drugPlaceholder")}
        />
      </div>
    </div>
  );
}
