"use client";

import { useEffect, useState } from "react";

import {
  getActiveVisits,
  getAdmissionForVisit,
  getBedById,
  getDepartmentById,
  getPatientById,
  getStaffById,
  getTreatmentRecordsForVisit,
} from "@/services/mockStorage";
import { BOARD_COLUMNS, columnForStage } from "@/components/live-board/stages";
import {
  PatientCard,
  type PatientCardData,
} from "@/components/live-board/patient-card";
import { PatientDrawer } from "@/components/live-board/patient-drawer";

type Columns = Record<string, PatientCardData[]>;

function emptyColumns(): Columns {
  return Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, []]));
}

function locationLabel(visitId: string, departmentId: string | null): string | null {
  const admission = getAdmissionForVisit(visitId);
  if (admission?.bed_id) {
    return getBedById(admission.bed_id)?.label ?? null;
  }
  if (departmentId) {
    return getDepartmentById(departmentId)?.name ?? null;
  }
  return null;
}

function buildColumns(): Columns {
  const columns = emptyColumns();
  for (const visit of getActiveVisits()) {
    const column = columnForStage(visit.stage);
    if (!column) continue; // terminal stage — off the board

    const patient = getPatientById(visit.patient_id);
    const doctor = visit.attending_doctor_id
      ? getStaffById(visit.attending_doctor_id)
      : undefined;
    const latestGcs = getTreatmentRecordsForVisit(visit.id)[0]?.gcs_score ?? null;

    columns[column.key].push({
      visitId: visit.id,
      mrn: patient?.mrn ?? "—",
      displayName:
        patient?.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : (patient?.full_name ?? "Unknown patient"),
      isAnonymous: patient?.is_emergency_anonymous ?? false,
      location: locationLabel(visit.id, visit.department_id),
      reason: visit.chief_complaint,
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
      {BOARD_COLUMNS.map((column) => {
        const cards = columns?.[column.key] ?? [];
        return (
          <section
            key={column.key}
            className="flex w-72 shrink-0 flex-col gap-3 lg:w-auto"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--status-${column.token})` }}
              />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {column.label}
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
                    key={card.visitId}
                    data={card}
                    column={column}
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
      visitId={selectedId}
      open={selectedId !== null}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
      }}
      onMutate={refresh}
    />
    </>
  );
}
