"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ShieldAlert,
  ClipboardList,
  Stethoscope,
  Merge,
  ArrowRight,
  CheckCircle2,
  Lock,
  FileText,
  FlaskConical,
  AlertTriangle,
  Plus,
  Home,
  BedDouble,
  Eye,
  Send,
  Pill,
  ArrowLeftRight,
  ChevronDown,
  FileDown,
  HeartHandshake,
  HeartOff,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAdmissionForVisit,
  getAllergiesForPatient,
  getBedById,
  getBeds,
  getCarePlanEntriesForAdmission,
  getCarePlanItemsForAdmission,
  getConsultationsForVisit,
  getDepartmentById,
  getDiagnosesForVisit,
  getOrdersForVisit,
  getResultsForVisit,
  getPatientById,
  getPatients,
  getPrescriptionsForVisit,
  getStaff,
  getStaffById,
  getTransfersForAdmission,
  getTreatmentRecordsForVisit,
  getVisitById,
  getWards,
  addConsultation,
  addDiagnosis,
  addOrder,
  addPrescription,
  updateOrder,
  updatePrescription,
  type AddPrescriptionInput,
  type UpdateOrderInput,
  type UpdatePrescriptionInput,
  addTreatmentLog,
  recordDisposition,
  recordDeath,
  transferAdmission,
  updateAdmissionClearances,
  updateVisitStage,
  evaluateDischargeReadiness,
  reconcileAnonymousProfile,
  type Disposition,
} from "@/services/mockStorage";
import { nextStage, stageLabel, tokenForStage } from "@/components/live-board/stages";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TOKEN,
  ORDER_TYPE_LABEL,
} from "@/components/diagnostics/orders";
import { ResultAttachment } from "@/components/diagnostics/result-attachment";
import {
  FREQUENCY_OPTIONS,
  PRESCRIPTION_STATUS_LABEL,
  PRESCRIPTION_STATUS_TOKEN,
  ROUTE_OPTIONS,
} from "@/components/medications/prescriptions";
import {
  TermAutocomplete,
  TermChips,
} from "@/components/clinical-terms/term-autocomplete";
import { displayTerm } from "@/lib/clinical-terms/search";
import {
  ALLERGY_CATEGORY_LABEL,
  ALLERGY_SEVERITY_LABEL,
  ALLERGY_SEVERITY_TOKEN,
  allergyDisplayState,
  highestSeverity,
  sortAllergiesBySeverity,
} from "@/components/allergies/allergies";
import {
  CARE_NEED_CATEGORY_ICON,
  CARE_NEED_CATEGORY_LABEL,
} from "@/components/care-plans/care-plans";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/role-provider";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import {
  buildVisitSummary,
  buildPatientHistory,
} from "@/components/reports/visit-summary";
import type {
  Admission,
  Allergy,
  Bed,
  CarePlanEntry,
  CarePlanItem,
  ClinicalTerm,
  Consultation,
  Diagnosis,
  Order,
  OrderId,
  OrderType,
  Patient,
  Prescription,
  PrescriptionId,
  Result,
  StaffRole,
  Transfer,
  TreatmentRecord,
  Visit,
  Ward,
} from "@/types/healthcare";

const DISPOSITIONS: {
  value: Disposition;
  labelKey: string;
  icon: typeof Home;
}[] = [
  { value: "discharge_home", labelKey: "drawer.dispositionDischargeHome", icon: Home },
  { value: "admit", labelKey: "drawer.dispositionAdmit", icon: BedDouble },
  { value: "observation", labelKey: "drawer.dispositionObservation", icon: Eye },
  { value: "refer", labelKey: "drawer.dispositionRefer", icon: Send },
];

const NO_BED = "__none__";
const NO_DOCTOR = "__none__";

const CLEARANCE_FIELDS = [
  { key: "is_medical_cleared", labelKey: "drawer.clearanceMedical" },
  { key: "is_financial_cleared", labelKey: "drawer.clearanceFinancial" },
  { key: "is_pharmacy_ready", labelKey: "drawer.clearancePharmacy" },
] as const;

type NumField = "" | string;

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
  | "history";

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
};

const PRIMARY_BY_ROLE: Partial<Record<StaffRole, SectionKey[]>> = {
  // Doctor: assess, order, prescribe — then move the visit forward.
  doctor: ["doctor", "careStage"],
  // Nurse: record vitals/GCS and advance the journey.
  nurse: ["vitals", "careStage"],
  // Reception: match an emergency record, place the patient, move it forward.
  receptionist: ["reconcile", "placement", "careStage"],
};

export function PatientDrawer({
  visitId,
  open,
  onOpenChange,
  onMutate,
}: {
  visitId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: () => void;
}) {
  const { actingStaff, actingRole } = useRole();
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [tick, setTick] = useState(0);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<TreatmentRecord[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [verified, setVerified] = useState<Patient[]>([]);
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [location, setLocation] = useState<string | null>(null);

  // Placement & transfers (inpatient admissions)
  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // Read-only nursing care-plan summary (inpatient admissions only)
  const [carePlanItems, setCarePlanItems] = useState<CarePlanItem[]>([]);
  const [carePlanEntries, setCarePlanEntries] = useState<CarePlanEntry[]>([]);
  const [transferBedId, setTransferBedId] = useState<string>(NO_BED);
  const [transferDoctorId, setTransferDoctorId] = useState<string>(NO_DOCTOR);
  const [transferReason, setTransferReason] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  // Plain-language confirmation of the last completed move ("Moved to … · …").
  const [transferDone, setTransferDone] = useState<string | null>(null);
  // Discharge is a closing action, so it's gated behind an explicit confirm step
  // that states the outcome before the visit drops off the board.
  const [confirmingDischarge, setConfirmingDischarge] = useState(false);
  // Recording a death is a closing action too — confirm-gated, with an optional
  // note for cause/circumstances. Exempt from the discharge clearance gates.
  const [confirmingDeath, setConfirmingDeath] = useState(false);
  const [deathNote, setDeathNote] = useState("");

  // SOAP consultation form
  const [subjective, setSubjective] = useState("");
  const [examination, setExamination] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");

  // Structured diagnosis form
  const [dxCode, setDxCode] = useState("");
  const [dxDescription, setDxDescription] = useState("");
  const [dxPrimary, setDxPrimary] = useState(false);

  // Diagnostic orders + their results. Tests are instant-added from the term
  // picker below the list, then refined inline on each row.
  const [orders, setOrders] = useState<Order[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [orderDraft, setOrderDraft] = useState("");

  // Prescriptions — instant-added from the drug picker, refined inline per row.
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [rxDraft, setRxDraft] = useState("");

  // Vitals / GCS / notes form
  const [spo2, setSpo2] = useState<NumField>("");
  const [sys, setSys] = useState<NumField>("");
  const [dia, setDia] = useState<NumField>("");
  const [pulse, setPulse] = useState<NumField>("");
  const [temp, setTemp] = useState<NumField>("");
  const [weight, setWeight] = useState<NumField>("");
  const [gcs, setGcs] = useState<NumField>("");
  const [notes, setNotes] = useState("");
  const [reconcileTarget, setReconcileTarget] = useState("");
  const [showMore, setShowMore] = useState(false);

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

  useEffect(() => {
    if (!open || !visitId) return;
    const v = getVisitById(visitId);
    if (!v) return;
    const adm = getAdmissionForVisit(visitId) ?? null;
    setVisit(v);
    setAdmission(adm);
    setPatient(getPatientById(v.patient_id) ?? null);
    setRecords(getTreatmentRecordsForVisit(visitId));
    setConsultations(getConsultationsForVisit(visitId));
    setDiagnoses(getDiagnosesForVisit(visitId));
    setOrders(getOrdersForVisit(visitId));
    setResults(getResultsForVisit(visitId));
    setPrescriptions(getPrescriptionsForVisit(visitId));
    setAllergies(getAllergiesForPatient(v.patient_id));
    setWards(getWards());
    setBeds(getBeds());
    setTransfers(adm ? getTransfersForAdmission(adm.id) : []);
    setCarePlanItems(adm ? getCarePlanItemsForAdmission(adm.id) : []);
    setCarePlanEntries(adm ? getCarePlanEntriesForAdmission(adm.id) : []);
    setTransferBedId(adm?.bed_id ?? NO_BED);
    setTransferDoctorId(adm?.attending_doctor_id ?? NO_DOCTOR);
    setTransferReason("");
    setTransferError(null);
    setVerified(
      getPatients().filter(
        (p) => !p.is_emergency_anonymous && p.id !== v.patient_id,
      ),
    );
    setLocation(
      adm?.bed_id
        ? (getBedById(adm.bed_id)?.label ?? null)
        : v.department_id
          ? (getDepartmentById(v.department_id)?.name ?? null)
          : null,
    );
    // Reset the log entry form on open / after a save.
    setSpo2("");
    setSys("");
    setDia("");
    setPulse("");
    setTemp("");
    setGcs("");
    setNotes("");
    setReconcileTarget("");
    setShowMore(false);
    // Reset the doctor consultation forms too.
    setSubjective("");
    setExamination("");
    setAssessment("");
    setPlan("");
    setDxCode("");
    setDxDescription("");
    setDxPrimary(false);
    setOrderDraft("");
    setRxDraft("");
  }, [open, visitId, tick]);

  // The transfer confirmation and the discharge confirm step are tied to the
  // open patient, not to each data refresh — clearing them on every `tick` would
  // wipe the confirmation the instant a transfer's refresh fires.
  useEffect(() => {
    setTransferDone(null);
    setConfirmingDischarge(false);
  }, [open, visitId]);

  if (!visit || !patient) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md" />
      </Sheet>
    );
  }

  const displayName =
    patient.is_emergency_anonymous && patient.anonymous_identifier
      ? patient.anonymous_identifier
      : patient.full_name;
  const doctorName = visit.attending_doctor_id
    ? (getStaffById(visit.attending_doctor_id)?.full_name ?? null)
    : null;

  const currentToken = tokenForStage(visit.stage);
  const target = nextStage(visit.stage, visit.visit_type);
  const readiness = admission
    ? evaluateDischargeReadiness(admission, patient)
    : { ready: true, blockers: [] as string[] };
  const advancingToDischarge = target === "discharged";
  const dischargeBlocked = advancingToDischarge && !readiness.ready;
  const isDeceased = visit.stage === "deceased";
  // A death can be recorded from any active stage (incl. on arrival), but not
  // once the visit has already closed (discharged / followed-up / deceased).
  const canRecordDeath = visit.status === "open" && !isDeceased;

  const sortedAllergies = sortAllergiesBySeverity(allergies);
  const allergyState = allergyDisplayState(
    patient.no_known_allergies,
    allergies.length,
  );
  const worstAllergy = highestSeverity(allergies);
  const drugAllergies = sortedAllergies.filter((a) => a.category === "drug");

  // Placement & transfers — lookup maps + selectable options.
  const wardById = new Map(wards.map((w) => [w.id, w]));
  const bedById = new Map(beds.map((b) => [b.id, b]));
  const doctors = getStaff().filter((s) => s.role === "doctor" && s.is_active);
  const staffById = new Map(getStaff().map((s) => [s.id, s]));
  const assignableBeds = admission
    ? beds
        .filter((b) => b.status === "free" || b.id === admission.bed_id)
        .map((b) => ({
          bed: b,
          label: `${wardById.get(b.ward_id)?.name ?? t("drawer.ward")} · ${b.label}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    : [];
  const hasBed = Boolean(admission?.bed_id);

  function bedLabel(id: string | null): string {
    if (!id) return "—";
    const b = bedById.get(id);
    if (!b) return "—";
    return `${wardById.get(b.ward_id)?.name ?? t("drawer.ward")} · ${b.label}`;
  }
  function staffName(id: string | null): string {
    return id ? (staffById.get(id)?.full_name ?? "—") : "—";
  }

  function num(v: NumField): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function refresh() {
    setTick((t) => t + 1);
    onMutate();
  }

  function handleLog() {
    const fields = {
      spo2: num(spo2),
      bp_systolic: num(sys),
      bp_diastolic: num(dia),
      pulse: num(pulse),
      temperature_c: num(temp),
      weight_kg: num(weight),
      gcs_score: num(gcs),
    };
    const hasVitals = Object.values(fields).some((v) => v !== null);
    if (!hasVitals && !notes.trim()) {
      return;
    }
    addTreatmentLog(visit!.id, {
      recorded_by_id: recorderId,
      ...fields,
      notes: notes.trim() || null,
    });
    refresh();
  }

  function handleSaveConsultation() {
    if (
      !subjective.trim() &&
      !examination.trim() &&
      !assessment.trim() &&
      !plan.trim()
    ) {
      return;
    }
    addConsultation(visit!.id, {
      doctor_id: recorderId,
      subjective,
      examination,
      assessment,
      plan,
    });
    refresh();
  }

  function handleAddDiagnosis() {
    if (!dxDescription.trim()) return;
    addDiagnosis(visit!.id, {
      diagnosed_by_id: recorderId,
      icd10_code: dxCode,
      description: dxDescription,
      is_primary: dxPrimary,
    });
    refresh();
  }

  function handleAddOrder(description: string, orderType: OrderType) {
    const label = description.trim();
    if (!label) return;
    addOrder(visit!.id, {
      ordered_by_id: recorderId,
      order_type: orderType,
      description: label,
    });
    refresh();
  }

  function handleUpdateOrder(orderId: OrderId, input: UpdateOrderInput) {
    updateOrder(orderId, input);
    refresh();
  }

  function handleAddPrescription(input: Omit<AddPrescriptionInput, "prescribed_by_id">) {
    if (!input.drug_name.trim()) return;
    addPrescription(visit!.id, { prescribed_by_id: recorderId, ...input });
    refresh();
  }

  function handleUpdatePrescription(
    prescriptionId: PrescriptionId,
    input: UpdatePrescriptionInput,
  ) {
    updatePrescription(prescriptionId, input);
    refresh();
  }

  function handleDisposition(disposition: Disposition) {
    recordDisposition(visit!.id, disposition, recorderId);
    refresh();
  }

  function handleRecordDeath() {
    recordDeath(visit!.id, recorderId, deathNote.trim() || null);
    // The visit closes and drops off the active board, like a discharge.
    onMutate();
    onOpenChange(false);
  }

  function toggleClearance(key: (typeof CLEARANCE_FIELDS)[number]["key"]) {
    if (!admission) return;
    updateAdmissionClearances(admission.id, { [key]: !admission[key] });
    refresh();
  }

  function handleAdvance() {
    if (!target) return;
    if (advancingToDischarge && !readiness.ready) return;
    updateVisitStage(visit!.id, target);
    if (advancingToDischarge) {
      // Discharged — the visit closes and drops off the active board.
      onMutate();
      onOpenChange(false);
    } else {
      refresh();
    }
  }

  function handleReconcile() {
    if (!reconcileTarget) return;
    reconcileAnonymousProfile(patient!.id, reconcileTarget);
    onMutate();
    onOpenChange(false);
  }

  function handleTransfer() {
    if (!admission) return;
    setTransferError(null);
    const currentBed = admission.bed_id ?? NO_BED;
    const currentDoctor = admission.attending_doctor_id ?? NO_DOCTOR;
    const bedChanged = transferBedId !== currentBed;
    const doctorChanged = transferDoctorId !== currentDoctor;
    if (!bedChanged && !doctorChanged) {
      setTransferError(t("drawer.transferNoChange"));
      return;
    }
    try {
      transferAdmission(admission.id, {
        ...(bedChanged
          ? { to_bed_id: transferBedId === NO_BED ? null : transferBedId }
          : {}),
        ...(doctorChanged
          ? {
              to_doctor_id:
                transferDoctorId === NO_DOCTOR ? null : transferDoctorId,
            }
          : {}),
        reason: transferReason,
        transferred_by_id: recorderId,
      });
      // Plain-language confirmation that names the new placement / doctor.
      const parts: string[] = [];
      if (bedChanged) {
        parts.push(
          transferBedId === NO_BED
            ? t("drawer.transferDoneNoBed")
            : t("drawer.transferDoneBed", {
                placement: bedLabel(transferBedId),
              }),
        );
      }
      if (doctorChanged) {
        parts.push(
          transferDoctorId === NO_DOCTOR
            ? t("drawer.transferDoneNoDoctor")
            : t("drawer.transferDoneDoctor", {
                doctor: staffName(transferDoctorId),
              }),
        );
      }
      setTransferDone(parts.join(" "));
      setTransferReason("");
      refresh();
    } catch (e) {
      setTransferError(
        e instanceof Error ? e.message : t("drawer.transferFailed"),
      );
    }
  }

  async function handleDownloadReport() {
    if (!visit) return;
    const data = buildVisitSummary(visit.id);
    if (!data) return;
    const { exportVisitSummaryPdf } = await import(
      "@/components/reports/visit-summary-export"
    );
    exportVisitSummaryPdf(data, t, activeLocale);
  }

  async function handleDownloadHistory() {
    if (!patient) return;
    const data = buildPatientHistory(patient.id);
    if (!data) return;
    const { exportPatientHistoryPdf } = await import(
      "@/components/reports/visit-summary-export"
    );
    exportPatientHistoryPdf(data, t, activeLocale);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center gap-2 pr-8">
            <SheetTitle
              className={patient.is_emergency_anonymous ? "font-mono text-sm" : ""}
            >
              {displayName}
            </SheetTitle>
            {patient.is_emergency_anonymous ? (
              <Badge
                variant="outline"
                className="gap-1 border-transparent text-[10px] uppercase"
                style={{
                  backgroundColor: "var(--status-treatment)",
                  color: "var(--status-treatment-foreground)",
                }}
              >
                <ShieldAlert className="size-3" />
                {t("drawer.emergency")}
              </Badge>
            ) : null}
          </div>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{visit.chief_complaint ?? t("drawer.noChiefComplaint")}</span>
          </SheetDescription>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{patient.mrn || "—"}</span>
            <span className="uppercase tracking-wide">{t(VISIT_TYPE_LABEL[visit.visit_type])}</span>
            {location ? <span className="font-mono">{location}</span> : null}
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
          <div style={{ order: -10 }}>
          {allergyState === "has-allergies" ? (
            <section
              className="flex flex-col gap-2 rounded-md border p-3"
              style={{
                borderColor: `var(--status-${worstAllergy ? ALLERGY_SEVERITY_TOKEN[worstAllergy] : "treatment"})`,
                backgroundColor: "color-mix(in oklab, var(--status-treatment) 8%, transparent)",
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className="size-4"
                  style={{ color: "var(--status-treatment)" }}
                />
                <h3 className="text-sm font-semibold">
                  {t("drawer.allergiesCount", { count: allergies.length })}
                </h3>
              </div>
              <ul className="flex flex-col gap-1.5">
                {sortedAllergies.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                  >
                    <Badge
                      variant="outline"
                      className="border-transparent text-[10px] uppercase"
                      style={{
                        backgroundColor: `var(--status-${ALLERGY_SEVERITY_TOKEN[a.severity]})`,
                        color: `var(--status-${ALLERGY_SEVERITY_TOKEN[a.severity]}-foreground)`,
                      }}
                    >
                      {t(ALLERGY_SEVERITY_LABEL[a.severity])}
                    </Badge>
                    <span className="font-medium">{a.substance}</span>
                    <span className="text-muted-foreground">
                      {t(ALLERGY_CATEGORY_LABEL[a.category])}
                      {a.reaction ? ` · ${a.reaction}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : allergyState === "none" ? (
            <section className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <CheckCircle2
                className="size-4"
                style={{ color: "var(--status-clearance)" }}
              />
              {t("drawer.noKnownAllergies")}
            </section>
          ) : (
            <section className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-4" />
              {t("drawer.allergiesNotAssessed")}
            </section>
          )}
          </div>

          {/* Reconciliation — anonymous patients only */}
          {patient.is_emergency_anonymous ? (
            <section
              className={secCls(
                "reconcile",
                "flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3",
              )}
              style={secStyle("reconcile")}
            >
              <div className="flex items-center gap-2">
                <Merge className="size-4" style={{ color: "var(--status-treatment)" }} />
                <h3 className="text-sm font-medium">{t("drawer.reconcileTitle")}</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("drawer.reconcileHint")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  items={Object.fromEntries(
                    verified.map((p) => [p.id, p.full_name]),
                  )}
                  value={reconcileTarget}
                  onValueChange={(v) => setReconcileTarget(v as string)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("drawer.selectVerifiedPatient")} />
                  </SelectTrigger>
                  <SelectContent>
                    {verified.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleReconcile}
                  disabled={!reconcileTarget}
                  className="shrink-0"
                >
                  {t("drawer.merge")}
                </Button>
              </div>
            </section>
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

              {/* Latest vitals — read-only, so the doctor sees the patient's
                  most recent observations (typically taken by a nurse at intake)
                  without leaving the consultation. */}
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

              <Separator />

              {/* Structured diagnosis entry */}
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

              <Separator />

              {/* Diagnostic orders & results */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t("drawer.ordersResults")}</span>
                </div>

                {orders.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {orders.map((o) => {
                      const orderResults = results.filter(
                        (r) => r.order_id === o.id,
                      );
                      const token = ORDER_STATUS_TOKEN[o.status];
                      return (
                        <li
                          key={o.id}
                          className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-sm font-medium">
                                {o.description}
                              </span>
                              <Select
                                items={Object.fromEntries(
                                  (Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map(
                                    (ot) => [ot, t(ORDER_TYPE_LABEL[ot])],
                                  ),
                                )}
                                value={o.order_type}
                                onValueChange={(v) =>
                                  handleUpdateOrder(o.id, {
                                    order_type: v as OrderType,
                                  })
                                }
                              >
                                <SelectTrigger
                                  aria-label={t("drawer.testType")}
                                  className="h-7 w-fit gap-1 text-[11px] uppercase tracking-wide"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map(
                                    (ot) => (
                                      <SelectItem key={ot} value={ot}>
                                        {t(ORDER_TYPE_LABEL[ot])}
                                      </SelectItem>
                                    ),
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                            <Badge
                              variant="outline"
                              className="shrink-0 gap-1 border-transparent text-[10px] uppercase"
                              style={
                                token === "muted"
                                  ? undefined
                                  : {
                                      backgroundColor: `var(--status-${token})`,
                                      color: `var(--status-${token}-foreground)`,
                                    }
                              }
                            >
                              {t(ORDER_STATUS_LABEL[o.status])}
                            </Badge>
                          </div>

                          {orderResults.map((r) => (
                            <div
                              key={r.id}
                              className="flex flex-col gap-1 rounded-md border border-border bg-background p-2.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-sm">
                                  {r.value ?? "—"}
                                  {r.reference_range ? (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      {t("drawer.refRange", { range: r.reference_range })}
                                    </span>
                                  ) : null}
                                </span>
                                {r.is_abnormal ? (
                                  <Badge
                                    variant="outline"
                                    className="shrink-0 gap-1 border-transparent text-[10px] uppercase"
                                    style={{
                                      backgroundColor: "var(--status-treatment)",
                                      color:
                                        "var(--status-treatment-foreground)",
                                    }}
                                  >
                                    <AlertTriangle className="size-3" />
                                    {t("drawer.abnormal")}
                                  </Badge>
                                ) : null}
                              </div>
                              {r.summary ? (
                                <p className="text-xs text-muted-foreground">
                                  {r.summary}
                                </p>
                              ) : null}
                              {r.attachment_path ? (
                                <ResultAttachment path={r.attachment_path} />
                              ) : null}
                            </div>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("drawer.noOrders")}
                  </p>
                )}

                {/* Add a test — instant-adds to the list above on pick. */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="order-desc" className="text-xs">
                    {t("drawer.test")}
                  </Label>
                  <TermAutocomplete
                    id="order-desc"
                    category="investigations"
                    value={orderDraft}
                    onChange={setOrderDraft}
                    clearOnSelect
                    onSelectTerm={(term: ClinicalTerm) => {
                      handleAddOrder(
                        displayTerm(term, activeLocale),
                        term.order_type ?? "lab",
                      );
                    }}
                    onCommit={(label) => handleAddOrder(label, "lab")}
                    placeholder={t("drawer.testPlaceholder")}
                  />
                </div>
              </div>

              <Separator />

              {/* Prescriptions */}
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
                            <span className="text-sm font-medium">
                              {p.drug_name}
                            </span>
                            <Badge
                              variant="outline"
                              className="shrink-0 gap-1 border-transparent text-[10px] uppercase"
                              style={
                                token === "muted"
                                  ? undefined
                                  : {
                                      backgroundColor: `var(--status-${token})`,
                                      color: `var(--status-${token}-foreground)`,
                                    }
                              }
                            >
                              {t(PRESCRIPTION_STATUS_LABEL[p.status])}
                            </Badge>
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
                    onCommit={(label) =>
                      handleAddPrescription({ drug_name: label })
                    }
                    placeholder={t("drawer.drugPlaceholder")}
                  />
                </div>
              </div>

              <Separator />

              {/* Disposition decision */}
              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium">{t("drawer.disposition")}</span>
                <p className="text-xs text-muted-foreground">
                  {t("drawer.dispositionHint")}
                </p>
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
            <section
              className={secCls("placement", "flex flex-col gap-3")}
              style={secStyle("placement")}
            >
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="size-4 text-muted-foreground" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("drawer.placementTransfers")}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.ward")}
                  </span>
                  <span>
                    {admission.ward_id
                      ? (wardById.get(admission.ward_id)?.name ?? "—")
                      : "—"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t("drawer.bed")}
                  </span>
                  <span className="font-mono">
                    {admission.bed_id
                      ? (bedById.get(admission.bed_id)?.label ?? "—")
                      : t("drawer.unassigned")}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transfer-bed" className="text-xs">
                  {t("drawer.bed")}
                </Label>
                <Select
                  items={{
                    [NO_BED]: t("drawer.noBed"),
                    ...Object.fromEntries(
                      assignableBeds.map((o) => [o.bed.id, o.label]),
                    ),
                  }}
                  value={transferBedId}
                  onValueChange={(v) => setTransferBedId(v as string)}
                >
                  <SelectTrigger id="transfer-bed" className="w-full">
                    <SelectValue placeholder={t("drawer.selectBed")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_BED}>{t("drawer.noBed")}</SelectItem>
                    {assignableBeds.map((o) => (
                      <SelectItem key={o.bed.id} value={o.bed.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transfer-doctor" className="text-xs">
                  {t("drawer.attendingDoctor")}
                </Label>
                <Select
                  items={{
                    [NO_DOCTOR]: t("drawer.unassigned"),
                    ...Object.fromEntries(
                      doctors.map((d) => [d.id, d.full_name]),
                    ),
                  }}
                  value={transferDoctorId}
                  onValueChange={(v) => setTransferDoctorId(v as string)}
                >
                  <SelectTrigger id="transfer-doctor" className="w-full">
                    <SelectValue placeholder={t("drawer.selectDoctor")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DOCTOR}>{t("drawer.unassigned")}</SelectItem>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transfer-reason" className="text-xs">
                  {t("drawer.reason")}
                </Label>
                <Input
                  id="transfer-reason"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder={t("drawer.reasonPlaceholder")}
                />
              </div>

              {transferError ? (
                <p className="text-xs text-destructive">{transferError}</p>
              ) : null}

              {transferDone ? (
                <p
                  className="flex items-start gap-1.5 text-xs"
                  style={{ color: "var(--status-clearance)" }}
                >
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  <span>{transferDone}</span>
                </p>
              ) : null}

              <Button
                onClick={() => {
                  setTransferDone(null);
                  handleTransfer();
                }}
                className="self-end"
              >
                <ArrowLeftRight className="size-4" />
                {hasBed ? t("drawer.recordTransfer") : t("drawer.assignBed")}
              </Button>

              {transfers.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("drawer.transferHistory")}
                  </span>
                  <ul className="flex flex-col gap-2">
                    {transfers.map((tr) => {
                      const lines: string[] = [];
                      if (tr.from_bed_id !== tr.to_bed_id) {
                        lines.push(
                          t("drawer.bedMove", {
                            from: bedLabel(tr.from_bed_id),
                            to: bedLabel(tr.to_bed_id),
                          }),
                        );
                      }
                      if (tr.from_doctor_id !== tr.to_doctor_id) {
                        lines.push(
                          t("drawer.doctorMove", {
                            from: staffName(tr.from_doctor_id),
                            to: staffName(tr.to_doctor_id),
                          }),
                        );
                      }
                      return (
                        <li
                          key={tr.id}
                          className="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
                        >
                          <span className="font-mono text-muted-foreground">
                            {formatDateTime(tr.created_at, activeLocale)}
                          </span>
                          {lines.map((l) => (
                            <span key={l}>{l}</span>
                          ))}
                          {tr.reason ? (
                            <span className="text-muted-foreground">
                              {tr.reason}
                            </span>
                          ) : null}
                          {tr.transferred_by_id ? (
                            <span className="text-muted-foreground">
                              {t("drawer.byStaff", {
                                name: staffName(tr.transferred_by_id),
                              })}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Care stage progression — Phase 5 verification gate */}
          <section
            className={secCls("careStage", "flex flex-col gap-3")}
            style={secStyle("careStage")}
          >
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
                      backgroundColor: "color-mix(in oklab, var(--status-treatment) 12%, transparent)",
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
                    <Label htmlFor="death-note">
                      {t("drawer.recordDeathNote")}
                    </Label>
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

          {/* Vitals + GCS log entry */}
          <section
            className={secCls("vitals", "flex flex-col gap-3")}
            style={secStyle("vitals")}
          >
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("drawer.logVitals")}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldNum label={t("drawer.vitalsSpo2")} id="spo2" value={spo2} onChange={setSpo2} />
              <FieldNum label={t("drawer.vitalsPulse")} id="pulse" value={pulse} onChange={setPulse} />
              <FieldNum label={t("drawer.vitalsSys")} id="sys" value={sys} onChange={setSys} />
              <FieldNum label={t("drawer.vitalsDia")} id="dia" value={dia} onChange={setDia} />
              <FieldNum label={t("drawer.vitalsTemp")} id="temp" value={temp} onChange={setTemp} step="0.1" />
              <FieldNum label={t("drawer.vitalsWeight")} id="weight" value={weight} onChange={setWeight} step="0.1" />
              <FieldNum label={t("drawer.vitalsGcs")} id="gcs" value={gcs} onChange={setGcs} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">{t("drawer.notes")}</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("drawer.notesPlaceholder")}
              />
            </div>
            <Button onClick={handleLog} className="self-end">
              {t("drawer.saveLog")}
            </Button>
          </section>

          {/* Nursing care plan — read-only summary (inpatient only) */}
          {admission ? (
            <section
              className={secCls("carePlan", "flex flex-col gap-3")}
              style={secStyle("carePlan")}
            >
              <div className="flex items-center gap-2">
                <HeartHandshake className="size-4 text-muted-foreground" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("carePlan.needsBlock")}
                </h3>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {carePlanItems.filter((i) => i.status === "active").length}
                </span>
              </div>
              {(() => {
                const active = carePlanItems.filter(
                  (i) => i.status === "active",
                );
                const handover =
                  carePlanEntries.find((e) => e.is_handover) ?? null;
                if (active.length === 0 && !handover) {
                  return (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {t("carePlan.noNeeds")}
                    </p>
                  );
                }
                return (
                  <div className="flex flex-col gap-2">
                    {handover ? (
                      <div
                        className="flex flex-col gap-1 rounded-md border p-3 text-xs"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--status-boarding) 40%, transparent)",
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
                    {active.map((item) => {
                      const Icon = CARE_NEED_CATEGORY_ICON[item.category];
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-2.5 rounded-md border border-border p-3 text-xs"
                        >
                          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              {t(CARE_NEED_CATEGORY_LABEL[item.category])}
                            </span>
                            <span>{item.description}</span>
                            {item.frequency ? (
                              <span className="text-muted-foreground">
                                {item.frequency}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>
          ) : null}

          {/* History */}
          <section
            className={secCls("history", "flex flex-col gap-3")}
            style={secStyle("history")}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("drawer.treatmentHistory")}
              </h3>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {records.length}
              </span>
            </div>
            {records.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t("drawer.noEntries")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {records.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">
                        {formatDateTime(r.recorded_at, activeLocale)}
                      </span>
                      {r.gcs_score !== null ? (
                        <span className="font-mono">GCS {r.gcs_score}</span>
                      ) : null}
                    </div>
                    <VitalsLine record={r} />
                    {r.notes ? <span>{r.notes}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

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

function FieldNum({
  label,
  id,
  value,
  onChange,
  step,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
    </div>
  );
}


function ConsultationNote({ consultation }: { consultation: Consultation }) {
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const rows: { label: string; value: string | null }[] = [
    { label: "S", value: consultation.subjective },
    { label: "O", value: consultation.examination },
    { label: "A", value: consultation.assessment },
    { label: "P", value: consultation.plan },
  ].filter((r) => r.value);

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="font-mono text-[11px] text-muted-foreground">
        {formatDateTime(consultation.created_at, activeLocale)}
      </span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground">{t("drawer.emptyNote")}</span>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex gap-2">
            <span className="font-mono font-semibold text-muted-foreground">
              {r.label}
            </span>
            <span>{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}

function VitalsLine({ record }: { record: TreatmentRecord }) {
  const parts: string[] = [];
  if (record.spo2 !== null) parts.push(`SpO₂ ${record.spo2}%`);
  if (record.bp_systolic !== null && record.bp_diastolic !== null)
    parts.push(`BP ${record.bp_systolic}/${record.bp_diastolic}`);
  if (record.pulse !== null) parts.push(`HR ${record.pulse}`);
  if (record.temperature_c !== null) parts.push(`${record.temperature_c}°C`);
  if (record.weight_kg != null) parts.push(`${record.weight_kg} kg`);
  if (parts.length === 0) return null;
  return <span className="font-mono text-muted-foreground">{parts.join(" · ")}</span>;
}
