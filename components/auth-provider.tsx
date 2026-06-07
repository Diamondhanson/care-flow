"use client";

/**
 * AuthProvider — the mock session boundary (Phase 17).
 *
 * Exposes the signed-in staff and their hospital to the whole app. Backed by
 * `services/mockAuth` (a localStorage session today); on the Supabase cutover
 * (Phase 18) only the service implementation changes — this context's shape, and
 * therefore every consumer, stays the same. The `(app)` route group reads
 * `isAuthenticated` to guard the dashboard; `(marketing)` pages call `signIn` /
 * `signUp`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getCurrentSession,
  signIn as authSignIn,
  signOut as authSignOut,
  signUpHospital,
  type SignUpHospitalInput,
} from "@/services/mockAuth";
import { setActiveHospitalId } from "@/services/mockStorage";
import type { Hospital, Staff, StaffId } from "@/types/healthcare";

interface AuthContextValue {
  /** False until the client has hydrated; guard auth-dependent UI with it. */
  mounted: boolean;
  isAuthenticated: boolean;
  currentStaff: Staff | null;
  currentHospital: Hospital | null;
  signIn: (staffId: StaffId) => Staff;
  signUp: (input: SignUpHospitalInput) => { hospital: Hospital; admin: Staff };
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [currentHospital, setCurrentHospital] = useState<Hospital | null>(null);

  /** Resolve the persisted session and sync the mock's active tenant. */
  const refresh = useCallback(() => {
    const { staff, hospital } = getCurrentSession();
    setActiveHospitalId(staff?.hospital_id ?? null);
    setCurrentStaff(staff);
    setCurrentHospital(hospital);
  }, []);

  useEffect(() => {
    refresh();
    setMounted(true);
  }, [refresh]);

  const signIn = useCallback(
    (staffId: StaffId) => {
      const staff = authSignIn(staffId);
      refresh();
      return staff;
    },
    [refresh],
  );

  const signUp = useCallback(
    (input: SignUpHospitalInput) => {
      const result = signUpHospital(input);
      refresh();
      return result;
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    authSignOut();
    refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mounted,
      isAuthenticated: currentStaff !== null,
      currentStaff,
      currentHospital,
      signIn,
      signUp,
      signOut,
    }),
    [mounted, currentStaff, currentHospital, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
