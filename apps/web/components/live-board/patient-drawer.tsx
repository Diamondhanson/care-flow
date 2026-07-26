"use client";

import { useState } from "react";
import {
  ShieldAlert,
  Stethoscope,
  ChevronDown,
  FileDown,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { PatientName } from "@/lib/patient-name";
import {
  getStaff,
  getStaffById,
  updateAdmissionClearances,
} from "@/services/mockStorage";
import {
  usePatientDrawerData,
  useFormReset,
} from "@/components/live-board/drawer/use-drawer-data";
import { ConsultationForm } from "@/components/live-board/drawer/consultation-form";
import { DiagnosisForm } from "@/components/live-board/drawer/diagnosis-form";
import { OrdersPanel } from "@/components/live-board/drawer/orders-panel";
import { PrescriptionsPanel } from "@/components/live-board/drawer/prescriptions-panel";
import { VitalsForm } from "@/components/live-board/drawer/vitals-form";
import { TransferForm } from "@/components/live-board/drawer/transfer-form";
import {
  CareStageSection,
  DispositionGrid,
} from "@/components/live-board/drawer/discharge-panel";
import { AllergiesPanel } from "@/components/live-board/drawer/allergies-panel";
import { ReconcileSection } from "@/components/live-board/drawer/reconcile-section";
import {
  TreatmentHistorySection,
  PastVisitsSection,
} from "@/components/live-board/drawer/history-section";
import { BackgroundPanel } from "@/components/patient/background-panel";
import { CareOrders } from "@/components/care-plans/care-orders";
import {
  buildVisitSummary,
  buildPatientHistory,
} from "@/components/reports/visit-summary";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/role-provider";
import { useT, useLocale } from "@/components/locale-provider";
import type { StaffRole, VisitId } from "@careflow/shared";

const CLEARANCE_FIELDS = [
  { key: "is_medical_cleared", labelKey: "drawer.clearanceMedical" },
  { key: "is_financial_cleared", labelKey: "drawer.clearanceFinancial" },
  { key: "is_pharmacy_ready", labelKey: "drawer.clearancePharmacy" },
] as const;

/**
 * Phase 14 — role-led drawer. Each collapsible section has a stable key. The
 * sections a role *leads* with stay expanded at the top (in the listed order);
 * everything else folds under a single "More" expander so each user meets their
 * own task first without losing any capability. `careStage` is in every role's
 * lead set so the drawer always has at least one visible primary section
 * (reconcile/placement can be null for outpatient/non-anonymous visits). Roles
 * absent from this map (admin, pharmacist, lab_tech) see every section expanded.
 */
type SectionKey =
  | "reconcile"
  | "doctor"
  | "clearances"
  | "placement"
  | "careStage"
  | "vitals"
  | "carePlan"
  | "history"
  | "pastVisits";

/** Natural top-to-bottom order used for admins and for the "More" group. */
const SECTION_ORDER: Record<SectionKey, number> = {
  reconcile: 1,
  doctor: 2,
  clearances: 3,
  placement: 4,
  careStage: 5,
  vitals: 6,
  carePlan: 7,
  history: 8,
  pastVisits: 9,
};

const PRIMARY_BY_ROLE: Partial<Record<StaffRole, SectionKey[]>> = {
  // Doctor: assess, order, prescribe — then move the visit forward.
  doctor: ["doctor", "careStage"],
  // Nurse: record vitals/GCS and advance the journey.
  nurse: ["vitals", "careStage"],
  // Reception: match an emergency record, place the patient, move it forward.
  receptionist: ["reconcile", "placement", "careStage"],
};

/**
 * Orchestrator for the patient drawer. Loads the shared data snapshot
 * (`usePatientDrawerData`), owns the Sheet chrome, the role-based section
 * ordering, and the "More" expander; each section component owns its own form
 * state so typing in one field no longer re-renders the whole drawer.
 */
export function PatientDrawer({
  visitId,
  open,
  onOpenChange,
  onMutate,
}: {
  visitId: VisitId | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: () => void;
}) {
  const { actingStaff, actingRole } = useRole();
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const { data, refresh, resetKey } = usePatientDrawerData(
    open,
    visitId,
    onMutate,
  );

  const [showMore, setShowMore] = useState(false);
  // Collapse the "More" group on drawer open / after each data refresh, like
  // the previous monolithic load effect did.
  useFormReset(resetKey, () => setShowMore(false));

  // The acting staff member records the entry; fall back to a doctor so logging
  // still works before the role context has hydrated.
  const recorderId =
    actingStaff?.id ??
    getStaff().find((s) => s.role === "doctor")?.id ??
    getStaff()[0]?.id ??
    null;
  const isDoctor = actingRole === "doctor";

  // Role-led layout: the acting role's lead sections render first, expanded;
  // the rest fold under a single "More" expander. Unmapped roles (admin/
  // pharmacist/lab_tech) get `undefined` → every section stays expanded.
  const leadSections = actingRole ? PRIMARY_BY_ROLE[actingRole] : undefined;
  const collapsible = leadSections !== undefined;
  const isLead = (k: SectionKey) => !leadSections || leadSections.includes(k);
  const orderFor = (k: SectionKey) => {
    if (!leadSections) return SECTION_ORDER[k];
    const i = leadSections.indexOf(k);
    return i >= 0 ? i : 100 + SECTION_ORDER[k];
  };
  // Per-section flex `order` reorders without moving any JSX; secondary
  // sections collapse out of flow until "More" is opened.
  const secStyle = (k: SectionKey) => ({ order: orderFor(k) });
  const secCls = (k: SectionKey, base: string) =>
    cn(base, collapsible && !isLead(k) && !showMore && "hidden");

  if (!data || !data.patient) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-xl! lg:w-[45vw]! lg:max-w-none!" />
      </Sheet>
    );
  }

  const patient = data.patient;
  const { visit, admission } = data;

  const displayName =
    patient.is_emergency_anonymous && patient.anonymous_identifier
      ? patient.anonymous_identifier
      : patient.full_name;
  const doctorName = visit.attending_doctor_id
    ? (getStaffById(visit.attending_doctor_id)?.full_name ?? null)
    : null;

  function toggleClearance(key: (typeof CLEARANCE_FIELDS)[number]["key"]) {
    if (!admission) return;
    updateAdmissionClearances(admission.id, { [key]: !admission[key] });
    refresh();
  }

  /** A closing action (discharge/death) — refresh the board and shut the drawer. */
  function handleVisitClosed() {
    onMutate();
    onOpenChange(false);
  }

  async function handleDownloadReport() {
    const summary = buildVisitSummary(visit.id);
    if (!summary) return;
    const { exportVisitSummaryPdf } = await import(
      "@/components/reports/visit-summary-export"
    );
    exportVisitSummaryPdf(summary, t, activeLocale);
  }

  async function handleDownloadHistory() {
    const history = buildPatientHistory(patient.id);
    if (!history) return;
    const { exportPatientHistoryPdf } = await import(
      "@/components/reports/visit-summary-export"
    );
    exportPatientHistoryPdf(history, t, activeLocale);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* ~45% of the viewport on desktop (capped only by the viewport itself);
          tablets get a fixed comfortable width, phones stay full-bleed. The
          important modifiers out-rank the base sheet's data-[side]-scoped cap. */}
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl! lg:w-[45vw]! lg:max-w-none!">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center gap-2 pr-8">
            <SheetTitle
              className={patient.is_emergency_anonymous ? "font-mono text-sm" : ""}
            >
              <PatientName
                name={displayName}
                format={!patient.is_emergency_anonymous}
              />
            </SheetTitle>
            {patient.is_emergency_anonymous ? (
              <StatusBadge tone="treatment" variant="solid" className="gap-1">
                <ShieldAlert className="size-3" />
                {t("drawer.emergency")}
              </StatusBadge>
            ) : null}
          </div>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{visit.chief_complaint ?? t("drawer.noChiefComplaint")}</span>
          </SheetDescription>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{patient.mrn || "—"}</span>
            <span className="uppercase tracking-wide">
              {t(VISIT_TYPE_LABEL[visit.visit_type])}
            </span>
            {data.location ? (
              <span className="font-mono">{data.location}</span>
            ) : null}
            {doctorName ? (
              <span className="inline-flex items-center gap-1">
                <Stethoscope className="size-3" />
                {doctorName}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadReport}
              className="w-fit gap-2"
            >
              <FileDown className="size-4" />
              {t("visitReport.buttonLong")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadHistory}
              className="w-fit gap-2"
            >
              <FileDown className="size-4" />
              {t("visitReport.history.buttonLong")}
            </Button>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          {/* Allergy safety banner — always visible, pinned to the top */}
          <AllergiesPanel
            allergies={data.allergies}
            noKnownAllergies={patient.no_known_allergies}
          />

          {/* Background — demographics + patient-level history (Phase 21).
              For doctors it lives inside the SOAP flow (after Subjective,
              before the ROS); other roles get it pinned under the allergies
              banner, collapsed to a one-line strip. */}
          {!isDoctor ? (
            <div style={{ order: -9 }}>
              <BackgroundPanel
                patient={patient}
                recorderId={recorderId}
                canWrite={actingRole === "nurse" || actingRole === "admin"}
              />
            </div>
          ) : null}

          {/* Reconciliation — anonymous patients only */}
          {patient.is_emergency_anonymous ? (
            <ReconcileSection
              key={`reconcile-${visit.id}`}
              patient={patient}
              displayName={displayName}
              verified={data.verified}
              onDone={refresh}
              className={secCls(
                "reconcile",
                "flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3",
              )}
              style={secStyle("reconcile")}
            />
          ) : null}

          {/* Doctor consultation console — doctor role only */}
          {isDoctor ? (
            <section
              className={secCls("doctor", "flex flex-col gap-4")}
              style={secStyle("doctor")}
            >
              <div className="flex items-center gap-2">
                <Stethoscope
                  className="size-4"
                  style={{ color: "var(--status-diagnostics)" }}
                />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("drawer.doctorConsole")}
                </h3>
              </div>

              <ConsultationForm
                key={`soap-${visit.id}`}
                visit={visit}
                patient={patient}
                recorderId={recorderId}
                diagnoses={data.diagnoses}
                consultations={data.consultations}
                records={data.records}
                resetKey={resetKey}
                onSaved={refresh}
              />

              <Separator />

              <DiagnosisForm
                key={`dx-${visit.id}`}
                visitId={visit.id}
                recorderId={recorderId}
                resetKey={resetKey}
                onSaved={refresh}
              />

              <Separator />

              <OrdersPanel
                key={`orders-${visit.id}`}
                visitId={visit.id}
                recorderId={recorderId}
                orders={data.orders}
                results={data.results}
                resetKey={resetKey}
                onMutated={refresh}
              />

              <Separator />

              <PrescriptionsPanel
                key={`rx-${visit.id}`}
                visitId={visit.id}
                recorderId={recorderId}
                prescriptions={data.prescriptions}
                medAdmins={data.medAdmins}
                allergies={data.allergies}
                noKnownAllergies={patient.no_known_allergies}
                resetKey={resetKey}
                onMutated={refresh}
              />

              <Separator />

              <DispositionGrid
                key={`dispo-${visit.id}`}
                visit={visit}
                displayName={displayName}
                wards={data.wards}
                beds={data.beds}
                recorderId={recorderId}
                onMutated={refresh}
              />
            </section>
          ) : null}

          {/* Clearance gates — inpatient admissions only */}
          {admission ? (
            <section
              className={secCls("clearances", "flex flex-col gap-3")}
              style={secStyle("clearances")}
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("drawer.clearanceGates")}
              </h3>
              <div className="flex flex-col gap-2">
                {CLEARANCE_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3"
                  >
                    <span className="text-sm">{t(field.labelKey)}</span>
                    <Switch
                      checked={admission[field.key]}
                      onCheckedChange={() => toggleClearance(field.key)}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {/* Placement & transfers — inpatient admissions only */}
          {admission ? (
            <TransferForm
              key={`transfer-${visit.id}`}
              admission={admission}
              transfers={data.transfers}
              wards={data.wards}
              beds={data.beds}
              recorderId={recorderId}
              resetKey={resetKey}
              onMutated={refresh}
              className={secCls("placement", "flex flex-col gap-3")}
              style={secStyle("placement")}
            />
          ) : null}

          {/* Care stage progression — Phase 5 verification gate */}
          <CareStageSection
            key={`stage-${visit.id}`}
            visit={visit}
            admission={admission}
            patient={patient}
            displayName={displayName}
            recorderId={recorderId}
            onMutated={refresh}
            onClosed={handleVisitClosed}
            className={secCls("careStage", "flex flex-col gap-3")}
            style={secStyle("careStage")}
          />

          {/* Vitals + GCS log entry */}
          <VitalsForm
            key={`vitals-${visit.id}`}
            visitId={visit.id}
            recorderId={recorderId}
            resetKey={resetKey}
            onSaved={refresh}
            className={secCls("vitals", "flex flex-col gap-3")}
            style={secStyle("vitals")}
          />

          {/* Nursing care plan — interactive care orders (inpatient only) */}
          {admission ? (
            <section
              className={secCls("carePlan", "flex flex-col gap-3")}
              style={secStyle("carePlan")}
            >
              <CareOrders
                admissionId={admission.id}
                items={data.carePlanItems}
                entries={data.carePlanEntries}
                latestVitalsAt={data.records[0]?.recorded_at ?? null}
                actingRole={actingRole}
                recorderId={recorderId}
                onChange={refresh}
              />
            </section>
          ) : null}

          {/* History */}
          <TreatmentHistorySection
            records={data.records}
            className={secCls("history", "flex flex-col gap-3")}
            style={secStyle("history")}
          />

          {/* Cross-visit timeline — every visit on this patient's record,
              most recent first. Older visits beyond the offline cache window
              are backfilled from the server when online. */}
          <PastVisitsSection
            patientId={patient.id}
            currentVisitId={visit.id}
            patientVisits={data.patientVisits}
            className={secCls("pastVisits", "flex flex-col gap-3")}
            style={secStyle("pastVisits")}
          />

          {/* Single "More" expander holding every non-lead section for the
              acting role. Sits between the lead sections (order 0–2) and the
              folded ones (order 100+). Hidden for unmapped roles. */}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              style={{ order: 50 }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {showMore ? t("drawer.showLess") : t("drawer.showMore")}
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  showMore && "rotate-180",
                )}
              />
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
