"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Plus,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  getStaff,
  getDepartments,
  getActiveVisits,
  getAdmissionForVisit,
  getBedById,
  getPatientById,
  createStaff,
  deleteStaff,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { useAuth } from "@/components/auth-provider";
import { provisionStaffLogin } from "@/app/actions/auth";
import { ResetDemo } from "@/components/demo/reset-demo";
import type { Department, Staff, StaffRole } from "@/types/healthcare";

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
  const [departmentList, setDepartmentList] = useState<Department[]>([]);
  const [adding, setAdding] = useState(false);

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
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

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
        <Button onClick={() => setAdding(true)}>
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

      <StaffFormSheet
        open={adding}
        departments={departmentList}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          refresh();
        }}
      />
    </div>
  );
}

/** Role options for the add-staff select, in directory order. */
const ROLE_OPTIONS: readonly { role: StaffRole; label: string }[] = ROLE_GROUPS.map(
  (g) => ({ role: g.role, label: g.label }),
);

function StaffFormSheet({
  open,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { currentHospital } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole | null>(null);
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (open) {
      setName("");
      setRole(null);
      setDepartmentId("none");
      setUsername("");
      setPassword("");
      setEmail("");
      setPhone("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError(t("staff.nameRequired"));
      return;
    }
    if (!role) {
      setError(t("staff.roleRequired"));
      return;
    }
    if (!username.trim()) {
      setError(t("staff.usernameRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("staff.passwordTooShort"));
      return;
    }
    if (!currentHospital) {
      setError(t("staff.noHospital"));
      return;
    }

    setSaving(true);
    // Create the mock staff row first so we have its id to bridge the login to,
    // then provision a real Supabase Auth login. If provisioning fails (e.g. the
    // username is taken) we roll the mock row back so retrying is clean.
    const created = createStaff({
      full_name: name,
      role,
      email: email.trim() || null,
      phone: phone.trim() || null,
      department_id: departmentId === "none" ? null : (departmentId as Department["id"]),
      hospital_id: currentHospital.id,
    });
    try {
      const result = await provisionStaffLogin({
        username: username.trim(),
        password,
        full_name: created.full_name,
        role,
        hospital_id: currentHospital.id,
        mock_hospital_id: currentHospital.id,
        mock_staff_id: created.id,
      });
      if (!result.ok) {
        deleteStaff(created.id);
        setError(result.error);
        return;
      }
      onSaved();
    } catch (err) {
      deleteStaff(created.id);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("staff.newTitle")}</SheetTitle>
          <SheetDescription>{t("staff.newDesc")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_name">{t("staff.name")}</Label>
            <Input
              id="staff_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("staff.namePlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_role">{t("staff.role")}</Label>
            <Select
              items={Object.fromEntries(
                ROLE_OPTIONS.map((o) => [o.role, t(o.label)]),
              )}
              value={role}
              onValueChange={(v) => setRole(v as StaffRole)}
            >
              <SelectTrigger id="staff_role">
                <SelectValue placeholder={t("staff.rolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.role} value={o.role}>
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_username">{t("staff.username")}</Label>
            <Input
              id="staff_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("staff.usernamePlaceholder")}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_password">{t("staff.password")}</Label>
            <Input
              id="staff_password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("staff.passwordPlaceholder")}
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_department">{t("staff.department")}</Label>
            <Select
              items={{
                none: t("staff.departmentNone"),
                ...Object.fromEntries(
                  departments
                    .filter((d) => d.is_active)
                    .map((d) => [d.id, d.name]),
                ),
              }}
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v ?? "none")}
            >
              <SelectTrigger id="staff_department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("staff.departmentNone")}</SelectItem>
                {departments
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_email">{t("staff.email")}</Label>
            <Input
              id="staff_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("staff.emailPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_phone">{t("staff.phone")}</Label>
            <Input
              id="staff_phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("staff.phonePlaceholder")}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-3 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("staff.creating") : t("staff.create")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
