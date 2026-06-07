/**
 * mockAuth — the mock stand-in for Supabase Auth (Phase 17, frontend-first).
 *
 * A "session" here is just which staff member is signed in; their hospital is
 * derived from `staff.hospital_id`, exactly as `current_hospital_id()` derives
 * the tenant from the logged-in user server-side. The session is persisted to
 * localStorage so a reload keeps you logged in.
 *
 * On the Supabase cutover (Phase 18) this whole module is replaced by real Auth:
 * `signIn` → `supabase.auth.signInWithPassword`, `signOut` → `auth.signOut`,
 * and hospital signup moves to a privileged Edge Function. The UI contract
 * (an AuthProvider exposing `currentStaff` / `currentHospital`) is unchanged.
 */

import {
  createHospital,
  createStaff,
  getHospitalById,
  getStaffAccountById,
  setActiveHospitalId,
  type CreateHospitalInput,
} from "@/services/mockStorage";
import type { Hospital, Staff, StaffId } from "@/types/healthcare";

const SESSION_KEY = "careflow_session";

export interface Session {
  staffId: StaffId;
}

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}

/** The persisted session, or null on the server / when signed out. */
export function getSession(): Session | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return typeof parsed.staffId === "string" ? { staffId: parsed.staffId } : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  if (!isBrowser()) return;
  try {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore persistence errors (private mode, etc.) */
  }
}

/** The signed-in staff + their hospital, resolved from the stored session. */
export function getCurrentSession(): {
  session: Session | null;
  staff: Staff | null;
  hospital: Hospital | null;
} {
  const session = getSession();
  if (!session) return { session: null, staff: null, hospital: null };
  const staff = getStaffAccountById(session.staffId) ?? null;
  if (!staff) {
    // The referenced staff no longer exists (e.g. demo reset) — drop the session.
    writeSession(null);
    return { session: null, staff: null, hospital: null };
  }
  const hospital = getHospitalById(staff.hospital_id) ?? null;
  return { session, staff, hospital };
}

/** Sign in as a staff member; scopes the mock to their hospital. */
export function signIn(staffId: StaffId): Staff {
  const staff = getStaffAccountById(staffId);
  if (!staff) {
    throw new Error(`signIn: staff "${staffId}" not found`);
  }
  setActiveHospitalId(staff.hospital_id);
  writeSession({ staffId: staff.id });
  return staff;
}

/** Clear the session and the active tenant. */
export function signOut(): void {
  writeSession(null);
  setActiveHospitalId(null);
}

export interface SignUpHospitalInput extends CreateHospitalInput {
  /** Full name of the founding admin (the person signing up). */
  admin_full_name: string;
  /** Optional login email for the founding admin. */
  admin_email?: string | null;
}

/**
 * Register a new hospital and its founding admin in one step — the heart of the
 * signup flow. Creates the `hospitals` row (on a trial subscription) and the
 * admin's own `staff` row, then signs them in. Mirrors the Phase 18 Edge
 * Function that will create the hospital + founder `auth.users` + admin staff.
 */
export function signUpHospital(input: SignUpHospitalInput): {
  hospital: Hospital;
  admin: Staff;
} {
  const hospital = createHospital({
    name: input.name,
    region: input.region,
    contact_email: input.contact_email,
    contact_phone: input.contact_phone,
  });
  const admin = createStaff({
    hospital_id: hospital.id,
    full_name: input.admin_full_name,
    role: "admin",
    email: input.admin_email ?? input.contact_email ?? null,
  });
  setActiveHospitalId(hospital.id);
  writeSession({ staffId: admin.id });
  return { hospital, admin };
}
