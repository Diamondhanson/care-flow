"use client";

import { useEffect, useState } from "react";

import {
  getActiveAdmissions,
  getPatientById,
  getStaffById,
  getTreatmentRecordsForAdmission,
} from "@/services/mockStorage";
import type { AdmissionStage } from "@/types/healthcare";
import { STAGE_CONFIG } from "@/components/live-board/stages";
import {
  PatientCard,
  type PatientCardData,
} from "@/components/live-board/patient-card";
import { PatientDrawer } from "@/components/live-board/patient-drawer";

type Columns = Record<AdmissionStage, PatientCardData[]>;

function emptyColumns(): Columns {
  return {
    boarding: [],
    treatment: [],
    discharge_planning: [],
    followed_up: [],
  };
}

function buildColumns(): Columns {
  const columns = emptyColumns();
  for (const admission of getActiveAdmissions()) {
    const patient = getPatientById(admission.patient_id);
    const doctor = admission.attending_doctor_id
      ? getStaffById(admission.attending_doctor_id)
      : undefined;
    const latestGcs =
      getTreatmentRecordsForAdmission(admission.id)[0]?.gcs_score ?? null;

    columns[admission.stage].push({
      admissionId: admission.id,
      displayName:
        patient?.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : (patient?.full_name ?? "Unknown patient"),
      isAnonymous: patient?.is_emergency_anonymous ?? false,
      location: admission.location,
      reason: admission.reason,
      attendingDoctorName: doctor?.full_name ?? null,
      gcs: latestGcs,
    });
  }
  return columns;
}

export function JourneyBoard() {
  const [columns, setColumns] = useState<Columns | null>(null);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setColumns(buildColumns());
  }, [version]);

  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
      {STAGE_CONFIG.map((stage) => {
        const cards = columns?.[stage.stage] ?? [];
        return (
          <section
            key={stage.stage}
            className="flex w-72 shrink-0 flex-col gap-3 lg:w-auto"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--status-${stage.token})` }}
              />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {stage.label}
              </h2>
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                {columns ? cards.length : "—"}
              </span>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2">
              {columns && cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  No patients
                </p>
              ) : (
                cards.map((card) => (
                  <PatientCard
                    key={card.admissionId}
                    data={card}
                    stage={stage}
                    onSelect={setSelectedId}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>

    <PatientDrawer
      admissionId={selectedId}
      open={selectedId !== null}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
      }}
      onMutate={refresh}
    />
    </>
  );
}
