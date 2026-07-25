"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
  getDepartments,
  removeBed,
  updateBed,
  updateWard,
} from "@/services/mockStorage";
import {
  BED_STATUS_LABEL,
  MANUAL_BED_STATUSES,
} from "@/components/floor-map/floor-map";
import type { WardView } from "@/components/floor-map/ward-card";
import { useT } from "@/components/locale-provider";
import type { BedId, BedStatus, DepartmentId, Ward } from "@/types/healthcare";

const NO_DEPARTMENT = "__none__";

export function WardFormSheet({
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
  const [block, setBlock] = useState("");
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
    setBlock(ward?.block ?? "");
    setFloor(ward?.floor_label ?? "");
    setDepartmentId(ward?.department_id ?? NO_DEPARTMENT);
    setBedCount("0");
    setAddCount("1");
  }, [ward, isNew]);

  function commitWardFields() {
    // Select value is a raw DOM string; brand the department id here.
    const department_id =
      departmentId === NO_DEPARTMENT ? null : (departmentId as DepartmentId);
    if (isNew) {
      const count = Math.max(0, Number.parseInt(bedCount, 10) || 0);
      createWard({
        name,
        department_id,
        block: block || null,
        floor_label: floor || null,
        bed_count: count,
      });
    } else if (ward) {
      updateWard(ward.id, {
        name,
        department_id,
        block: block || null,
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

  function handleBedStatus(bedId: BedId, status: BedStatus) {
    try {
      updateBed(bedId, { status });
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("floorMap.couldNotUpdate"));
    }
  }

  function handleRemoveBed(bedId: BedId) {
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
            <Label htmlFor="ward_block">{t("floorMap.block")}</Label>
            <Input
              id="ward_block"
              value={block}
              onChange={(e) => setBlock(e.target.value)}
              placeholder={t("floorMap.blockPlaceholder")}
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
