"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TermChips } from "@/components/clinical-terms/term-autocomplete";
import {
  addConsultation,
  getRosResponsesForVisit,
} from "@/services/mockStorage";
import { BackgroundPanel } from "@/components/patient/background-panel";
import { RosReview } from "@/components/ros/ros-review";
import { compileRosNarrative } from "@/lib/ros/compile";
import {
  AI_SOAP_DRAFT_EVENT,
  mergeChipValue,
  type AiSoapDraftDetail,
} from "@/lib/ai/soap-draft";
import { VitalsTrend } from "@/components/care-plans/vitals-trend";
import { useT, useLocale } from "@/components/locale-provider";
import { ConsultationNote } from "@/components/live-board/drawer/record-views";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type {
  Consultation,
  Diagnosis,
  Patient,
  StaffId,
  TreatmentRecord,
  Visit,
} from "@careflow/shared";

/**
 * Doctor console top block: prior clinical record, the nurse's vitals trend,
 * and the SOAP note entry form with the patient Background and structured
 * Review of Systems woven into the clinical reading order (S → background →
 * ROS → O → A → P). Owns the four SOAP drafts locally so typing here never
 * re-renders the rest of the drawer.
 */
export function ConsultationForm({
  visit,
  patient,
  recorderId,
  diagnoses,
  consultations,
  records,
  resetKey,
  onSaved,
}: {
  visit: Visit;
  patient: Patient;
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

  // AI Assist hand-off (Phase 22): accepting a suggested assessment/plan
  // inserts it HERE as chips — same guard, same editability, same single
  // save path as typed text. Nothing is written until the doctor saves.
  useEffect(() => {
    function onDraft(event: Event) {
      const detail = (event as CustomEvent<AiSoapDraftDetail>).detail;
      if (!detail || detail.visitId !== visit.id) return;
      if (detail.part === "assessment") {
        setAssessment((cur) => mergeChipValue(cur, detail.text));
      } else {
        setPlan((cur) => mergeChipValue(cur, detail.text));
      }
      document
        .getElementById(detail.part === "assessment" ? "soap-a" : "soap-p")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(AI_SOAP_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(AI_SOAP_DRAFT_EVENT, onDraft);
  }, [visit.id]);

  function handleSaveConsultation() {
    // Structured ROS answers are recorded per tap (Phase 21); saving links
    // them to this consultation and stores the compiled narrative beside the
    // SOAP note. A pure-ROS encounter (no free text) is still saveable.
    const rosRows = getRosResponsesForVisit(visit.id);
    if (
      !subjective.trim() &&
      !examination.trim() &&
      !assessment.trim() &&
      !plan.trim() &&
      rosRows.length === 0
    ) {
      return;
    }
    addConsultation(visit.id, {
      doctor_id: recorderId,
      subjective,
      examination,
      assessment,
      plan,
      ros_summary:
        rosRows.length > 0 ? compileRosNarrative(rosRows, activeLocale) : null,
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

      {/* Vitals trend — the doctor sees how the nurse's observations are
          changing over time, with out-of-range values highlighted. */}
      <VitalsTrend records={records} />

      {/* SOAP note entry. On the wide drawer the note fills a two-column
          grid: S and the ROS block span full width (they carry the most
          content), examination/assessment pair up, plan closes full
          width — top-to-bottom still reads S → ROS → O → A → P. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex items-center gap-2 lg:col-span-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("drawer.newConsultation")}</span>
        </div>
        <div className="lg:col-span-2">
          <TermChips
            category="subjective"
            label={t("drawer.subjective")}
            id="soap-s"
            value={subjective}
            onValueChange={setSubjective}
            placeholder={t("drawer.subjectivePlaceholder")}
          />
        </div>
        {/* Patient background between S and the ROS — the clinical
            reading order: what they report, who they are, then the
            systems review. */}
        <div className="lg:col-span-2">
          <BackgroundPanel patient={patient} recorderId={recorderId} canWrite />
        </div>
        {/* Structured Review of Systems (Phase 21) — complaint-driven,
            tap-first; every answer persists immediately. */}
        <div className="lg:col-span-2">
          <RosReview
            visitId={visit.id}
            chiefComplaint={visit.chief_complaint}
            patientSex={patient.sex}
            recorderId={recorderId}
          />
        </div>
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
        <div className="lg:col-span-2">
          <TermChips
            category="plan"
            label={t("drawer.plan")}
            id="soap-p"
            value={plan}
            onValueChange={setPlan}
            placeholder={t("drawer.planPlaceholder")}
          />
        </div>
        <Button
          onClick={handleSaveConsultation}
          className="self-end justify-self-end lg:col-span-2"
        >
          {t("drawer.saveConsultation")}
        </Button>
      </div>
    </>
  );
}
