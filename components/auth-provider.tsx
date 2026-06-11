"use client";

/**
 * AuthProvider — real Supabase Auth session boundary (Phase 18a/18b/18.5).
 *
 * Two kinds of people sign in:
 *  - STAFF (doctors/nurses/…) authenticate with a username + password (a
 *    synthetic-email Supabase login, metadata-bridged — see `services/supabaseAuth`).
 *  - FOUNDING ADMINS verify their identity first via Google or email-OTP
 *    (Phase 18.5), then create their hospital. Their session may resolve to a
 *    raw auth user with NO staff row yet — the "needs onboarding" state.
 *
 * Once a session resolves we hydrate the local cache from Supabase (RLS scopes
 * the pull to the user's hospital), then resolve `currentStaff` / `currentHospital`
 * from the hydrated `staff` row matched on the auth uid. A verified user with no
 * staff row is surfaced via `needsOnboarding` so the app can route them to the
 * create-hospital step instead of treating them as signed out.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { User } from "@supabase/supabase-js";

import {
  createHospitalForCurrentUser,
  getCurrentUser,
  metaToIdentity,
  onAuthUserChange,
  sendEmailOtp,
  signInWithGoogle as signInWithGoogleService,
  signInWithUsername,
  signOutSupabase,
  verifyEmailOtp,
  type AuthIdentity,
  type CreateHospitalInput,
} from "@/services/supabaseAuth";
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

interface AuthContextValue {
  /** False until the client has hydrated + resolved the session. */
  mounted: boolean;
  /** A fully-resolved staff identity (signed in AND belongs to a hospital). */
  isAuthenticated: boolean;
  /** Verified session but no hospital yet — should go to the onboarding step. */
  needsOnboarding: boolean;
  /** The raw verified Supabase user (email/Google), or null when signed out. */
  authUser: User | null;
  currentStaff: Staff | null;
  currentHospital: Hospital | null;
  /** Staff sign-in (username + password). */
  signIn: (username: string, password: string) => Promise<void>;
  /** Founder sign-in via Google (redirects away; resolves on `/auth/callback`). */
  signInWithGoogle: (redirectTo: string) => Promise<void>;
  /** Founder sign-in via email OTP — request a code. */
  requestEmailOtp: (email: string) => Promise<void>;
  /** Founder sign-in via email OTP — verify the code (establishes a session). */
  confirmEmailOtp: (email: string, token: string) => Promise<void>;
  /** Create the verified user's hospital; resolves once they're fully signed in. */
  createHospital: (input: CreateHospitalInput) => Promise<void>;
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
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [currentHospital, setCurrentHospital] = useState<Hospital | null>(null);

  /**
   * Resolve a raw Supabase user into local state. Hydrates the cache from
   * Supabase (RLS-scoped) then matches the user's `staff` row:
   *  - resolved staff  → fully authenticated (currentStaff/currentHospital set);
   *  - no staff row    → verified-but-no-hospital (needsOnboarding);
   *  - no user         → signed out (cache cleared).
   * Legacy username/password logins additionally fall back to their metadata
   * bridge (synthetic staff/hospital) so offline sign-in still resolves.
   */
  const resolveUser = useCallback(async (user: User | null) => {
    if (!user) {
      clearLocalCache();
      setActiveHospitalId(null);
      setAuthUser(null);
      setCurrentStaff(null);
      setCurrentHospital(null);
      return;
    }

    // Pull this user's hospital data into the cache (RLS-scoped). A verified
    // user with no hospital yet simply gets nothing back. On failure (offline)
    // keep whatever the cache already holds.
    try {
      await hydrateFromSupabase();
    } catch {
      /* fall through to resolve from the existing cache */
    }

    const legacy = metaToIdentity(user); // non-null only for staff logins
    const staff =
      getStaffAccountByUserId(user.id) ??
      (legacy ? getStaffAccountById(legacy.mock_staff_id) : undefined) ??
      (legacy ? syntheticStaff(legacy) : undefined);

    if (!staff) {
      // Verified, but no hospital yet → onboarding.
      setActiveHospitalId(null);
      setAuthUser(user);
      setCurrentStaff(null);
      setCurrentHospital(null);
      return;
    }

    const hospital =
      getHospitalById(staff.hospital_id) ??
      getHospitals()[0] ??
      (legacy ? syntheticHospital(legacy) : null);
    setActiveHospitalId(hospital?.id ?? null);
    setAuthUser(user);
    setCurrentStaff(staff);
    setCurrentHospital(hospital);
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(async (user) => {
        if (!active) return;
        await resolveUser(user);
      })
      .finally(() => {
        if (active) setMounted(true);
      });
    // React to sign-in / sign-out / token refresh / OAuth-return across tabs.
    const unsub = onAuthUserChange((user) => {
      void resolveUser(user);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [resolveUser]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const identity = await signInWithUsername(username, password);
      // signInWithUsername returns the metadata identity; resolve via the raw
      // user so the same DB-first path runs. Re-read the current user.
      const user = await getCurrentUser();
      await resolveUser(user ?? null);
      // Defensive: if the session race left no user, fall back to the identity.
      if (!user) {
        const staff =
          getStaffAccountByUserId(identity.userId) ??
          getStaffAccountById(identity.mock_staff_id) ??
          syntheticStaff(identity);
        setCurrentStaff(staff);
        setCurrentHospital(
          getHospitalById(staff.hospital_id) ?? syntheticHospital(identity),
        );
      }
    },
    [resolveUser],
  );

  const signInWithGoogle = useCallback(async (redirectTo: string) => {
    await signInWithGoogleService(redirectTo);
  }, []);

  const requestEmailOtp = useCallback(async (email: string) => {
    await sendEmailOtp(email);
  }, []);

  const confirmEmailOtp = useCallback(
    async (email: string, token: string) => {
      const user = await verifyEmailOtp(email, token);
      await resolveUser(user);
    },
    [resolveUser],
  );

  const createHospital = useCallback(
    async (input: CreateHospitalInput) => {
      await createHospitalForCurrentUser(input);
      // The hospital + admin staff rows now exist; re-resolve so the cache loads
      // the fresh tenant (RLS-scoped) and the user becomes fully authenticated.
      const user = await getCurrentUser();
      await resolveUser(user);
    },
    [resolveUser],
  );

  const signOut = useCallback(async () => {
    await signOutSupabase();
    await resolveUser(null);
  }, [resolveUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      mounted,
      isAuthenticated: currentStaff !== null,
      needsOnboarding: authUser !== null && currentStaff === null,
      authUser,
      currentStaff,
      currentHospital,
      signIn,
      signInWithGoogle,
      requestEmailOtp,
      confirmEmailOtp,
      createHospital,
      signOut,
    }),
    [
      mounted,
      authUser,
      currentStaff,
      currentHospital,
      signIn,
      signInWithGoogle,
      requestEmailOtp,
      confirmEmailOtp,
      createHospital,
      signOut,
    ],
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
