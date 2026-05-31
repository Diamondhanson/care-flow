"use client";

import { useEffect, useState } from "react";
import {
  ShieldAlert,
  Stethoscope,
  ClipboardList,
  Merge,
  CheckCircle2,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAnonymousVisits,
  getAdmissionForVisit,
  getBedById,
  getDepartmentById,
  getPatientById,
  getPatients,
  getStaffById,
  getTreatmentRecordsForVisit,
  reconcileAnonymousProfile,
} from "@/services/mockStorage";
import type { Patient, Visit } from "@/types/healthcare";

interface PendingRecord {
  visit: Visit;
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

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function ReconciliationPage() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});

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
        identifier:
          patient?.anonymous_identifier ?? patient?.full_name ?? "Unidentified",
        mrn: patient?.mrn ?? "—",
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

  function handleMerge(visit: Visit) {
    const targetId = targets[visit.id];
    if (!targetId) return;
    reconcileAnonymousProfile(visit.patient_id, targetId);
    setTargets((prev) => {
      const next = { ...prev };
      delete next[visit.id];
      return next;
    });
    load();
  }

  const pendingCount = data?.pending.length ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Profile Reconciliation
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {pendingCount ?? "—"} pending
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Match unidentified emergency records to a verified patient profile.
          Clinical logs are preserved and re-pointed to the merged profile.
        </p>
      </header>

      {data === null ? (
        <p className="text-sm text-muted-foreground">Loading worklist…</p>
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
              <p className="text-sm font-medium">All records reconciled</p>
              <p className="text-sm text-muted-foreground">
                No unidentified emergency profiles are awaiting a match.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.pending.map(
            ({ visit, identifier, mrn, reason, location, doctorName, recordCount, latestGcs }) => (
              <Card key={visit.id}>
                <CardContent className="flex flex-col gap-5 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                          {identifier}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {mrn}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{reason}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {location ? (
                          <span className="font-mono">{location}</span>
                        ) : null}
                        {doctorName ? (
                          <span className="inline-flex items-center gap-1">
                            <Stethoscope className="size-3" />
                            {doctorName}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <ClipboardList className="size-3" />
                          {recordCount} log{recordCount === 1 ? "" : "s"}
                        </span>
                        {latestGcs !== null ? (
                          <span className="font-mono">GCS {latestGcs}</span>
                        ) : null}
                        <span>Arrived {relativeTime(visit.arrived_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:w-32 sm:shrink-0">
                      Merge into
                    </span>
                    <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                      <Select
                        items={Object.fromEntries(
                          data.verified.map((p) => [p.id, p.full_name]),
                        )}
                        value={targets[visit.id] ?? ""}
                        onValueChange={(v) =>
                          setTargets((prev) => ({
                            ...prev,
                            [visit.id]: v as string,
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select verified patient" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.verified.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => handleMerge(visit)}
                        disabled={!targets[visit.id]}
                        className="shrink-0"
                      >
                        <Merge className="size-4" />
                        Merge
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
