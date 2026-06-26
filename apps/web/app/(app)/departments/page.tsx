"use client";

import { useEffect, useState } from "react";
import { Building2, Pencil, Plus, Users } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  ALL_DEPARTMENTS,
  createDepartment,
  getActiveVisitCountsByDepartment,
  getDepartments,
  setDepartmentActive,
  updateDepartment,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import type { Department } from "@/types/healthcare";

interface DirectoryRow {
  department: Department;
  activeVisits: number;
}

function load(): DirectoryRow[] {
  const counts = getActiveVisitCountsByDepartment();
  return getDepartments()
    .map((department) => ({
      department,
      activeVisits: counts[department.id] ?? 0,
    }))
    .sort((a, b) => {
      // Active first, then by name.
      if (a.department.is_active !== b.department.is_active) {
        return a.department.is_active ? -1 : 1;
      }
      return a.department.name.localeCompare(b.department.name);
    });
}

export default function DepartmentsPage() {
  const { t } = useT();
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [editing, setEditing] = useState<Department | "new" | null>(null);

  function refresh() {
    setRows(load());
  }

  useEffect(() => {
    refresh();
  }, []);

  const total = rows?.length ?? null;
  const unrouted = rows ? (getActiveVisitCountsByDepartment()[ALL_DEPARTMENTS] ?? 0) : 0;

  function handleToggleActive(department: Department, next: boolean) {
    setDepartmentActive(department.id, next);
    refresh();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t("departments.title")}</h1>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {total ?? "—"} {t("departments.total")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("departments.subtitle")}
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" /> {t("departments.newDepartment")}
        </Button>
      </header>

      {unrouted > 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground">{unrouted}</span>{" "}
          {t(unrouted === 1 ? "departments.unroutedOne" : "departments.unroutedOther")}
        </div>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("departments.loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ department, activeVisits }) => (
            <Card
              key={department.id}
              className={department.is_active ? "" : "opacity-70"}
            >
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-md"
                    style={{
                      backgroundColor:
                        "color-mix(in oklab, var(--status-boarding) 16%, transparent)",
                      color: "var(--status-boarding)",
                    }}
                  >
                    <Building2 className="size-4.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{department.name}</span>
                    {department.code ? (
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        {department.code}
                      </span>
                    ) : null}
                  </div>
                  <Badge variant={department.is_active ? "secondary" : "outline"}>
                    {department.is_active ? t("departments.active") : t("departments.archived")}
                  </Badge>
                </div>

                {department.description ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {department.description}
                  </p>
                ) : null}

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="size-3.5 shrink-0" />
                  <span className="font-mono tabular-nums text-foreground">
                    {activeVisits}
                  </span>
                  {t(activeVisits === 1 ? "departments.activeVisitOne" : "departments.activeVisitOther")}
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={department.is_active}
                      onCheckedChange={(next) =>
                        handleToggleActive(department, next)
                      }
                    />
                    {department.is_active ? t("departments.active") : t("departments.archived")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(department)}
                  >
                    <Pencil className="size-3.5" /> {t("departments.edit")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DepartmentFormSheet
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}

function DepartmentFormSheet({
  target,
  onClose,
  onSaved,
}: {
  target: Department | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const isNew = target === "new";
  const department = target && target !== "new" ? target : null;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync the form whenever the target changes (open / switch record).
  useEffect(() => {
    setError(null);
    setName(department?.name ?? "");
    setCode(department?.code ?? "");
    setDescription(department?.description ?? "");
    setIsActive(department?.is_active ?? true);
  }, [department]);

  function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError(t("departments.nameRequired"));
      return;
    }
    if (isNew) {
      createDepartment({
        name,
        code: code || null,
        description: description || null,
      });
    } else if (department) {
      updateDepartment(department.id, {
        name,
        code: code || null,
        description: description || null,
        is_active: isActive,
      });
    }
    onSaved();
  }

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{isNew ? t("departments.newTitle") : t("departments.editTitle")}</SheetTitle>
          <SheetDescription>
            {isNew ? t("departments.newDesc") : t("departments.editDesc")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept_name">{t("departments.name")}</Label>
            <Input
              id="dept_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("departments.namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept_code">{t("departments.code")}</Label>
            <Input
              id="dept_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("departments.codePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept_desc">{t("departments.description")}</Label>
            <Textarea
              id="dept_desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("departments.descriptionPlaceholder")}
            />
          </div>

          {!isNew ? (
            <label className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("departments.active")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("departments.activeHint")}
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave}>
            {isNew ? t("departments.create") : t("common.saveChanges")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
