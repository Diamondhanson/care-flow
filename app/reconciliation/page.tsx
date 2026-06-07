"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShieldAlert,
  Stethoscope,
  ClipboardList,
  CheckCircle2,
  Search,
  UserCheck,
  X,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getAnonymousVisits,
  getAdmissionForVisit,
  getBedById,
  getDepartmentById,
  getPatientById,
  getPatients,
  getStaffById,
  getTreatmentRecordsForVisit,
} from "@/services/mockStorage";
import {
  ReconcileDialog,
  type ReconcileTarget,
} from "@/components/reconciliation/reconcile-dialog";
import { useT, type TFunction } from "@/components/locale-provider";
import type { Patient, Visit } from "@/types/healthcare";

interface PendingRecord {
  visit: Visit;
  patientId: string;
  identifier: string;
  mrn: string;
  reason: string | null;
  location: string | null;
  doctorName: string | null;
  recordCount: number;
  latestGcs: number | null;
}

interface ReconciliationData {
  pending: PendingRecord[];
  /** Verified (non-anonymous) patients available as merge targets. */
  verified: Patient[];
}

function relativeTime(iso: string, t: TFunction): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 1) return t("reconciliation.justNow");
  if (hours < 24) return t("reconciliation.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("reconciliation.daysAgo", { count: days });
}

export default function ReconciliationPage() {
  const { t } = useT();
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReconcileTarget | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function load() {
    const pending: PendingRecord[] = getAnonymousVisits().map((visit) => {
      const patient = getPatientById(visit.patient_id);
      const records = getTreatmentRecordsForVisit(visit.id);
      const latestGcs =
        records.find((r) => r.gcs_score !== null)?.gcs_score ?? null;
      const admission = getAdmissionForVisit(visit.id);
      const location = admission?.bed_id
        ? (getBedById(admission.bed_id)?.label ?? null)
        : visit.department_id
          ? (getDepartmentById(visit.department_id)?.name ?? null)
          : null;
      return {
        visit,
        patientId: visit.patient_id,
        identifier:
          patient?.anonymous_identifier ??
          patient?.full_name ??
          t("reconciliation.unidentified"),
        mrn: patient?.mrn || "—",
        reason: visit.chief_complaint,
        location,
        doctorName: visit.attending_doctor_id
          ? (getStaffById(visit.attending_doctor_id)?.full_name ?? null)
          : null,
        recordCount: records.length,
        latestGcs,
      };
    });
    const verified = getPatients().filter((p) => !p.is_emergency_anonymous);
    setData({ pending, verified });
  }

  useEffect(() => {
    load();
  }, []);

  function handleDone(message: string) {
    setSelected(null);
    setSuccess(message);
    load();
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.pending;
    return data.pending.filter((r) =>
      [r.identifier, r.mrn, r.reason ?? "", r.location ?? ""].some((h) =>
        h.toLowerCase().includes(q),
      ),
    );
  }, [data, query]);

  const pendingCount = data?.pending.length ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("reconciliation.title")}
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {pendingCount ?? "—"} {t("reconciliation.pending")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("reconciliation.subtitle")}
        </p>
      </header>

      {success ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--status-clearance)] bg-[color-mix(in_oklab,var(--status-clearance)_10%,transparent)] px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-[var(--status-clearance)]" />
            {success}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setSuccess(null)}>
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      {data === null ? (
        <p className="text-sm text-muted-foreground">
          {t("reconciliation.loading")}
        </p>
      ) : data.pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--status-clearance) 16%, transparent)",
                color: "var(--status-clearance)",
              }}
            >
              <CheckCircle2 className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {t("reconciliation.allReconciled")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("reconciliation.allReconciledHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Search the emergency worklist. */}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reconciliation.searchPlaceholder")}
              className="pl-9"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">
              {t("reconciliation.noMatches")}
            </p>
          ) : (
            filtered.map((record) => (
              <Card key={record.visit.id}>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden
                        className="flex size-6 items-center justify-center rounded-md"
                        style={{
                          backgroundColor:
                            "color-mix(in oklab, var(--status-treatment) 18%, transparent)",
                          color: "var(--status-treatment)",
                        }}
                      >
                        <ShieldAlert className="size-3.5" />
                      </span>
                      <span className="truncate font-mono text-sm font-medium">
                        {record.identifier}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {record.mrn}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {record.reason}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {record.location ? (
                        <span className="font-mono">{record.location}</span>
                      ) : null}
                      {record.doctorName ? (
                        <span className="inline-flex items-center gap-1">
                          <Stethoscope className="size-3" />
                          {record.doctorName}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <ClipboardList className="size-3" />
                        {t(
                          record.recordCount === 1
                            ? "reconciliation.logsOne"
                            : "reconciliation.logsOther",
                          { count: record.recordCount },
                        )}
                      </span>
                      {record.latestGcs !== null ? (
                        <span className="font-mono">GCS {record.latestGcs}</span>
                      ) : null}
                      <span>
                        {t("reconciliation.arrived", {
                          time: relativeTime(record.visit.arrived_at, t),
                        })}
                      </span>
                    </div>
                  </div>

                  <Button
                    className="shrink-0"
                    onClick={() =>
                      setSelected({
                        patientId: record.patientId,
                        identifier: record.identifier,
                      })
                    }
                  >
                    <UserCheck className="size-4" />
                    {t("reconciliation.reconcile")}
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <ReconcileDialog
        target={selected}
        verified={data?.verified ?? []}
        onClose={() => setSelected(null)}
        onDone={handleDone}
      />
    </div>
  );
}
