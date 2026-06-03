"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
  User,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  addBedsToWard,
  createWard,
  getAdmissions,
  getBeds,
  getDepartments,
  getPatients,
  getWards,
  removeBed,
  updateBed,
  updateWard,
} from "@/services/mockStorage";
import {
  BED_STATUS_LABEL,
  BED_STATUS_TOKEN,
  MANUAL_BED_STATUSES,
  groupByFloor,
  tallyBeds,
} from "@/components/floor-map/floor-map";
import { useT } from "@/components/locale-provider";
import type {
  Bed,
  BedStatus,
  Department,
  Patient,
  Ward,
} from "@/types/healthcare";

const NO_DEPARTMENT = "__none__";

/**
 * Resolve a bed-status token to a CSS color. `maintenance` maps to the `muted`
 * token, which has no clinical `--status-*` variable, so fall back to the
 * semantic muted foreground.
 */
function tokenColor(token: string): string {
  return token === "muted" ? "var(--muted-foreground)" : `var(--status-${token})`;
}

interface BedView {
  bed: Bed;
  occupantName: string | null;
}

interface WardView {
  ward: Ward;
  departmentName: string | null;
  beds: BedView[];
}

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
        .map((bed) => ({
          bed,
          occupantName: bed.current_admission_id
            ? (patientsByAdmission.get(bed.current_admission_id)?.full_name ??
              null)
            : null,
        }));
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
  const [wards, setWards] = useState<WardView[] | null>(null);
  const [editing, setEditing] = useState<Ward | "new" | null>(null);

  function refresh() {
    setWards(load());
  }

  useEffect(() => {
    refresh();
  }, []);

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

function WardCard({
  view,
  onEdit,
}: {
  view: WardView;
  onEdit: () => void;
}) {
  const { t } = useT();
  const { ward, departmentName, beds } = view;
  const tally = tallyBeds(beds.map((b) => b.bed));

  return (
    <Card className={ward.is_active ? "" : "opacity-70"}>
      <CardContent className="@container flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          {/* Full-width until the *card itself* is wide enough to share the row,
              so the tally chips + edit button wrap below the title instead of
              squeezing the ward name to a single letter. A container query (not
              a viewport breakpoint) is used because the card's width depends on
              the grid/stack it sits in, not on the screen width. */}
          <div className="flex min-w-0 basis-full flex-col gap-0.5 @[30rem]:flex-1 @[30rem]:basis-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{ward.name}</span>
              {!ward.is_active ? (
                <Badge variant="outline">{t("departments.archived")}</Badge>
              ) : null}
            </div>
            {departmentName ? (
              <span className="text-xs text-muted-foreground">
                {departmentName}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <TallyChip token="treatment" label={t("floorMap.occupied")} value={tally.occupied} />
            <TallyChip token="clearance" label={t("floorMap.free")} value={tally.available} />
            <TallyChip token="muted" label={t("floorMap.other")} value={tally.unavailable} />
          </div>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" /> {t("floorMap.edit")}
          </Button>
        </div>

        <Separator />

        {beds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("floorMap.noBeds")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {beds.map(({ bed, occupantName }) => (
              <BedTile key={bed.id} bed={bed} occupantName={occupantName} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TallyChip({
  token,
  label,
  value,
}: {
  token: "treatment" | "clearance" | "muted";
  label: string;
  value: number;
}) {
  const color = tokenColor(token);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        color,
      }}
    >
      <span className="font-mono tabular-nums">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}

function BedTile({
  bed,
  occupantName,
}: {
  bed: Bed;
  occupantName: string | null;
}) {
  const { t } = useT();
  const token = BED_STATUS_TOKEN[bed.status];
  const color = tokenColor(token);
  const isOccupied = bed.status === "occupied";
  return (
    <div
      className="flex flex-col gap-1 rounded-md border p-2.5"
      style={{
        borderColor: `color-mix(in oklab, ${color} 35%, var(--border))`,
        backgroundColor: `color-mix(in oklab, ${color} 6%, transparent)`,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          <BedDouble className="size-3.5 shrink-0 text-muted-foreground" />
          {bed.label}
        </span>
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      {isOccupied ? (
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <User className="size-3 shrink-0" />
          {occupantName ?? t("floorMap.occupied")}
        </span>
      ) : (
        <span className="text-xs font-medium" style={{ color }}>
          {t(BED_STATUS_LABEL[bed.status])}
        </span>
      )}
    </div>
  );
}

function WardFormSheet({
  target,
  wards,
  onClose,
  onChanged,
}: {
  target: Ward | "new" | null;
  wards: WardView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const isNew = target === "new";
  const ward = target && target !== "new" ? target : null;
  const wardView = ward ? wards.find((w) => w.ward.id === ward.id) : null;

  const [name, setName] = useState("");
  const [floor, setFloor] = useState("");
  const [departmentId, setDepartmentId] = useState<string>(NO_DEPARTMENT);
  const [bedCount, setBedCount] = useState("0");
  const [addCount, setAddCount] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const departments = useMemo(
    () => getDepartments().filter((d) => d.is_active || d.id === ward?.department_id),
    [ward?.department_id],
  );

  useEffect(() => {
    setError(null);
    setName(ward?.name ?? "");
    setFloor(ward?.floor_label ?? "");
    setDepartmentId(ward?.department_id ?? NO_DEPARTMENT);
    setBedCount("0");
    setAddCount("1");
  }, [ward, isNew]);

  function commitWardFields() {
    const department_id = departmentId === NO_DEPARTMENT ? null : departmentId;
    if (isNew) {
      const count = Math.max(0, Number.parseInt(bedCount, 10) || 0);
      createWard({
        name,
        department_id,
        floor_label: floor || null,
        bed_count: count,
      });
    } else if (ward) {
      updateWard(ward.id, {
        name,
        department_id,
        floor_label: floor || null,
      });
    }
  }

  function handleSaveWard() {
    setError(null);
    if (!name.trim()) {
      setError(t("floorMap.nameRequired"));
      return;
    }
    commitWardFields();
    onChanged();
    onClose();
  }

  function handleAddBeds() {
    if (!ward) return;
    const count = Math.max(0, Number.parseInt(addCount, 10) || 0);
    if (count <= 0) {
      setError(t("floorMap.enterBedCount"));
      return;
    }
    addBedsToWard(ward.id, count);
    setAddCount("1");
    onChanged();
  }

  function handleBedStatus(bedId: string, status: BedStatus) {
    try {
      updateBed(bedId, { status });
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMap.couldNotUpdate"));
    }
  }

  function handleRemoveBed(bedId: string) {
    try {
      removeBed(bedId);
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMap.couldNotRemove"));
    }
  }

  // Re-read the live bed list for the open ward so edits reflect immediately.
  const liveBeds = wardView?.beds ?? [];

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{isNew ? t("floorMap.newTitle") : t("floorMap.editTitle")}</SheetTitle>
          <SheetDescription>
            {isNew ? t("floorMap.newDesc") : t("floorMap.editDesc")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ward_name">{t("floorMap.name")}</Label>
            <Input
              id="ward_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("floorMap.namePlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ward_floor">{t("floorMap.floor")}</Label>
            <Input
              id="ward_floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder={t("floorMap.floorPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ward_dept">{t("floorMap.department")}</Label>
            <Select
              items={{
                [NO_DEPARTMENT]: t("floorMap.noDepartment"),
                ...Object.fromEntries(departments.map((d) => [d.id, d.name])),
              }}
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v as string)}
            >
              <SelectTrigger id="ward_dept" className="w-full">
                <SelectValue placeholder={t("floorMap.noDepartment")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT}>{t("floorMap.noDepartment")}</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isNew ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ward_beds">{t("floorMap.initialBeds")}</Label>
              <Input
                id="ward_beds"
                type="number"
                min={0}
                value={bedCount}
                onChange={(e) => setBedCount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("floorMap.initialBedsHint")}
              </p>
            </div>
          ) : null}

          {!isNew && ward ? (
            <>
              <Separator />
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {t("floorMap.beds")}
                    <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {liveBeds.length}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={addCount}
                      onChange={(e) => setAddCount(e.target.value)}
                      className="h-8 w-16"
                      aria-label={t("floorMap.addCountLabel")}
                    />
                    <Button variant="outline" size="sm" onClick={handleAddBeds}>
                      <Plus className="size-3.5" /> {t("floorMap.add")}
                    </Button>
                  </div>
                </div>

                {liveBeds.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("floorMap.noBedsYet")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {liveBeds.map(({ bed, occupantName }) => {
                      const occupied = bed.status === "occupied";
                      return (
                        <li
                          key={bed.id}
                          className="flex items-center gap-2 rounded-md border border-border p-2"
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">
                              {bed.label}
                            </span>
                            {occupied ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {occupantName ?? t("floorMap.occupied")}
                              </span>
                            ) : null}
                          </span>

                          {occupied ? (
                            <Badge
                              variant="secondary"
                              className="shrink-0"
                            >
                              {t("floorMap.occupied")}
                            </Badge>
                          ) : (
                            <Select
                              items={Object.fromEntries(
                                MANUAL_BED_STATUSES.map((s) => [
                                  s,
                                  t(BED_STATUS_LABEL[s]),
                                ]),
                              )}
                              value={bed.status}
                              onValueChange={(v) =>
                                handleBedStatus(bed.id, v as BedStatus)
                              }
                            >
                              <SelectTrigger size="sm" className="w-32 shrink-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MANUAL_BED_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {t(BED_STATUS_LABEL[s])}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0"
                            disabled={occupied}
                            onClick={() => handleRemoveBed(bed.id)}
                            aria-label={t("floorMap.removeBed", { label: bed.label })}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            {isNew ? t("floorMap.cancel") : t("floorMap.done")}
          </Button>
          <Button onClick={handleSaveWard}>
            {isNew ? t("floorMap.create") : t("floorMap.saveWard")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
