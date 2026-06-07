"use client";

/**
 * AuthProvider — real Supabase Auth session boundary (Phase 18a).
 *
 * Staff sign in with a username + password (see `services/supabaseAuth`). The
 * authenticated identity is bridged to the still-mock data layer: we scope the
 * mock to the user's hospital and resolve their `currentStaff` / `currentHospital`
 * from the mock store (falling back to a synthetic record built from the auth
 * metadata when the mock seed doesn't contain that staff member — e.g. a freshly
 * provisioned account viewed in another browser). Phase 18b swaps the mock store
 * for Postgres and drops the bridge; this context's shape stays the same.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { signUpHospital, type SignUpHospitalInput } from "@/services/mockAuth";
import {
  getActiveIdentity,
  onAuthChange,
  signInWithUsername,
  signOutSupabase,
  type AuthIdentity,
} from "@/services/supabaseAuth";
import { provisionStaffLogin } from "@/app/actions/auth";
import {
  getHospitalById,
  getStaffAccountById,
  setActiveHospitalId,
} from "@/services/mockStorage";
import type { Hospital, Staff, StaffRole } from "@/types/healthcare";

/** Founder-admin signup: hospital details + the admin's login credentials. */
export interface SignUpInput
  extends Omit<SignUpHospitalInput, "admin_email"> {
  admin_username: string;
  admin_password: string;
  admin_email?: string | null;
}

interface AuthContextValue {
  /** False until the client has hydrated + resolved the session. */
  mounted: boolean;
  isAuthenticated: boolean;
  currentStaff: Staff | null;
  currentHospital: Hospital | null;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const nowISO = () => new Date().toISOString();

/** Build a minimal Staff from auth metadata when the mock seed lacks the row. */
function syntheticStaff(id: AuthIdentity): Staff {
  return {
    id: id.mock_staff_id,
    hospital_id: id.mock_hospital_id,
    user_id: id.userId,
    full_name: id.full_name,
    role: (id.role || "admin") as StaffRole,
    department_id: null,
    email: null,
    phone: null,
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

/** Build a minimal Hospital from auth metadata when the mock seed lacks it. */
function syntheticHospital(id: AuthIdentity): Hospital {
  return {
    id: id.mock_hospital_id,
    name: id.full_name ? `${id.username}'s hospital` : "Hospital",
    region: null,
    contact_email: null,
    contact_phone: null,
    subscription_tier: "standard",
    subscription_status: "trial",
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [currentHospital, setCurrentHospital] = useState<Hospital | null>(null);

  /** Apply a resolved identity to the mock data layer + local state. */
  const bridge = useCallback((identity: AuthIdentity | null) => {
    if (!identity) {
      setActiveHospitalId(null);
      setCurrentStaff(null);
      setCurrentHospital(null);
      return;
    }
    setActiveHospitalId(identity.mock_hospital_id);
    setCurrentStaff(
      getStaffAccountById(identity.mock_staff_id) ?? syntheticStaff(identity),
    );
    setCurrentHospital(
      getHospitalById(identity.mock_hospital_id) ?? syntheticHospital(identity),
    );
  }, []);

  useEffect(() => {
    let active = true;
    getActiveIdentity()
      .then((identity) => {
        if (!active) return;
        bridge(identity);
      })
      .finally(() => {
        if (active) setMounted(true);
      });
    // React to sign-in / sign-out / token refresh in this and other tabs.
    const unsub = onAuthChange((identity) => bridge(identity));
    return () => {
      active = false;
      unsub();
    };
  }, [bridge]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const identity = await signInWithUsername(username, password);
      bridge(identity);
    },
    [bridge],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      // 1. Create the tenant + founder admin in the mock data layer.
      const { hospital, admin } = signUpHospital({
        name: input.name,
        region: input.region,
        contact_email: input.contact_email,
        contact_phone: input.contact_phone,
        admin_full_name: input.admin_full_name,
        admin_email: input.admin_email ?? input.contact_email ?? null,
      });
      // 2. Provision a real Supabase Auth login for the admin.
      const result = await provisionStaffLogin({
        username: input.admin_username,
        password: input.admin_password,
        full_name: admin.full_name,
        role: "admin",
        // No Supabase hospitals row yet for mock-only tenants (Phase 18a).
        hospital_id: hospital.id,
        mock_hospital_id: hospital.id,
        mock_staff_id: admin.id,
      });
      if (!result.ok) throw new Error(result.error);
      // 3. Sign in for real.
      const identity = await signInWithUsername(
        input.admin_username,
        input.admin_password,
      );
      bridge(identity);
    },
    [bridge],
  );

  const signOut = useCallback(async () => {
    await signOutSupabase();
    bridge(null);
  }, [bridge]);

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
