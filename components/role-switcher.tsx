"use client";

/**
 * RoleSwitcher — DEV-ONLY navbar control to switch the acting staff member
 * (and thus the role-specific UI) without authenticating. Removed when real
 * auth lands; see {@link RoleProvider}.
 */

import { UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABEL, useRole } from "@/components/role-provider";
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

  // Group staff by role in a stable, clinically-sensible order.
  const grouped = ROLE_ORDER.map((role) => ({
    role,
    members: allStaff.filter((s) => s.role === role),
  })).filter((g) => g.members.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label="Switch acting role (dev)"
          />
        }
      >
        <UserCog className="size-4 text-muted-foreground" />
        <span className="hidden text-xs font-medium sm:inline">
          {mounted && actingStaff
            ? ROLE_LABEL[actingStaff.role]
            : "Acting role"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Acting as (dev)</span>
          <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
            no auth
          </span>
        </DropdownMenuLabel>
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
                {ROLE_LABEL[group.role]}
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
