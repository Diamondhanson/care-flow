"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Stethoscope,
  HeartPulse,
  ShieldCheck,
  FlaskConical,
  Pill,
  ConciergeBell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  getStaff,
  getDepartments,
  getActiveVisits,
  getAdmissionForVisit,
  getBedById,
  getPatientById,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { ResetDemo } from "@/components/demo/reset-demo";
import type { Staff, StaffRole } from "@/types/healthcare";

interface RoleGroup {
  role: StaffRole;
  label: string;
  /** Suffix of the `--status-{token}` CSS variable used as the section accent. */
  token: "boarding" | "diagnostics" | "treatment" | "discharge" | "clearance";
  icon: LucideIcon;
}

const ROLE_GROUPS: readonly RoleGroup[] = [
  { role: "doctor", label: "staff.groupDoctors", token: "treatment", icon: Stethoscope },
  { role: "nurse", label: "staff.groupNursing", token: "boarding", icon: HeartPulse },
  { role: "lab_tech", label: "staff.groupLaboratory", token: "diagnostics", icon: FlaskConical },
  { role: "pharmacist", label: "staff.groupPharmacy", token: "discharge", icon: Pill },
  { role: "receptionist", label: "staff.groupFrontDesk", token: "clearance", icon: ConciergeBell },
  { role: "admin", label: "staff.groupAdministration", token: "clearance", icon: ShieldCheck },
] as const;

interface AttendingPatient {
  name: string;
  location: string | null;
}

interface DirectoryData {
  staff: Staff[];
  /** Department name keyed by department id. */
  departments: Record<string, string>;
  /** Active patients currently attended by each doctor, keyed by staff id. */
  attending: Record<string, AttendingPatient[]>;
}

const TITLES = new Set(["dr", "dr.", "nurse", "mr", "mr.", "ms", "ms.", "mrs", "mrs.", "prof", "prof."]);

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((t) => !TITLES.has(t.toLowerCase()))
    .map((t) => t.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);
  if (letters.length === 0) return name.slice(0, 2).toUpperCase();
  if (letters.length === 1) return letters[0].slice(0, 2).toUpperCase();
  return (letters[0][0] + letters[letters.length - 1][0]).toUpperCase();
}

export default function StaffDirectoryPage() {
  const { t } = useT();
  const [data, setData] = useState<DirectoryData | null>(null);

  useEffect(() => {
    const staff = getStaff();
    const departments: Record<string, string> = {};
    for (const d of getDepartments()) departments[d.id] = d.name;

    const attending: Record<string, AttendingPatient[]> = {};
    for (const visit of getActiveVisits()) {
      if (!visit.attending_doctor_id) continue;
      const patient = getPatientById(visit.patient_id);
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
      (attending[visit.attending_doctor_id] ??= []).push({ name, location });
    }
    setData({ staff, departments, attending });
  }, [t]);

  const total = data?.staff.length ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("staff.title")}</h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {total ?? "—"} {t("staff.members")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("staff.subtitle")}
        </p>
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
                  <Card key={s.id}>
                    <CardContent className="flex flex-col gap-4 p-5">
                      <div className="flex items-start gap-3">
                        <Avatar size="lg">
                          <AvatarFallback
                            style={{
                              backgroundColor: `color-mix(in oklab, var(--status-${group.token}) 16%, transparent)`,
                              color: `var(--status-${group.token})`,
                            }}
                          >
                            {initials(s.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate font-medium">{s.full_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {s.department_id
                              ? (data.departments[s.department_id] ?? "—")
                              : "—"}
                          </span>
                          <div className="flex items-center gap-1.5 pt-0.5">
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{
                                backgroundColor: s.is_active
                                  ? "var(--status-clearance)"
                                  : "var(--muted-foreground)",
                              }}
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {s.is_active ? t("staff.active") : t("staff.inactive")}
                            </span>
                          </div>
                        </div>
                      </div>

                      {s.email ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">{s.email}</span>
                        </div>
                      ) : null}

                      {group.role === "doctor" ? (
                        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                            {t("staff.attending", { count: data.attending[s.id]?.length ?? 0 })}
                          </span>
                          {data.attending[s.id]?.length ? (
                            <ul className="flex flex-col gap-1">
                              {data.attending[s.id].map((p, i) => (
                                <li
                                  key={`${p.name}-${i}`}
                                  className="flex items-baseline justify-between gap-2 text-xs"
                                >
                                  <span className="truncate">{p.name}</span>
                                  {p.location ? (
                                    <span className="shrink-0 font-mono text-muted-foreground">
                                      {p.location}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("staff.noActivePatients")}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
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
    </div>
  );
}
