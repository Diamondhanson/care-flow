"use client";

import {
  KeyRound,
  Mail,
  Pencil,
  Stethoscope,
  HeartPulse,
  ShieldCheck,
  FlaskConical,
  Pill,
  ConciergeBell,
  UserRoundX,
  UserRoundCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";
import { PatientName } from "@/lib/patient-name";
import type { Staff, StaffRole } from "@careflow/shared";
import type { MessageKey } from "@/i18n";

export interface RoleGroup {
  role: StaffRole;
  label: MessageKey;
  /** Suffix of the `--status-{token}` CSS variable used as the section accent. */
  token: "boarding" | "diagnostics" | "treatment" | "discharge" | "clearance";
  icon: LucideIcon;
}

export const ROLE_GROUPS: readonly RoleGroup[] = [
  { role: "doctor", label: "staff.groupDoctors", token: "treatment", icon: Stethoscope },
  { role: "nurse", label: "staff.groupNursing", token: "boarding", icon: HeartPulse },
  { role: "lab_tech", label: "staff.groupLaboratory", token: "diagnostics", icon: FlaskConical },
  { role: "pharmacist", label: "staff.groupPharmacy", token: "discharge", icon: Pill },
  { role: "receptionist", label: "staff.groupFrontDesk", token: "clearance", icon: ConciergeBell },
  { role: "admin", label: "staff.groupAdministration", token: "clearance", icon: ShieldCheck },
] as const;

export interface AttendingPatient {
  name: string;
  isAnonymous: boolean;
  location: string | null;
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

/** One member card in the directory grid, with its edit/deactivate actions. */
export function StaffCard({
  staff: s,
  group,
  departments,
  attending,
  isAdmin,
  confirmingDeactivate,
  onEdit,
  onResetPassword,
  onRequestDeactivate,
  onCancelDeactivate,
  onSetActive,
}: {
  staff: Staff;
  group: RoleGroup;
  /** Department name keyed by department id. */
  departments: Record<string, string>;
  /** Active patients currently attended by this doctor (doctor cards only). */
  attending: AttendingPatient[] | undefined;
  isAdmin: boolean;
  /** True while this card shows the inline deactivation confirm. */
  confirmingDeactivate: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onRequestDeactivate: () => void;
  onCancelDeactivate: () => void;
  onSetActive: (isActive: boolean) => void;
}) {
  const { t } = useT();
  return (
    <Card>
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
                ? (departments[s.department_id] ?? "—")
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
              {t("staff.attending", { count: attending?.length ?? 0 })}
            </span>
            {attending?.length ? (
              <ul className="flex flex-col gap-1">
                {attending.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <PatientName
                      name={p.name}
                      format={!p.isAnonymous}
                      className={cn("truncate", p.isAnonymous && "font-mono")}
                    />
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

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          {confirmingDeactivate ? (
            <>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {t("staff.deactivatePrompt")}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancelDeactivate}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onSetActive(false)}
                >
                  <UserRoundX className="size-3.5" />
                  {t("staff.deactivateConfirm")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onEdit}
                >
                  <Pencil className="size-3.5" /> {t("common.edit")}
                </Button>
                {isAdmin && s.user_id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onResetPassword}
                  >
                    <KeyRound className="size-3.5" />
                    {t("staff.resetPassword")}
                  </Button>
                ) : null}
              </div>
              {s.is_active ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={onRequestDeactivate}
                >
                  <UserRoundX className="size-3.5" />
                  {t("staff.deactivate")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetActive(true)}
                >
                  <UserRoundCheck className="size-3.5" />
                  {t("staff.reactivate")}
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
