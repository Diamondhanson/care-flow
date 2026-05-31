"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Pill,
  Stethoscope,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getActivePrescriptions,
  getAdmissionForVisit,
  getBedById,
  getDepartmentById,
  getMedicationAdministrationsForPrescription,
  getPatientById,
  getStaffById,
  getVisitById,
  getWardById,
  recordMedicationAdministration,
} from "@/services/mockStorage";
import {
  DOSE_STATE_ORDER,
  computeDoseStatus,
  type DoseState,
  type DoseStatus,
} from "@/components/medications/prescriptions";
import { useRole } from "@/components/role-provider";
import type {
  MarStatus,
  MedicationAdministration,
  Prescription,
} from "@/types/healthcare";

const DOSE_STATE_LABEL: Record<DoseState, string> = {
  overdue: "Overdue",
  due: "Due now",
  upcoming: "Upcoming",
  prn: "PRN",
  inactive: "Inactive",
};

const DOSE_STATE_TOKEN: Record<
  DoseState,
  "treatment" | "boarding" | "discharge" | "muted"
> = {
  overdue: "treatment",
  due: "boarding",
  upcoming: "discharge",
  prn: "muted",
  inactive: "muted",
};

/** One-tap bedside actions, in the order a nurse reaches for them. */
const MAR_ACTIONS: { status: MarStatus; label: string }[] = [
  { status: "given", label: "Given" },
  { status: "held", label: "Held" },
  { status: "refused", label: "Refused" },
];

interface MarRow {
  prescription: Prescription;
  patientName: string;
  mrn: string;
  isAnonymous: boolean;
  unit: string;
  prescribedBy: string | null;
  administrations: MedicationAdministration[];
  dose: DoseStatus;
}

interface UnitSummary {
  unit: string;
  total: number;
  overdue: number;
  due: number;
}

function unitForVisit(visitId: string): string {
  const admission = getAdmissionForVisit(visitId);
  if (admission?.bed_id) {
    const bed = getBedById(admission.bed_id);
    const ward = bed ? getWardById(bed.ward_id) : undefined;
    if (ward) return ward.name;
  }
  const visit = getVisitById(visitId);
  if (visit?.department_id) {
    const dept = getDepartmentById(visit.department_id);
    if (dept) return dept.name;
  }
  return "Unassigned";
}

function load(now: number): MarRow[] {
  return getActivePrescriptions()
    .map((prescription) => {
      const visit = getVisitById(prescription.visit_id);
      const patient = visit ? getPatientById(visit.patient_id) : null;
      const isAnonymous = patient?.is_emergency_anonymous ?? false;
      const administrations = getMedicationAdministrationsForPrescription(
        prescription.id,
      );
      return {
        prescription,
        patientName: patient
          ? isAnonymous && patient.anonymous_identifier
            ? patient.anonymous_identifier
            : patient.full_name
          : "Unknown patient",
        mrn: patient?.mrn ?? "—",
        isAnonymous,
        unit: unitForVisit(prescription.visit_id),
        prescribedBy: prescription.prescribed_by_id
          ? (getStaffById(prescription.prescribed_by_id)?.full_name ?? null)
          : null,
        administrations,
        dose: computeDoseStatus(prescription, administrations, now),
      };
    })
    .sort((a, b) => {
      const byState =
        DOSE_STATE_ORDER[a.dose.state] - DOSE_STATE_ORDER[b.dose.state];
      if (byState !== 0) return byState;
      // Within a state, the earliest due dose comes first.
      return (a.dose.nextDueAt ?? "").localeCompare(b.dose.nextDueAt ?? "");
    });
}

function summarize(rows: MarRow[]): UnitSummary[] {
  const map = new Map<string, UnitSummary>();
  for (const row of rows) {
    const entry =
      map.get(row.unit) ?? { unit: row.unit, total: 0, overdue: 0, due: 0 };
    entry.total += 1;
    if (row.dose.state === "overdue") entry.overdue += 1;
    if (row.dose.state === "due") entry.due += 1;
    map.set(row.unit, entry);
  }
  return [...map.values()].sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    if (b.due !== a.due) return b.due - a.due;
    return a.unit.localeCompare(b.unit);
  });
}

function relativeToNow(iso: string, now: number): string {
  const diffMin = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const span =
    abs < 60
      ? `${abs}m`
      : abs < 1440
        ? `${Math.round(abs / 60)}h`
        : `${Math.round(abs / 1440)}d`;
  if (diffMin <= 0) return `${span} ago`;
  return `in ${span}`;
}

export default function MedicationsPage() {
  const { actingStaff } = useRole();
  const [rows, setRows] = useState<MarRow[] | null>(null);
  // `now` is captured per render-cycle so dose math is stable within a refresh.
  const [now, setNow] = useState(() => Date.now());

  function refresh() {
    const t = Date.now();
    setNow(t);
    setRows(load(t));
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleRecord(prescriptionId: string, status: MarStatus, due: string | null) {
    recordMedicationAdministration(prescriptionId, {
      administered_by_id: actingStaff?.id ?? null,
      status,
      scheduled_for: due,
    });
    refresh();
  }

  const summaries = rows ? summarize(rows) : [];
  const overdue = rows?.filter((r) => r.dose.state === "overdue").length ?? 0;
  const due = rows?.filter((r) => r.dose.state === "due").length ?? 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Medication round
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {overdue} overdue · {due} due now
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Doses due across the active wards. Record each one as given, held or
          refused — it stamps the time and your name so the next shift knows
          exactly what was done.
        </p>
      </header>

      {/* Shift-handover summary — outstanding meds per ward */}
      {rows && rows.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Shift handover · outstanding by ward
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <Card key={s.unit}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <span className="truncate text-sm font-medium">{s.unit}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {s.total} active
                    </span>
                    {s.overdue > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: "var(--status-treatment)" }}
                      >
                        <AlertTriangle className="size-3" />
                        {s.overdue} overdue
                      </span>
                    ) : null}
                    {s.due > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: "var(--status-boarding)" }}
                      >
                        <Clock className="size-3" />
                        {s.due} due
                      </span>
                    ) : null}
                    {s.overdue === 0 && s.due === 0 ? (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ color: "var(--status-clearance)" }}
                      >
                        <CheckCircle2 className="size-3" />
                        clear
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Worklist */}
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading medications…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Pill className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No active medications</p>
            <p className="text-xs text-muted-foreground">
              No active prescriptions on the floor right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const { prescription: p, dose } = row;
            const token = DOSE_STATE_TOKEN[dose.state];
            const detail = [p.dose, p.route, p.frequency]
              .filter(Boolean)
              .join(" · ");
            const lastAdmin = row.administrations[0];
            return (
              <Card key={p.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-md"
                        style={{
                          backgroundColor:
                            "color-mix(in oklab, var(--status-diagnostics) 16%, transparent)",
                          color: "var(--status-diagnostics)",
                        }}
                      >
                        <Pill className="size-4.5" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.drug_name}</span>
                          <Badge
                            variant="outline"
                            className="gap-1 border-transparent text-[10px] uppercase"
                            style={
                              token === "muted"
                                ? undefined
                                : {
                                    backgroundColor: `var(--status-${token})`,
                                    color: `var(--status-${token}-foreground)`,
                                  }
                            }
                          >
                            {DOSE_STATE_LABEL[dose.state]}
                          </Badge>
                          {dose.nextDueAt ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {dose.state === "upcoming" ? "due " : ""}
                              {relativeToNow(dose.nextDueAt, now)}
                            </span>
                          ) : null}
                        </div>
                        {detail ? (
                          <span className="text-xs text-muted-foreground">
                            {detail}
                          </span>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span
                            className={
                              row.isAnonymous
                                ? "font-mono"
                                : "font-medium text-foreground"
                            }
                          >
                            {row.patientName}
                          </span>
                          <span className="font-mono">{row.mrn}</span>
                          <span>{row.unit}</span>
                          {row.prescribedBy ? (
                            <span className="inline-flex items-center gap-1">
                              <Stethoscope className="size-3" />
                              {row.prescribedBy}
                            </span>
                          ) : null}
                        </div>
                        {lastAdmin ? (
                          <span className="text-[11px] text-muted-foreground">
                            Last: {lastAdmin.status}
                            {lastAdmin.administered_at
                              ? ` · ${new Date(
                                  lastAdmin.administered_at,
                                ).toLocaleString()}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {MAR_ACTIONS.map((a) => (
                        <Button
                          key={a.status}
                          size="sm"
                          variant={a.status === "given" ? "default" : "outline"}
                          onClick={() =>
                            handleRecord(p.id, a.status, dose.nextDueAt)
                          }
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
