"use client";

import { useState } from "react";
import { AlertTriangle, Pill } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FREQUENCY_OPTIONS,
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
  updatePrescription,
  type AddPrescriptionInput,
  type UpdatePrescriptionInput,
} from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type { Allergy, ClinicalTerm, Prescription, PrescriptionId, StaffId, VisitId } from "@/types/healthcare";

/**
 * Prescriptions — instant-added from the drug picker, refined inline per row.
 * Shows the drug-allergy warning banner above the list.
 */
export function PrescriptionsPanel({
  visitId,
  recorderId,
  prescriptions,
  allergies,
  noKnownAllergies,
  resetKey,
  onMutated,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  prescriptions: Prescription[];
  allergies: Allergy[];
  noKnownAllergies: boolean;
  resetKey: string;
  onMutated: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [rxDraft, setRxDraft] = useState("");

  // Reset the draft on drawer open / after a save.
  useFormReset(resetKey, () => setRxDraft(""));

  const allergyState = allergyDisplayState(noKnownAllergies, allergies.length);
  const drugAllergies = sortAllergiesBySeverity(allergies).filter(
    (a) => a.category === "drug",
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
      <datalist id="frequency-options">
        {FREQUENCY_OPTIONS.map((f) => (
          <option key={f} value={f} />
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
                  {token === "muted" ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 gap-1 border-transparent text-[10px] uppercase"
                    >
                      {t(PRESCRIPTION_STATUS_LABEL[p.status])}
                    </Badge>
                  ) : (
                    <StatusBadge tone={token} variant="solid" className="shrink-0">
                      {t(PRESCRIPTION_STATUS_LABEL[p.status])}
                    </StatusBadge>
                  )}
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
                  <Input
                    key={`freq:${p.frequency ?? ""}`}
                    list="frequency-options"
                    defaultValue={p.frequency ?? ""}
                    onBlur={(e) =>
                      handleUpdatePrescription(p.id, {
                        frequency: e.target.value,
                      })
                    }
                    placeholder={t("drawer.frequencyPlaceholder")}
                    className="h-7 text-xs"
                  />
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
