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
  getAnonymousAdmissions,
  getPatientById,
  getPatients,
  getStaffById,
  getTreatmentRecordsForAdmission,
  reconcileAnonymousProfile,
} from "@/services/mockStorage";
import type { Admission, Patient } from "@/types/healthcare";

interface PendingRecord {
  admission: Admission;
  identifier: string;
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
    const pending: PendingRecord[] = getAnonymousAdmissions().map((admission) => {
      const patient = getPatientById(admission.patient_id);
      const records = getTreatmentRecordsForAdmission(admission.id);
      const latestGcs =
        records.find((r) => r.gcs_score !== null)?.gcs_score ?? null;
      return {
        admission,
        identifier:
          patient?.anonymous_identifier ?? patient?.full_name ?? "Unidentified",
        doctorName: admission.attending_doctor_id
          ? (getStaffById(admission.attending_doctor_id)?.full_name ?? null)
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

  function handleMerge(admission: Admission) {
    const targetId = targets[admission.id];
    if (!targetId) return;
    reconcileAnonymousProfile(admission.patient_id, targetId);
    setTargets((prev) => {
      const next = { ...prev };
      delete next[admission.id];
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
            ({ admission, identifier, doctorName, recordCount, latestGcs }) => (
              <Card key={admission.id}>
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
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {admission.reason}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {admission.location ? (
                          <span className="font-mono">{admission.location}</span>
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
                        <span>Admitted {relativeTime(admission.admitted_at)}</span>
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
                        value={targets[admission.id] ?? ""}
                        onValueChange={(v) =>
                          setTargets((prev) => ({
                            ...prev,
                            [admission.id]: v as string,
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
                        onClick={() => handleMerge(admission)}
                        disabled={!targets[admission.id]}
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
