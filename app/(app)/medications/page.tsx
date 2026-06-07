"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DoorOpen,
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
import { useT, type TFunction } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import type {
  MarStatus,
  MedicationAdministration,
  Prescription,
} from "@/types/healthcare";

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
const MAR_ACTIONS: MarStatus[] = ["given", "held", "refused"];

/** Where the dose is administered: a ward bed vs. an outpatient/ED encounter. */
type CareSetting = "inpatient" | "ambulatory";

interface MarRow {
  prescription: Prescription;
  patientName: string;
  mrn: string;
  isAnonymous: boolean;
  unit: string;
  setting: CareSetting;
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

interface Placement {
  unit: string;
  setting: CareSetting;
}

/**
 * A patient is inpatient only while an active admission holds a bed; everyone
 * else (clinic, ED, observation without a bed) is ambulatory and grouped by
 * their department instead of a ward.
 */
function placeVisit(visitId: string, t: TFunction): Placement {
  const admission = getAdmissionForVisit(visitId);
  if (admission?.status === "active" && admission.bed_id) {
    const bed = getBedById(admission.bed_id);
    const ward = bed ? getWardById(bed.ward_id) : undefined;
    if (ward) return { unit: ward.name, setting: "inpatient" };
  }
  const visit = getVisitById(visitId);
  if (visit?.department_id) {
    const dept = getDepartmentById(visit.department_id);
    if (dept) return { unit: dept.name, setting: "ambulatory" };
  }
  return { unit: t("meds.unassigned"), setting: "ambulatory" };
}

function load(now: number, t: TFunction): MarRow[] {
  return getActivePrescriptions()
    .map((prescription) => {
      const visit = getVisitById(prescription.visit_id);
      const patient = visit ? getPatientById(visit.patient_id) : null;
      const isAnonymous = patient?.is_emergency_anonymous ?? false;
      const administrations = getMedicationAdministrationsForPrescription(
        prescription.id,
      );
      const place = placeVisit(prescription.visit_id, t);
      return {
        prescription,
        patientName: patient
          ? isAnonymous && patient.anonymous_identifier
            ? patient.anonymous_identifier
            : patient.full_name
          : t("meds.unknownPatient"),
        mrn: patient?.mrn || "—",
        isAnonymous,
        unit: place.unit,
        setting: place.setting,
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

function relativeToNow(iso: string, now: number, t: TFunction): string {
  const diffMin = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const span =
    abs < 60
      ? `${abs}m`
      : abs < 1440
        ? `${Math.round(abs / 60)}h`
        : `${Math.round(abs / 1440)}d`;
  if (diffMin <= 0) return t("meds.agoSpan", { span });
  return t("meds.inSpan", { span });
}

function WorklistCard({
  row,
  now,
  onRecord,
}: {
  row: MarRow;
  now: number;
  onRecord: (
    prescriptionId: string,
    status: MarStatus,
    due: string | null,
  ) => void;
}) {
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const { prescription: p, dose } = row;
  const token = DOSE_STATE_TOKEN[dose.state];
  const detail = [p.dose, p.route, p.frequency].filter(Boolean).join(" · ");
  const lastAdmin = row.administrations[0];

  return (
    <Card>
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
                  {t(`doseState.${dose.state}`)}
                </Badge>
                {dose.nextDueAt ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {dose.state === "upcoming" ? t("meds.duePrefix") : ""}
                    {relativeToNow(dose.nextDueAt, now, t)}
                  </span>
                ) : null}
              </div>
              {detail ? (
                <span className="text-xs text-muted-foreground">{detail}</span>
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
                  {lastAdmin.administered_at
                    ? t("meds.lastWithTime", {
                        status: t(`marStatus.${lastAdmin.status}`),
                        time: formatDateTime(lastAdmin.administered_at, activeLocale),
                      })
                    : t("meds.last", { status: t(`marStatus.${lastAdmin.status}`) })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {MAR_ACTIONS.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={status === "given" ? "default" : "outline"}
                onClick={() => onRecord(p.id, status, dose.nextDueAt)}
              >
                {t(`marStatus.${status}`)}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MedicationsPage() {
  const { actingStaff } = useRole();
  const { t } = useT();
  const [rows, setRows] = useState<MarRow[] | null>(null);
  // `now` is captured per render-cycle so dose math is stable within a refresh.
  const [now, setNow] = useState(() => Date.now());

  function refresh() {
    const ts = Date.now();
    setNow(ts);
    setRows(load(ts, t));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  function handleRecord(
    prescriptionId: string,
    status: MarStatus,
    due: string | null,
  ) {
    recordMedicationAdministration(prescriptionId, {
      administered_by_id: actingStaff?.id ?? null,
      status,
      scheduled_for: due,
    });
    refresh();
  }

  const inpatient = rows?.filter((r) => r.setting === "inpatient") ?? [];
  const ambulatory = rows?.filter((r) => r.setting === "ambulatory") ?? [];
  // Shift handover is a ward concept — only inpatient doses are handed over.
  const summaries = summarize(inpatient);
  const overdue = rows?.filter((r) => r.dose.state === "overdue").length ?? 0;
  const due = rows?.filter((r) => r.dose.state === "due").length ?? 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("meds.title")}
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {t("meds.overdueDueNow", { overdue, due })}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("meds.subtitle")}
        </p>
      </header>

      {/* Shift-handover summary — outstanding inpatient meds per ward */}
      {inpatient.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {t("meds.shiftHandover")}
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((s) => (
              <Card key={s.unit}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <span className="truncate text-sm font-medium">{s.unit}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {t("meds.active", { count: s.total })}
                    </span>
                    {s.overdue > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: "var(--status-treatment)" }}
                      >
                        <AlertTriangle className="size-3" />
                        {t("meds.overdue", { count: s.overdue })}
                      </span>
                    ) : null}
                    {s.due > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: "var(--status-boarding)" }}
                      >
                        <Clock className="size-3" />
                        {t("meds.due", { count: s.due })}
                      </span>
                    ) : null}
                    {s.overdue === 0 && s.due === 0 ? (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ color: "var(--status-clearance)" }}
                      >
                        <CheckCircle2 className="size-3" />
                        {t("meds.clear")}
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Worklist — split by care setting */}
      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("meds.loading")}</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Pill className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("meds.noActive")}</p>
            <p className="text-xs text-muted-foreground">
              {t("meds.noActiveHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {inpatient.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BedDouble className="size-4 text-muted-foreground" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("meds.inpatientByWard")}
                </h2>
                <span className="text-[11px] tabular-nums text-muted-foreground/70">
                  {inpatient.length}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {inpatient.map((row) => (
                  <WorklistCard
                    key={row.prescription.id}
                    row={row}
                    now={now}
                    onRecord={handleRecord}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {ambulatory.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <DoorOpen className="size-4 text-muted-foreground" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("meds.outpatientEd")}
                </h2>
                <span className="text-[11px] tabular-nums text-muted-foreground/70">
                  {ambulatory.length}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {ambulatory.map((row) => (
                  <WorklistCard
                    key={row.prescription.id}
                    row={row}
                    now={now}
                    onRecord={handleRecord}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
