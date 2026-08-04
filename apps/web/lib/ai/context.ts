/**
 * Server-side context validation + tenant scoping (Phase 22, spec §6).
 *
 * The context bundle arrives FROM THE CLIENT (the device holds the freshest
 * data in this offline-first app), so the server treats it as untrusted
 * input: the route handler zod-parses it, and this module verifies through
 * the caller's RLS-bound Supabase client that the visit/patient actually
 * belong to the caller's hospital.
 *
 * CROSS-HOSPITAL ISOLATION (spec §12): patient data is NEVER pooled across
 * hospitals. Every server-side read here runs through the bearer-token
 * client, so RLS confines it to the caller's own tenant; the model gets its
 * intelligence from its training, not from other tenants' data. If
 * system-wide learning is ever wanted, that is a separate, opt-in,
 * de-identified, aggregate-only project with regulatory sign-off.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Maps to an HTTP status in the route handler. */
export class ScopeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ScopeError";
  }
}

/**
 * Confirm the visit exists in the caller's hospital (RLS makes any other
 * tenant's visit invisible → 404) and that the bundle's patient matches the
 * visit's patient (a mismatch means a hand-crafted payload → 403).
 * Returns the hospital id for logging.
 */
export async function verifyVisitScope(
  supabase: SupabaseClient,
  visitId: string,
  patientId: string,
): Promise<{ hospitalId: string }> {
  const { data, error } = await supabase
    .from("visits")
    .select("id, patient_id, hospital_id")
    .eq("id", visitId)
    .maybeSingle();

  if (error) {
    throw new ScopeError(500, `visit scope check failed: ${error.message}`);
  }
  if (!data) {
    throw new ScopeError(404, "visit not found in your hospital");
  }
  if (data.patient_id !== patientId) {
    throw new ScopeError(403, "context bundle patient does not match the visit");
  }
  return { hospitalId: data.hospital_id as string };
}

/**
 * Same check for Ask CareFlow patient mode, where there may be no visit id —
 * the patient row itself is the scope anchor.
 */
export async function verifyPatientScope(
  supabase: SupabaseClient,
  patientId: string,
): Promise<{ hospitalId: string }> {
  const { data, error } = await supabase
    .from("patients")
    .select("id, hospital_id")
    .eq("id", patientId)
    .maybeSingle();

  if (error) {
    throw new ScopeError(500, `patient scope check failed: ${error.message}`);
  }
  if (!data) {
    throw new ScopeError(404, "patient not found in your hospital");
  }
  return { hospitalId: data.hospital_id as string };
}
