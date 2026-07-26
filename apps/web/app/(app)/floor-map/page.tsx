"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getAdmissions,
  getBeds,
  getDepartments,
  getPatients,
  getWards,
} from "@/services/mockStorage";
import { groupByFloor } from "@/components/floor-map/floor-map";
import { WardCard, type WardView } from "@/components/floor-map/ward-card";
import { WardFormSheet } from "@/components/floor-map/ward-form-sheet";
import { useT } from "@/components/locale-provider";
import { useCacheVersion } from "@/lib/use-cache";
import type { Bed, Department, Patient, Ward } from "@careflow/shared";

function load(): WardView[] {
  const departments = new Map<string, Department>(
    getDepartments().map((d) => [d.id, d]),
  );
  const patientsByAdmission = new Map<string, Patient>();
  const patients = new Map<string, Patient>(
    getPatients().map((p) => [p.id, p]),
  );
  for (const adm of getAdmissions()) {
    const patient = patients.get(adm.patient_id);
    if (patient) patientsByAdmission.set(adm.id, patient);
  }

  const bedsByWard = new Map<string, Bed[]>();
  for (const bed of getBeds()) {
    const list = bedsByWard.get(bed.ward_id) ?? [];
    list.push(bed);
    bedsByWard.set(bed.ward_id, list);
  }

  return getWards()
    .map((ward) => {
      const beds = (bedsByWard.get(ward.id) ?? [])
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        .map((bed) => {
          const occupant = bed.current_admission_id
            ? patientsByAdmission.get(bed.current_admission_id)
            : undefined;
          const occupantAnonymous = Boolean(occupant?.is_emergency_anonymous);
          return {
            bed,
            occupantName: occupant
              ? occupantAnonymous && occupant.anonymous_identifier
                ? occupant.anonymous_identifier
                : occupant.full_name
              : null,
            occupantAnonymous,
          };
        });
      return {
        ward,
        departmentName: ward.department_id
          ? (departments.get(ward.department_id)?.name ?? null)
          : null,
        beds,
      };
    })
    .sort((a, b) => {
      if (a.ward.is_active !== b.ward.is_active) {
        return a.ward.is_active ? -1 : 1;
      }
      return a.ward.name.localeCompare(b.ward.name);
    });
}

export default function FloorMapPage() {
  const { t } = useT();
  const cacheVersion = useCacheVersion();
  const [wards, setWards] = useState<WardView[] | null>(null);
  const [editing, setEditing] = useState<Ward | "new" | null>(null);

  function refresh() {
    setWards(load());
  }

  useEffect(() => {
    refresh();
  }, [cacheVersion]);

  const floors = useMemo(
    () => (wards ? groupByFloor(wards.map((w) => w.ward)) : []),
    [wards],
  );
  const wardById = useMemo(
    () => new Map((wards ?? []).map((w) => [w.ward.id, w])),
    [wards],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t("floorMap.title")}</h1>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {wards?.length ?? "—"} {t(wards?.length === 1 ? "floorMap.wardOne" : "floorMap.wardOther")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("floorMap.subtitle")}
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" /> {t("floorMap.newWard")}
        </Button>
      </header>

      {wards === null ? (
        <p className="text-sm text-muted-foreground">{t("floorMap.loading")}</p>
      ) : wards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <LayoutGrid className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("floorMap.noWards")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {floors.map(({ floor, items }) => (
            <section key={floor} className="flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {floor}
              </h2>
              <div className="flex flex-col gap-4">
                {items.map((ward) => {
                  const view = wardById.get(ward.id);
                  if (!view) return null;
                  return (
                    <WardCard
                      key={ward.id}
                      view={view}
                      onEdit={() => setEditing(ward)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <WardFormSheet
        target={editing}
        wards={wards ?? []}
        onClose={() => setEditing(null)}
        onChanged={refresh}
      />
    </div>
  );
}
