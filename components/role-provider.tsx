"use client";

/**
 * RoleProvider — DEV-ONLY acting-role scaffold.
 *
 * Lets us switch which staff member (and therefore which role's UI) is "acting"
 * without real authentication, so we can preview the doctor / nurse / admin
 * views during development. When real auth lands (Phase 13) the acting staff
 * will come from the signed-in session and this provider — plus the navbar
 * RoleSwitcher — is removed wholesale; nothing else needs to change because
 * consumers only read `actingStaff` / `actingRole`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getStaff } from "@/services/mockStorage";
import type { Staff, StaffRole } from "@/types/healthcare";

const STORAGE_KEY = "careflow_acting_staff";

/** Default acting identity — matches the seeded attending doctor. */
const DEFAULT_STAFF_ID = "staff_okafor";

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
  const [mounted, setMounted] = useState(false);
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [actingStaffId, setActingStaffIdState] = useState<string | null>(
    DEFAULT_STAFF_ID,
  );

  useEffect(() => {
    const staff = getStaff();
    setAllStaff(staff);

    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }

    const resolved =
      (saved && staff.some((s) => s.id === saved) ? saved : null) ??
      (staff.some((s) => s.id === DEFAULT_STAFF_ID) ? DEFAULT_STAFF_ID : null) ??
      staff[0]?.id ??
      null;

    setActingStaffIdState(resolved);
    setMounted(true);
  }, []);

  const setActingStaffId = useCallback((id: string) => {
    setActingStaffIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, []);

  const value = useMemo<RoleContextValue>(() => {
    const actingStaff =
      allStaff.find((s) => s.id === actingStaffId) ?? null;
    return {
      mounted,
      allStaff,
      actingStaffId,
      actingStaff,
      actingRole: actingStaff?.role ?? null,
      setActingStaffId,
    };
  }, [mounted, allStaff, actingStaffId, setActingStaffId]);

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
