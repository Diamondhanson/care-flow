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
  addTreatmentLog,
  recordDisposition,
  transferAdmission,
  updateAdmissionClearances,
  updateVisitStage,
  evaluateDischargeReadiness,
  reconcileAnonymousProfile,
  type Disposition,
} from "@/services/mockStorage";
import { nextStage, stageLabel, tokenForStage } from "@/components/live-board/stages";
import {
  COMMON_ORDERS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TOKEN,
  ORDER_TYPE_LABEL,
} from "@/components/diagnostics/orders";
import {
  COMMON_DRUGS,
  FREQUENCY_OPTIONS,
  PRESCRIPTION_STATUS_LABEL,
  PRESCRIPTION_STATUS_TOKEN,
  ROUTE_OPTIONS,
} from "@/components/medications/prescriptions";
import {
  ALLERGY_CATEGORY_LABEL,
  ALLERGY_SEVERITY_LABEL,
  ALLERGY_SEVERITY_TOKEN,
  allergyDisplayState,
  highestSeverity,
  sortAllergiesBySeverity,
} from "@/components/allergies/allergies";
import { useRole } from "@/components/role-provider";
import type {
  Admission,
  Allergy,
  Bed,
  Consultation,
  Diagnosis,
  Order,
  OrderType,
  Patient,
  Prescription,
  Result,
  Transfer,
  TreatmentRecord,
  Visit,
  Ward,
} from "@/types/healthcare";

/** Lightweight ICD-10 quick-pick suggestions surfaced via a native datalist. */
const COMMON_ICD10: { code: string; label: string }[] = [
  { code: "E11.9", label: "Type 2 diabetes mellitus without complications" },
  { code: "I10", label: "Essential (primary) hypertension" },
  { code: "J18.9", label: "Pneumonia, unspecified organism" },
  { code: "J45.909", label: "Unspecified asthma, uncomplicated" },
  { code: "A09", label: "Infectious gastroenteritis and colitis" },
  { code: "B54", label: "Unspecified malaria" },
  { code: "N39.0", label: "Urinary tract infection, site not specified" },
  { code: "S06.9", label: "Intracranial injury, unspecified" },
  { code: "R07.9", label: "Chest pain, unspecified" },
  { code: "K35.80", label: "Unspecified acute appendicitis" },
];

const DISPOSITIONS: {
  value: Disposition;
  label: string;
  icon: typeof Home;
}[] = [
  { value: "discharge_home", label: "Discharge home", icon: Home },
  { value: "admit", label: "Admit", icon: BedDouble },
  { value: "observation", label: "Observation", icon: Eye },
  { value: "refer", label: "Refer", icon: Send },
];

const NO_BED = "__none__";
const NO_DOCTOR = "__none__";

const CLEARANCE_FIELDS = [
  { key: "is_medical_cleared", label: "Medical cleared" },
  { key: "is_financial_cleared", label: "Financial cleared" },
  { key: "is_pharmacy_ready", label: "Pharmacy ready" },
] as const;

type NumField = "" | string;

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
  const [transferBedId, setTransferBedId] = useState<string>(NO_BED);
  const [transferDoctorId, setTransferDoctorId] = useState<string>(NO_DOCTOR);
  const [transferReason, setTransferReason] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);

  // SOAP consultation form
  const [subjective, setSubjective] = useState("");
  const [examination, setExamination] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");

  // Structured diagnosis form
  const [dxCode, setDxCode] = useState("");
  const [dxDescription, setDxDescription] = useState("");
  const [dxPrimary, setDxPrimary] = useState(false);

  // Diagnostic orders + their results
  const [orders, setOrders] = useState<Order[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("lab");
  const [orderDescription, setOrderDescription] = useState("");

  // Prescriptions
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [rxDrug, setRxDrug] = useState("");
  const [rxDose, setRxDose] = useState("");
  const [rxRoute, setRxRoute] = useState("");
  const [rxFrequency, setRxFrequency] = useState("");
  const [rxDuration, setRxDuration] = useState("");
  const [rxInstructions, setRxInstructions] = useState("");

  // Vitals / GCS / notes form
  const [spo2, setSpo2] = useState<NumField>("");
  const [sys, setSys] = useState<NumField>("");
  const [dia, setDia] = useState<NumField>("");
  const [pulse, setPulse] = useState<NumField>("");
  const [temp, setTemp] = useState<NumField>("");
  const [gcs, setGcs] = useState<NumField>("");
  const [notes, setNotes] = useState("");
  const [reconcileTarget, setReconcileTarget] = useState("");

  // The acting staff member records the entry; fall back to a doctor so logging
  // still works before the role context has hydrated.
  const recorderId =
    actingStaff?.id ??
    getStaff().find((s) => s.role === "doctor")?.id ??
    getStaff()[0]?.id ??
    null;
  const isDoctor = actingRole === "doctor";

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
    // Reset the doctor consultation forms too.
    setSubjective("");
    setExamination("");
    setAssessment("");
    setPlan("");
    setDxCode("");
    setDxDescription("");
    setDxPrimary(false);
    setOrderType("lab");
    setOrderDescription("");
    setRxDrug("");
    setRxDose("");
    setRxRoute("");
    setRxFrequency("");
    setRxDuration("");
    setRxInstructions("");
  }, [open, visitId, tick]);

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
          label: `${wardById.get(b.ward_id)?.name ?? "Ward"} · ${b.label}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    : [];
  const hasBed = Boolean(admission?.bed_id);

  function bedLabel(id: string | null): string {
    if (!id) return "—";
    const b = bedById.get(id);
    if (!b) return "—";
    return `${wardById.get(b.ward_id)?.name ?? "Ward"} · ${b.label}`;
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

  function handleAddOrder() {
    if (!orderDescription.trim()) return;
    addOrder(visit!.id, {
      ordered_by_id: recorderId,
      order_type: orderType,
      description: orderDescription,
    });
    refresh();
  }

  function handleAddPrescription() {
    if (!rxDrug.trim()) return;
    addPrescription(visit!.id, {
      prescribed_by_id: recorderId,
      drug_name: rxDrug,
      dose: rxDose,
      route: rxRoute,
      frequency: rxFrequency,
      duration: rxDuration,
      instructions: rxInstructions,
    });
    refresh();
  }

  function handleDisposition(disposition: Disposition) {
    recordDisposition(visit!.id, disposition, recorderId);
    refresh();
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
      setTransferError("Choose a different bed or doctor to record a move.");
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
      refresh();
    } catch (e) {
      setTransferError(
        e instanceof Error ? e.message : "Could not record the transfer.",
      );
    }
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
                Emergency
              </Badge>
            ) : null}
          </div>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{visit.chief_complaint ?? "No chief complaint recorded"}</span>
          </SheetDescription>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{patient.mrn}</span>
            <span className="uppercase tracking-wide">{visit.visit_type}</span>
            {location ? <span className="font-mono">{location}</span> : null}
            {doctorName ? (
              <span className="inline-flex items-center gap-1">
                <Stethoscope className="size-3" />
                {doctorName}
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          {/* Allergy safety banner — always visible, top of the record */}
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
                  Allergies ({allergies.length})
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
                      {ALLERGY_SEVERITY_LABEL[a.severity]}
                    </Badge>
                    <span className="font-medium">{a.substance}</span>
                    <span className="text-muted-foreground">
                      {ALLERGY_CATEGORY_LABEL[a.category]}
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
              No known allergies
            </section>
          ) : (
            <section className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-4" />
              Allergies not assessed
            </section>
          )}

          {/* Reconciliation — anonymous patients only */}
          {patient.is_emergency_anonymous ? (
            <section className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <Merge className="size-4" style={{ color: "var(--status-treatment)" }} />
                <h3 className="text-sm font-medium">Profile reconciliation</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Match this emergency record to a verified patient. Clinical logs
                are preserved and re-pointed to the merged profile.
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
                    <SelectValue placeholder="Select verified patient" />
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
                  Merge
                </Button>
              </div>
            </section>
          ) : null}

          {/* Doctor consultation console — doctor role only */}
          {isDoctor ? (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Stethoscope
                  className="size-4"
                  style={{ color: "var(--status-diagnostics)" }}
                />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Doctor console
                </h3>
              </div>

              {/* Prior clinical record */}
              {diagnoses.length > 0 || consultations.length > 0 ? (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Prior record
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
                            <span className="opacity-70">· primary</span>
                          ) : null}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {consultations.length > 0 ? (
                    <ConsultationNote consultation={consultations[0]} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No consultation note recorded yet.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No prior consultations or diagnoses on this visit.
                </p>
              )}

              {/* SOAP note entry */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">New consultation (SOAP)</span>
                </div>
                <FieldArea
                  label="Subjective"
                  id="soap-s"
                  value={subjective}
                  onChange={setSubjective}
                  placeholder="What the patient reports"
                />
                <FieldArea
                  label="Examination"
                  id="soap-o"
                  value={examination}
                  onChange={setExamination}
                  placeholder="Objective exam findings"
                />
                <FieldArea
                  label="Assessment"
                  id="soap-a"
                  value={assessment}
                  onChange={setAssessment}
                  placeholder="Clinical impression"
                />
                <FieldArea
                  label="Plan"
                  id="soap-p"
                  value={plan}
                  onChange={setPlan}
                  placeholder="Tests, treatment, follow-up"
                />
                <Button onClick={handleSaveConsultation} className="self-end">
                  Save consultation
                </Button>
              </div>

              <Separator />

              {/* Structured diagnosis entry */}
              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium">Add diagnosis</span>
                <datalist id="icd10-options">
                  {COMMON_ICD10.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </datalist>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dx-code" className="text-xs">
                    ICD-10 code
                  </Label>
                  <Input
                    id="dx-code"
                    list="icd10-options"
                    value={dxCode}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDxCode(next);
                      const match = COMMON_ICD10.find(
                        (o) => o.code.toLowerCase() === next.trim().toLowerCase(),
                      );
                      if (match && !dxDescription.trim()) {
                        setDxDescription(match.label);
                      }
                    }}
                    placeholder="e.g. J18.9"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dx-desc" className="text-xs">
                    Description
                  </Label>
                  <Input
                    id="dx-desc"
                    value={dxDescription}
                    onChange={(e) => setDxDescription(e.target.value)}
                    placeholder="Diagnosis description"
                  />
                </div>
                <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3">
                  <span className="text-sm">Primary diagnosis</span>
                  <Switch checked={dxPrimary} onCheckedChange={setDxPrimary} />
                </label>
                <Button
                  variant="outline"
                  onClick={handleAddDiagnosis}
                  disabled={!dxDescription.trim()}
                  className="self-end"
                >
                  <Plus className="size-4" />
                  Add diagnosis
                </Button>
              </div>

              <Separator />

              {/* Diagnostic orders & results */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Orders &amp; results</span>
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
                            <div className="flex min-w-0 flex-col">
                              <span className="text-sm font-medium">
                                {o.description}
                              </span>
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {ORDER_TYPE_LABEL[o.order_type]}
                              </span>
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
                              {ORDER_STATUS_LABEL[o.status]}
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
                                      (ref {r.reference_range})
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
                                    Abnormal
                                  </Badge>
                                ) : null}
                              </div>
                              {r.summary ? (
                                <p className="text-xs text-muted-foreground">
                                  {r.summary}
                                </p>
                              ) : null}
                              {r.attachment_path ? (
                                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                                  <FileText className="size-3" />
                                  {r.attachment_path}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No tests ordered on this visit yet.
                  </p>
                )}

                {/* New order */}
                <datalist id="order-options">
                  {COMMON_ORDERS[orderType].map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="order-type" className="text-xs">
                    Test type
                  </Label>
                  <Select
                    items={ORDER_TYPE_LABEL}
                    value={orderType}
                    onValueChange={(v) => {
                      setOrderType(v as OrderType);
                      setOrderDescription("");
                    }}
                  >
                    <SelectTrigger id="order-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {ORDER_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="order-desc" className="text-xs">
                    Test
                  </Label>
                  <Input
                    id="order-desc"
                    list="order-options"
                    value={orderDescription}
                    onChange={(e) => setOrderDescription(e.target.value)}
                    placeholder="e.g. Full Blood Count"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleAddOrder}
                  disabled={!orderDescription.trim()}
                  className="self-end"
                >
                  <Plus className="size-4" />
                  Order test
                </Button>
              </div>

              <Separator />

              {/* Prescriptions */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Pill className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Prescriptions</span>
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
                      <span className="font-medium">Drug allergies:</span>{" "}
                      {drugAllergies
                        .map(
                          (a) =>
                            `${a.substance} (${ALLERGY_SEVERITY_LABEL[a.severity].toLowerCase()})`,
                        )
                        .join(", ")}
                      . Review before prescribing.
                    </span>
                  </div>
                ) : allergyState === "unassessed" ? (
                  <p className="text-xs text-muted-foreground">
                    Allergies not assessed — confirm before prescribing.
                  </p>
                ) : null}

                {prescriptions.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {prescriptions.map((p) => {
                      const token = PRESCRIPTION_STATUS_TOKEN[p.status];
                      const detail = [p.dose, p.route, p.frequency, p.duration]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <li
                          key={p.id}
                          className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3"
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
                              {PRESCRIPTION_STATUS_LABEL[p.status]}
                            </Badge>
                          </div>
                          {detail ? (
                            <span className="text-xs text-muted-foreground">
                              {detail}
                            </span>
                          ) : null}
                          {p.instructions ? (
                            <span className="text-xs text-muted-foreground">
                              {p.instructions}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing prescribed on this visit yet.
                  </p>
                )}

                {/* New prescription */}
                <datalist id="drug-options">
                  {COMMON_DRUGS.map((d) => (
                    <option key={d.name} value={d.name} />
                  ))}
                </datalist>
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
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rx-drug" className="text-xs">
                    Drug
                  </Label>
                  <Input
                    id="rx-drug"
                    list="drug-options"
                    value={rxDrug}
                    onChange={(e) => {
                      const next = e.target.value;
                      setRxDrug(next);
                      const match = COMMON_DRUGS.find(
                        (d) =>
                          d.name.toLowerCase() === next.trim().toLowerCase(),
                      );
                      if (match) {
                        if (!rxDose.trim()) setRxDose(match.dose);
                        if (!rxRoute.trim()) setRxRoute(match.route);
                      }
                    }}
                    placeholder="e.g. Amoxicillin-clavulanate"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rx-dose" className="text-xs">
                      Dose
                    </Label>
                    <Input
                      id="rx-dose"
                      value={rxDose}
                      onChange={(e) => setRxDose(e.target.value)}
                      placeholder="e.g. 625 mg"
                      className="font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rx-route" className="text-xs">
                      Route
                    </Label>
                    <Input
                      id="rx-route"
                      list="route-options"
                      value={rxRoute}
                      onChange={(e) => setRxRoute(e.target.value)}
                      placeholder="e.g. oral"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rx-freq" className="text-xs">
                      Frequency
                    </Label>
                    <Input
                      id="rx-freq"
                      list="frequency-options"
                      value={rxFrequency}
                      onChange={(e) => setRxFrequency(e.target.value)}
                      placeholder="e.g. every 8 hours"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rx-dur" className="text-xs">
                      Duration
                    </Label>
                    <Input
                      id="rx-dur"
                      value={rxDuration}
                      onChange={(e) => setRxDuration(e.target.value)}
                      placeholder="e.g. 5 days"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rx-instr" className="text-xs">
                    Instructions
                  </Label>
                  <Input
                    id="rx-instr"
                    value={rxInstructions}
                    onChange={(e) => setRxInstructions(e.target.value)}
                    placeholder="Optional — e.g. take with meals"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleAddPrescription}
                  disabled={!rxDrug.trim()}
                  className="self-end"
                >
                  <Plus className="size-4" />
                  Prescribe
                </Button>
              </div>

              <Separator />

              {/* Disposition decision */}
              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium">Disposition</span>
                <p className="text-xs text-muted-foreground">
                  Decide where the patient goes next. Admit opens an inpatient
                  stay; the choice is logged to the treatment record.
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
                        {d.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {isDoctor ? <Separator /> : null}

          {/* Clearance gates — inpatient admissions only */}
          {admission ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Clearance gates
              </h3>
              <div className="flex flex-col gap-2">
                {CLEARANCE_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3"
                  >
                    <span className="text-sm">{field.label}</span>
                    <Switch
                      checked={admission[field.key]}
                      onCheckedChange={() => toggleClearance(field.key)}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {admission ? <Separator /> : null}

          {/* Placement & transfers — inpatient admissions only */}
          {admission ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="size-4 text-muted-foreground" />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Placement &amp; transfers
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Ward
                  </span>
                  <span>
                    {admission.ward_id
                      ? (wardById.get(admission.ward_id)?.name ?? "—")
                      : "—"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Bed
                  </span>
                  <span className="font-mono">
                    {admission.bed_id
                      ? (bedById.get(admission.bed_id)?.label ?? "—")
                      : "Unassigned"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transfer-bed" className="text-xs">
                  Bed
                </Label>
                <Select
                  items={{
                    [NO_BED]: "No bed",
                    ...Object.fromEntries(
                      assignableBeds.map((o) => [o.bed.id, o.label]),
                    ),
                  }}
                  value={transferBedId}
                  onValueChange={(v) => setTransferBedId(v as string)}
                >
                  <SelectTrigger id="transfer-bed" className="w-full">
                    <SelectValue placeholder="Select a bed" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_BED}>No bed</SelectItem>
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
                  Attending doctor
                </Label>
                <Select
                  items={{
                    [NO_DOCTOR]: "Unassigned",
                    ...Object.fromEntries(
                      doctors.map((d) => [d.id, d.full_name]),
                    ),
                  }}
                  value={transferDoctorId}
                  onValueChange={(v) => setTransferDoctorId(v as string)}
                >
                  <SelectTrigger id="transfer-doctor" className="w-full">
                    <SelectValue placeholder="Select a doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DOCTOR}>Unassigned</SelectItem>
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
                  Reason
                </Label>
                <Input
                  id="transfer-reason"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Optional — e.g. Step-down from ICU"
                />
              </div>

              {transferError ? (
                <p className="text-xs text-destructive">{transferError}</p>
              ) : null}

              <Button onClick={handleTransfer} className="self-end">
                <ArrowLeftRight className="size-4" />
                {hasBed ? "Record transfer" : "Assign bed"}
              </Button>

              {transfers.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Transfer history
                  </span>
                  <ul className="flex flex-col gap-2">
                    {transfers.map((t) => {
                      const lines: string[] = [];
                      if (t.from_bed_id !== t.to_bed_id) {
                        lines.push(
                          `Bed ${bedLabel(t.from_bed_id)} → ${bedLabel(t.to_bed_id)}`,
                        );
                      }
                      if (t.from_doctor_id !== t.to_doctor_id) {
                        lines.push(
                          `Doctor ${staffName(t.from_doctor_id)} → ${staffName(t.to_doctor_id)}`,
                        );
                      }
                      return (
                        <li
                          key={t.id}
                          className="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
                        >
                          <span className="font-mono text-muted-foreground">
                            {new Date(t.created_at).toLocaleString()}
                          </span>
                          {lines.map((l) => (
                            <span key={l}>{l}</span>
                          ))}
                          {t.reason ? (
                            <span className="text-muted-foreground">
                              {t.reason}
                            </span>
                          ) : null}
                          {t.transferred_by_id ? (
                            <span className="text-muted-foreground">
                              by {staffName(t.transferred_by_id)}
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

          {admission ? <Separator /> : null}

          {/* Care stage progression — Phase 5 verification gate */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Care stage
            </h3>
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--status-${currentToken})` }}
              />
              <span className="text-sm font-medium">{stageLabel(visit.stage)}</span>
            </div>

            {target === null ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                <CheckCircle2
                  className="size-4 shrink-0"
                  style={{ color: "var(--status-clearance)" }}
                />
                Care journey complete.
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
                      Discharge blocked
                    </div>
                    <ul className="flex flex-col gap-1 text-muted-foreground">
                      {readiness.blockers.map((b) => (
                        <li key={b} className="flex items-start gap-1.5">
                          <Lock className="mt-0.5 size-3 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Button
                  onClick={handleAdvance}
                  disabled={dischargeBlocked}
                  className="self-end"
                >
                  {advancingToDischarge ? (
                    <>Discharge &amp; follow up</>
                  ) : (
                    <>Advance to {stageLabel(target)}</>
                  )}
                  {dischargeBlocked ? (
                    <Lock className="size-4" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </Button>
              </>
            )}
          </section>

          <Separator />

          {/* Vitals + GCS log entry */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Log vitals & assessment
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldNum label="SpO₂ (%)" id="spo2" value={spo2} onChange={setSpo2} />
              <FieldNum label="Pulse (bpm)" id="pulse" value={pulse} onChange={setPulse} />
              <FieldNum label="BP systolic" id="sys" value={sys} onChange={setSys} />
              <FieldNum label="BP diastolic" id="dia" value={dia} onChange={setDia} />
              <FieldNum label="Temp (°C)" id="temp" value={temp} onChange={setTemp} step="0.1" />
              <FieldNum label="GCS (3–15)" id="gcs" value={gcs} onChange={setGcs} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Clinical observations"
              />
            </div>
            <Button onClick={handleLog} className="self-end">
              Save log entry
            </Button>
          </section>

          <Separator />

          {/* History */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Treatment history
              </h3>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {records.length}
              </span>
            </div>
            {records.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No entries logged yet
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
                        {new Date(r.recorded_at).toLocaleString()}
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

function FieldArea({
  label,
  id,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-16"
      />
    </div>
  );
}

function ConsultationNote({ consultation }: { consultation: Consultation }) {
  const rows: { label: string; value: string | null }[] = [
    { label: "S", value: consultation.subjective },
    { label: "O", value: consultation.examination },
    { label: "A", value: consultation.assessment },
    { label: "P", value: consultation.plan },
  ].filter((r) => r.value);

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <span className="font-mono text-[11px] text-muted-foreground">
        {new Date(consultation.created_at).toLocaleString()}
      </span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground">Empty note.</span>
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
  if (parts.length === 0) return null;
  return <span className="font-mono text-muted-foreground">{parts.join(" · ")}</span>;
}
