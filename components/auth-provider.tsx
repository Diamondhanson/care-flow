"use client";

/**
 * AuthProvider — real Supabase Auth session boundary (Phase 18a/18b).
 *
 * Staff sign in with a username + password (see `services/supabaseAuth`). Once a
 * session resolves we hydrate the local cache from Supabase (Phase 18b — RLS
 * scopes the pull to the user's hospital), then resolve `currentStaff` /
 * `currentHospital` from the hydrated `staff` row matched on the auth uid. If the
 * pull fails (offline) we fall back to whatever the cache already holds, and to a
 * synthetic record built from the auth metadata as a last resort.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type SignUpHospitalInput } from "@/services/mockAuth";
import {
  getActiveIdentity,
  onAuthChange,
  signInWithUsername,
  signOutSupabase,
  type AuthIdentity,
} from "@/services/supabaseAuth";
import { provisionHospital } from "@/app/actions/auth";
import {
  clearLocalCache,
  getHospitalById,
  getHospitals,
  getStaffAccountById,
  getStaffAccountByUserId,
  setActiveHospitalId,
} from "@/services/mockStorage";
import { hydrateFromSupabase } from "@/services/supabaseData";
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

  /**
   * Resolve a signed-in identity into local state. By default we first hydrate
   * the local cache from Supabase (Phase 18b); pass `{ hydrate: false }` for the
   * mock-only new-hospital signup path, whose rows don't exist in Supabase yet.
   */
  const bridge = useCallback(
    async (
      identity: AuthIdentity | null,
      opts: { hydrate?: boolean } = {},
    ) => {
      if (!identity) {
        clearLocalCache();
        setActiveHospitalId(null);
        setCurrentStaff(null);
        setCurrentHospital(null);
        return;
      }
      if (opts.hydrate ?? true) {
        // Pull this user's hospital data into the cache (RLS-scoped). On failure
        // (offline) keep whatever the cache already holds.
        try {
          await hydrateFromSupabase();
        } catch {
          /* fall through to resolve from the existing cache */
        }
      }
      const staff =
        getStaffAccountByUserId(identity.userId) ??
        getStaffAccountById(identity.mock_staff_id) ??
        syntheticStaff(identity);
      const hospital =
        getHospitalById(staff.hospital_id) ??
        getHospitals()[0] ??
        syntheticHospital(identity);
      setActiveHospitalId(hospital.id);
      setCurrentStaff(staff);
      setCurrentHospital(hospital);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    getActiveIdentity()
      .then(async (identity) => {
        if (!active) return;
        await bridge(identity);
      })
      .finally(() => {
        if (active) setMounted(true);
      });
    // React to sign-in / sign-out / token refresh in this and other tabs.
    const unsub = onAuthChange((identity) => {
      void bridge(identity);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [bridge]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const identity = await signInWithUsername(username, password);
      await bridge(identity);
    },
    [bridge],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      // 1. Provision the real tenant server-side: the hospitals row, the admin's
      //    Supabase Auth login, and the linked founding-admin staff row (the
      //    hospitals table has no client INSERT policy, so this needs the
      //    service role). Rolls back on failure — no orphan rows.
      const result = await provisionHospital({
        name: input.name,
        region: input.region ?? null,
        contact_email: input.contact_email ?? null,
        contact_phone: input.contact_phone ?? null,
        admin_full_name: input.admin_full_name,
        admin_username: input.admin_username,
        admin_password: input.admin_password,
        admin_email: input.admin_email ?? input.contact_email ?? null,
      });
      if (!result.ok) throw new Error(result.error);
      // 2. Sign in for real, then hydrate: the new hospital + admin staff rows
      //    now exist in Supabase, so the cache loads the fresh (near-empty)
      //    tenant scoped by RLS.
      const identity = await signInWithUsername(
        input.admin_username,
        input.admin_password,
      );
      await bridge(identity);
    },
    [bridge],
  );

  const signOut = useCallback(async () => {
    await signOutSupabase();
    await bridge(null);
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
