"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TermAutocomplete } from "@/components/clinical-terms/term-autocomplete";
import { addDiagnosis } from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type { ClinicalTerm, StaffId, VisitId } from "@careflow/shared";

/** Structured diagnosis entry (description + ICD-10 code + primary flag). */
export function DiagnosisForm({
  visitId,
  recorderId,
  resetKey,
  onSaved,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  resetKey: string;
  onSaved: () => void;
}) {
  const { t } = useT();

  const [dxCode, setDxCode] = useState("");
  const [dxDescription, setDxDescription] = useState("");
  const [dxPrimary, setDxPrimary] = useState(false);

  // Reset the drafts on drawer open / after a save.
  useFormReset(resetKey, () => {
    setDxCode("");
    setDxDescription("");
    setDxPrimary(false);
  });

  function handleAddDiagnosis() {
    if (!dxDescription.trim()) return;
    addDiagnosis(visitId, {
      diagnosed_by_id: recorderId,
      icd10_code: dxCode,
      description: dxDescription,
      is_primary: dxPrimary,
    });
    onSaved();
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{t("drawer.addDiagnosis")}</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dx-desc" className="text-xs">
          {t("drawer.description")}
        </Label>
        <TermAutocomplete
          id="dx-desc"
          category="assessment"
          value={dxDescription}
          onChange={setDxDescription}
          onSelectTerm={(term: ClinicalTerm) => {
            if (term.icd10) setDxCode(term.icd10);
          }}
          placeholder={t("drawer.diagnosisDescPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dx-code" className="text-xs">
          {t("drawer.icd10Code")}
        </Label>
        <Input
          id="dx-code"
          value={dxCode}
          onChange={(e) => setDxCode(e.target.value)}
          placeholder={t("drawer.icd10Placeholder")}
          className="font-mono"
        />
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3">
        <span className="text-sm">{t("drawer.primaryDiagnosis")}</span>
        <Switch checked={dxPrimary} onCheckedChange={setDxPrimary} />
      </label>
      <Button
        variant="outline"
        onClick={handleAddDiagnosis}
        disabled={!dxDescription.trim()}
        className="self-end"
      >
        <Plus className="size-4" />
        {t("drawer.addDiagnosis")}
      </Button>
    </div>
  );
}
