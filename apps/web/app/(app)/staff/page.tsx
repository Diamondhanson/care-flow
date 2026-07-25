"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getStaff,
  getDepartments,
  getActiveVisits,
  getAdmissionForVisit,
  getBedById,
  getPatientById,
  updateStaff,
} from "@/services/mockStorage";
import {
  ROLE_GROUPS,
  StaffCard,
  type AttendingPatient,
} from "@/components/staff/staff-card";
import { StaffFormSheet } from "@/components/staff/staff-form-sheet";
import { ResetPasswordDialog } from "@/components/staff/reset-password-dialog";
import { useT } from "@/components/locale-provider";
import { useAuth } from "@/components/auth-provider";
import { useCacheVersion } from "@/lib/use-cache";
import { notify } from "@/lib/notify";
import { ResetDemo } from "@/components/demo/reset-demo";
import type { Department, Staff } from "@careflow/shared";

interface DirectoryData {
  staff: Staff[];
  /** Department name keyed by department id. */
  departments: Record<string, string>;
  /** Active patients currently attended by each doctor, keyed by staff id. */
  attending: Record<string, AttendingPatient[]>;
}

export default function StaffDirectoryPage() {
  const { t } = useT();
  const { currentStaff } = useAuth();
  const cacheVersion = useCacheVersion();
  const [data, setData] = useState<DirectoryData | null>(null);
  const [departmentList, setDepartmentList] = useState<Department[]>([]);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  /** Staff id awaiting an inline deactivation confirm (mirrors ResetDemo). */
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  /** Staff member whose login password is being reset (admin-only dialog). */
  const [resetTarget, setResetTarget] = useState<Staff | null>(null);

  const isAdmin = currentStaff?.role === "admin";

  function handleSetActive(staff: Staff, isActive: boolean) {
    try {
      updateStaff(staff.id, { is_active: isActive });
    } catch {
      notify({ kind: "error", titleKey: "staff.updateFailed" });
    }
    setConfirmingDeactivateId(null);
    refresh();
  }

  function refresh() {
    const staff = getStaff();
    const departmentRows = getDepartments();
    const departments: Record<string, string> = {};
    for (const d of departmentRows) departments[d.id] = d.name;
    setDepartmentList(departmentRows);

    const attending: Record<string, AttendingPatient[]> = {};
    for (const visit of getActiveVisits()) {
      if (!visit.attending_doctor_id) continue;
      const patient = getPatientById(visit.patient_id);
      const isAnonymous = Boolean(patient?.is_emergency_anonymous);
      const name =
        patient?.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : (patient?.full_name ?? t("staff.unknownPatient"));
      const admission = getAdmissionForVisit(visit.id);
      const location = admission?.bed_id
        ? (getBedById(admission.bed_id)?.label ?? null)
        : visit.department_id
          ? (departments[visit.department_id] ?? null)
          : null;
      (attending[visit.attending_doctor_id] ??= []).push({
        name,
        isAnonymous,
        location,
      });
    }
    setData({ staff, departments, attending });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, cacheVersion]);

  const total = data?.staff.length ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t("staff.title")}</h1>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {total ?? "—"} {t("staff.members")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("staff.subtitle")}
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" /> {t("staff.newStaff")}
        </Button>
      </header>

      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("staff.loading")}</p>
      ) : (
        ROLE_GROUPS.map((group) => {
          const members = data.staff.filter((s) => s.role === group.role);
          if (members.length === 0) return null;
          const Icon = group.icon;
          return (
            <section key={group.role} className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--status-${group.token}) 18%, transparent)`,
                    color: `var(--status-${group.token})`,
                  }}
                >
                  <Icon className="size-3.5" />
                </span>
                <h2 className="text-sm font-medium">{t(group.label)}</h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {members.length}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((s) => (
                  <StaffCard
                    key={s.id}
                    staff={s}
                    group={group}
                    departments={data.departments}
                    attending={data.attending[s.id]}
                    isAdmin={isAdmin}
                    confirmingDeactivate={confirmingDeactivateId === s.id}
                    onEdit={() => setEditing(s)}
                    onResetPassword={() => setResetTarget(s)}
                    onRequestDeactivate={() => setConfirmingDeactivateId(s.id)}
                    onCancelDeactivate={() => setConfirmingDeactivateId(null)}
                    onSetActive={(isActive) => handleSetActive(s, isActive)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("demo.title")}</h2>
        <ResetDemo />
      </section>

      <StaffFormSheet
        target={editing}
        departments={departmentList}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      <ResetPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}
