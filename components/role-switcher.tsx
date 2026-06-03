"use client";

/**
 * RoleSwitcher — DEV-ONLY navbar control to switch the acting staff member
 * (and thus the role-specific UI) without authenticating. Removed when real
 * auth lands; see {@link RoleProvider}.
 */

import { UserCog } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, useRole } from "@/components/role-provider";
import { useT } from "@/components/locale-provider";
import type { Staff, StaffRole } from "@/types/healthcare";

const ROLE_ORDER: StaffRole[] = [
  "doctor",
  "nurse",
  "pharmacist",
  "lab_tech",
  "receptionist",
  "admin",
];

export function RoleSwitcher() {
  const { mounted, allStaff, actingStaffId, actingStaff, setActingStaffId } =
    useRole();
  const { t } = useT();

  // Group staff by role in a stable, clinically-sensible order.
  const grouped = ROLE_ORDER.map((role) => ({
    role,
    members: allStaff.filter((s) => s.role === role),
  })).filter((g) => g.members.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "gap-2",
        )}
        aria-label={t("shell.switchRole")}
      >
        <UserCog className="size-4 text-muted-foreground" />
        <span className="hidden text-xs font-medium sm:inline">
          {mounted && actingStaff
            ? t(ROLE_LABEL[actingStaff.role])
            : t("shell.actingRole")}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>{t("shell.actingAs")}</span>
            <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
              {t("shell.noAuth")}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={actingStaffId ?? undefined}
          onValueChange={(value) => {
            if (value) setActingStaffId(value);
          }}
        >
          {grouped.map((group, index) => (
            <div key={group.role}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                {t(ROLE_LABEL[group.role])}
              </DropdownMenuLabel>
              {group.members.map((member: Staff) => (
                <DropdownMenuRadioItem key={member.id} value={member.id}>
                  {member.full_name}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
