"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ShieldAlert,
  ClipboardList,
  Stethoscope,
  Merge,
  ArrowRight,
  CheckCircle2,
  Lock,
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
  getAdmissionById,
  getPatientById,
  getPatients,
  getStaff,
  getStaffById,
  getTreatmentRecordsForAdmission,
  addTreatmentLog,
  updateAdmissionClearances,
  updateAdmissionStage,
  evaluateDischargeReadiness,
  reconcileAnonymousProfile,
} from "@/services/mockStorage";
import { nextStage, stageConfig } from "@/components/live-board/stages";
import type { Admission, Patient, TreatmentRecord, Vitals } from "@/types/healthcare";

const CLEARANCE_FIELDS = [
  { key: "is_medical_cleared", label: "Medical cleared" },
  { key: "is_financial_cleared", label: "Financial cleared" },
  { key: "is_pharmacy_ready", label: "Pharmacy ready" },
] as const;

type NumField = "" | string;

export function PatientDrawer({
  admissionId,
  open,
  onOpenChange,
  onMutate,
}: {
  admissionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<TreatmentRecord[]>([]);
  const [verified, setVerified] = useState<Patient[]>([]);

  // Vitals / GCS / notes form
  const [spo2, setSpo2] = useState<NumField>("");
  const [sys, setSys] = useState<NumField>("");
  const [dia, setDia] = useState<NumField>("");
  const [pulse, setPulse] = useState<NumField>("");
  const [temp, setTemp] = useState<NumField>("");
  const [gcs, setGcs] = useState<NumField>("");
  const [notes, setNotes] = useState("");
  const [medication, setMedication] = useState("");
  const [reconcileTarget, setReconcileTarget] = useState("");

  const recorderId = useMemo(() => {
    const doctor = getStaff().find((s) => s.role === "doctor");
    return doctor?.id ?? getStaff()[0]?.id ?? "";
  }, []);

  useEffect(() => {
    if (!open || !admissionId) return;
    const adm = getAdmissionById(admissionId);
    if (!adm) return;
    setAdmission(adm);
    setPatient(getPatientById(adm.patient_id) ?? null);
    setRecords(getTreatmentRecordsForAdmission(admissionId));
    setVerified(
      getPatients().filter(
        (p) => !p.is_emergency_anonymous && p.id !== adm.patient_id,
      ),
    );
    // Reset the log entry form on open / after a save.
    setSpo2("");
    setSys("");
    setDia("");
    setPulse("");
    setTemp("");
    setGcs("");
    setNotes("");
    setMedication("");
    setReconcileTarget("");
  }, [open, admissionId, tick]);

  if (!admission || !patient) {
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
  const doctorName = admission.attending_doctor_id
    ? (getStaffById(admission.attending_doctor_id)?.full_name ?? null)
    : null;

  const currentStage = stageConfig(admission.stage);
  const target = nextStage(admission.stage);
  const targetStage = target ? stageConfig(target) : null;
  const readiness = evaluateDischargeReadiness(admission, patient);
  const advancingToDischarge = target === "followed_up";
  const dischargeBlocked = advancingToDischarge && !readiness.ready;

  function num(v: NumField): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  function refresh() {
    setTick((t) => t + 1);
    onMutate();
  }

  function handleLog() {
    const vitals: Vitals = {
      spo2: num(spo2),
      bp_systolic: num(sys),
      bp_diastolic: num(dia),
      pulse: num(pulse),
      temperature: num(temp),
    };
    const hasVitals = Object.values(vitals).some((v) => v !== undefined);
    const gcsNum = num(gcs) ?? null;
    if (!hasVitals && gcsNum === null && !notes.trim() && !medication.trim()) {
      return;
    }
    addTreatmentLog(admission!.id, {
      recorded_by_id: recorderId,
      vitals,
      gcs_score: gcsNum,
      notes: notes.trim(),
      medication: medication.trim() || null,
    });
    refresh();
  }

  function toggleClearance(key: (typeof CLEARANCE_FIELDS)[number]["key"]) {
    updateAdmissionClearances(admission!.id, { [key]: !admission![key] });
    refresh();
  }

  function handleAdvance() {
    const target = nextStage(admission!.stage);
    if (!target) return;
    if (target === "followed_up" && !readiness.ready) return;
    updateAdmissionStage(admission!.id, target);
    if (target === "followed_up") {
      // Discharged — the admission drops off the active board.
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
            <span>{admission.reason}</span>
          </SheetDescription>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            {admission.location ? (
              <span className="font-mono">{admission.location}</span>
            ) : null}
            {doctorName ? (
              <span className="inline-flex items-center gap-1">
                <Stethoscope className="size-3" />
                {doctorName}
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
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

          {/* Clearance gates */}
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

          <Separator />

          {/* Care stage progression — Phase 5 verification gate */}
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Care stage
            </h3>
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--status-${currentStage.token})` }}
              />
              <span className="text-sm font-medium">{currentStage.label}</span>
            </div>

            {target === null ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                <CheckCircle2
                  className="size-4 shrink-0"
                  style={{ color: "var(--status-clearance)" }}
                />
                Care journey complete — patient followed up.
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
                    <>Advance to {targetStage?.label}</>
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
              <Label htmlFor="medication">Medication</Label>
              <Input
                id="medication"
                value={medication}
                onChange={(e) => setMedication(e.target.value)}
                placeholder="Optional"
              />
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
                    <VitalsLine vitals={r.vitals} />
                    {r.medication ? (
                      <span className="text-muted-foreground">
                        Rx: {r.medication}
                      </span>
                    ) : null}
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

function VitalsLine({ vitals }: { vitals: Vitals }) {
  const parts: string[] = [];
  if (vitals.spo2 !== undefined) parts.push(`SpO₂ ${vitals.spo2}%`);
  if (vitals.bp_systolic !== undefined && vitals.bp_diastolic !== undefined)
    parts.push(`BP ${vitals.bp_systolic}/${vitals.bp_diastolic}`);
  if (vitals.pulse !== undefined) parts.push(`HR ${vitals.pulse}`);
  if (vitals.temperature !== undefined) parts.push(`${vitals.temperature}°C`);
  if (vitals.respiratory_rate !== undefined) parts.push(`RR ${vitals.respiratory_rate}`);
  if (parts.length === 0) return null;
  return <span className="font-mono text-muted-foreground">{parts.join(" · ")}</span>;
}
