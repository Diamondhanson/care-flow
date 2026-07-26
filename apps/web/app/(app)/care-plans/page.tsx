"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCarePlanEntry,
  addCarePlanItem,
  getCarePlanEntriesForAdmission,
  getCarePlanItemsForAdmission,
  getAdmittedPatientsForCarePlan,
  resolveCarePlanItem,
  type CarePlanPatient,
} from "@/services/mockStorage";
import { PatientRow } from "@/components/care-plans/patient-row";
import { DetailPanel } from "@/components/care-plans/detail-panel";
import { useRole } from "@/components/role-provider";
import { useT } from "@/components/locale-provider";
import { useCacheVersion } from "@/lib/use-cache";
import type {
  AdmissionId,
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
  CarePlanItemId,
} from "@careflow/shared";

export default function CarePlansPage() {
  const { actingStaff } = useRole();
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const cacheVersion = useCacheVersion();

  const [patients, setPatients] = useState<CarePlanPatient[] | null>(null);
  const [selectedId, setSelectedId] = useState<AdmissionId | null>(null);
  const [ward, setWard] = useState<string>("all");
  const [items, setItems] = useState<CarePlanItem[]>([]);
  const [entries, setEntries] = useState<CarePlanEntry[]>([]);

  function refreshPatients() {
    setPatients(getAdmittedPatientsForCarePlan());
  }

  function refreshDetail(admissionId: AdmissionId | null) {
    if (!admissionId) {
      setItems([]);
      setEntries([]);
      return;
    }
    // Nurse's Henderson care plan stays nursing-focused; doctor instructions and
    // monitoring orders (the shared Phase 20 list) live in the patient drawer.
    setItems(
      getCarePlanItemsForAdmission(admissionId).filter(
        (i) => i.kind === "nursing_need",
      ),
    );
    setEntries(getCarePlanEntriesForAdmission(admissionId));
  }

  // localStorage is client-only, so the first read happens after mount (keeps
  // SSR + first paint stable), mirroring the medications page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPatients();
  }, [cacheVersion]);

  // Auto-select the first patient once the list loads.
  useEffect(() => {
    if (patients && patients.length > 0 && selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(patients[0].admission.id);
    }
  }, [patients, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshDetail(selectedId);
  }, [selectedId, cacheVersion]);

  const wards = useMemo(() => {
    const names = new Set<string>();
    for (const p of patients ?? []) if (p.ward?.name) names.add(p.ward.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [patients]);

  const wardItems = useMemo(() => {
    const entries: Record<string, string> = { all: t("carePlan.allWards") };
    for (const w of wards) entries[w] = w;
    return entries;
  }, [wards, t]);

  const visible = useMemo(() => {
    if (!patients) return [];
    return ward === "all"
      ? patients
      : patients.filter((p) => p.ward?.name === ward);
  }, [patients, ward]);

  const selected = useMemo(
    () => patients?.find((p) => p.admission.id === selectedId) ?? null,
    [patients, selectedId],
  );

  function handleAddNeed(input: {
    category: CareNeedCategory;
    description: string;
    frequency: string;
    goal: string;
  }) {
    if (!selectedId) return;
    addCarePlanItem(selectedId, {
      category: input.category,
      description: input.description,
      frequency: input.frequency.trim() || null,
      goal: input.goal.trim() || null,
      created_by_id: actingStaff?.id ?? null,
    });
    refreshDetail(selectedId);
    refreshPatients();
  }

  function handleResolve(itemId: CarePlanItemId) {
    resolveCarePlanItem(itemId);
    refreshDetail(selectedId);
    refreshPatients();
  }

  function handleAddEntry(input: {
    note: string;
    careItemId: CarePlanItemId | null;
    isHandover: boolean;
  }) {
    if (!selectedId) return;
    addCarePlanEntry(selectedId, {
      note: input.note,
      care_plan_item_id: input.careItemId,
      is_handover: input.isHandover,
      recorded_by_id: actingStaff?.id ?? null,
    });
    refreshDetail(selectedId);
    refreshPatients();
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("carePlan.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("carePlan.subtitle")}
        </p>
      </header>

      {patients === null ? (
        <p className="text-sm text-muted-foreground">{t("carePlan.loading")}</p>
      ) : patients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("carePlan.noPatients")}</p>
            <p className="text-xs text-muted-foreground">
              {t("carePlan.noPatientsHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          {/* Master — patient list + ward filter */}
          <aside className="flex flex-col gap-3">
            {wards.length > 1 ? (
              <Select
                items={wardItems}
                value={ward}
                onValueChange={(v) => setWard(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("carePlan.allWards")}</SelectItem>
                  {wards.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="flex flex-col gap-2">
              {visible.map((p) => (
                <PatientRow
                  key={p.admission.id}
                  patient={p}
                  active={p.admission.id === selectedId}
                  onSelect={() => setSelectedId(p.admission.id)}
                  t={t}
                />
              ))}
            </div>
          </aside>

          {/* Detail — the selected patient's plan */}
          {selected ? (
            <DetailPanel
              selected={selected}
              items={items}
              entries={entries}
              activeLocale={activeLocale}
              onAddNeed={handleAddNeed}
              onResolve={handleResolve}
              onAddEntry={handleAddEntry}
              t={t}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <ClipboardList className="size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">
                  {t("carePlan.selectPatient")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("carePlan.selectPatientHint")}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
