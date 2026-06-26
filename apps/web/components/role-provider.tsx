"use client";

/**
 * RoleProvider — DEV-ONLY role-preview scaffold, now layered on top of auth.
 *
 * The signed-in staff (from {@link useAuth}) is the real "acting" identity. This
 * provider lets a dev/demo *preview* another role's UI without re-logging-in, by
 * overriding which staff member of the **same hospital** is acting — so tenancy
 * is never crossed. With no override it simply reflects the logged-in staff.
 * When the dev role switcher is removed (Phase 18), `actingStaff` collapses to
 * `currentStaff` and consumers — which only read `actingStaff` / `actingRole` —
 * keep working unchanged.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "@/components/auth-provider";
import { getStaffForHospital } from "@/services/mockStorage";
import type { Staff, StaffRole } from "@/types/healthcare";

interface RoleContextValue {
  /** False until the client has hydrated; guard role-specific UI with it. */
  mounted: boolean;
  allStaff: Staff[];
  actingStaffId: string | null;
  actingStaff: Staff | null;
  actingRole: StaffRole | null;
  setActingStaffId: (id: string) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { mounted, currentStaff, currentHospital } = useAuth();
  // Dev-only role-preview override (which staff in the current hospital is acting).
  const [overrideStaffId, setOverrideStaffId] = useState<string | null>(null);

  // Every staff member of the signed-in hospital — the role switcher's options.
  const allStaff = useMemo(
    () => (currentHospital ? getStaffForHospital(currentHospital.id) : []),
    [currentHospital],
  );

  // Drop any preview when the signed-in identity changes (don't leak across logins).
  useEffect(() => {
    setOverrideStaffId(null);
  }, [currentStaff?.id]);

  const setActingStaffId = useCallback((id: string) => {
    setOverrideStaffId(id);
  }, []);

  const value = useMemo<RoleContextValue>(() => {
    const actingStaffId = overrideStaffId ?? currentStaff?.id ?? null;
    const actingStaff =
      allStaff.find((s) => s.id === actingStaffId) ?? currentStaff ?? null;
    return {
      mounted,
      allStaff,
      actingStaffId: actingStaff?.id ?? null,
      actingStaff,
      actingRole: actingStaff?.role ?? null,
      setActingStaffId,
    };
  }, [mounted, allStaff, overrideStaffId, currentStaff, setActingStaffId]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within a RoleProvider");
  }
  return ctx;
}

/** i18n message key for a staff role — resolve with `t(ROLE_LABEL[role])`. */
export const ROLE_LABEL: Record<StaffRole, string> = {
  doctor: "roles.doctor",
  nurse: "roles.nurse",
  admin: "roles.admin",
  lab_tech: "roles.lab_tech",
  pharmacist: "roles.pharmacist",
  receptionist: "roles.receptionist",
};

/** Initials for an avatar fallback, e.g. "Dr. A. Okafor" → "AO". */
export function staffInitials(fullName: string): string {
  const letters = fullName
    .replace(/\b(Dr|Mr|Mrs|Ms|Nurse|Prof)\b\.?/gi, " ")
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase());
  if (letters.length === 0) return "?";
  if (letters.length === 1) return letters[0];
  return `${letters[0]}${letters[letters.length - 1]}`;
}
