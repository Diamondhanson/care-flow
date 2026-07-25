"use client";

import { useState } from "react";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TermChips } from "@/components/clinical-terms/term-autocomplete";
import { addConsultation } from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import {
  ConsultationNote,
  VitalsLine,
} from "@/components/live-board/drawer/record-views";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type { Consultation, Diagnosis, StaffId, TreatmentRecord, VisitId } from "@/types/healthcare";

/**
 * Doctor console top block: prior clinical record, latest vitals, and the
 * SOAP note entry form. Owns the four SOAP drafts locally so typing here
 * never re-renders the rest of the drawer.
 */
export function ConsultationForm({
  visitId,
  recorderId,
  diagnoses,
  consultations,
  records,
  resetKey,
  onSaved,
}: {
  visitId: VisitId;
  recorderId: StaffId | null;
  diagnoses: Diagnosis[];
  consultations: Consultation[];
  records: TreatmentRecord[];
  resetKey: string;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  // SOAP consultation form
  const [subjective, setSubjective] = useState("");
  const [examination, setExamination] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");

  // Reset the drafts on drawer open / after a save.
  useFormReset(resetKey, () => {
    setSubjective("");
    setExamination("");
    setAssessment("");
    setPlan("");
  });

  function handleSaveConsultation() {
    if (
      !subjective.trim() &&
      !examination.trim() &&
      !assessment.trim() &&
      !plan.trim()
    ) {
      return;
    }
    addConsultation(visitId, {
      doctor_id: recorderId,
      subjective,
      examination,
      assessment,
      plan,
    });
    onSaved();
  }

  return (
    <>
      {/* Prior clinical record */}
      {diagnoses.length > 0 || consultations.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("drawer.priorRecord")}
          </span>
          {diagnoses.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {diagnoses.map((d) => (
                <Badge
                  key={d.id}
                  variant={d.is_primary ? "default" : "outline"}
                  className="gap-1 text-[11px]"
                >
                  {d.icd10_code ? (
                    <span className="font-mono">{d.icd10_code}</span>
                  ) : null}
                  {d.description}
                  {d.is_primary ? (
                    <span className="opacity-70">· {t("drawer.primaryTag")}</span>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : null}
          {consultations.length > 0 ? (
            <ConsultationNote consultation={consultations[0]} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("drawer.noConsultationNote")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("drawer.noPriorRecord")}
        </p>
      )}

      {/* Latest vitals — read-only, so the doctor sees the patient's most
          recent observations (typically taken by a nurse at intake) without
          leaving the consultation. */}
      {records.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("drawer.latestVitals")}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatDateTime(records[0].recorded_at, activeLocale)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <VitalsLine record={records[0]} />
            {records[0].gcs_score !== null ? (
              <span className="shrink-0 font-mono text-xs">
                GCS {records[0].gcs_score}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* SOAP note entry */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("drawer.newConsultation")}</span>
        </div>
        <TermChips
          category="subjective"
          label={t("drawer.subjective")}
          id="soap-s"
          value={subjective}
          onValueChange={setSubjective}
          placeholder={t("drawer.subjectivePlaceholder")}
        />
        <TermChips
          category="examination"
          label={t("drawer.examination")}
          id="soap-o"
          value={examination}
          onValueChange={setExamination}
          placeholder={t("drawer.examinationPlaceholder")}
        />
        <TermChips
          category="assessment"
          label={t("drawer.assessment")}
          id="soap-a"
          value={assessment}
          onValueChange={setAssessment}
          placeholder={t("drawer.assessmentPlaceholder")}
        />
        <TermChips
          category="plan"
          label={t("drawer.plan")}
          id="soap-p"
          value={plan}
          onValueChange={setPlan}
          placeholder={t("drawer.planPlaceholder")}
        />
        <Button onClick={handleSaveConsultation} className="self-end">
          {t("drawer.saveConsultation")}
        </Button>
      </div>
    </>
  );
}
