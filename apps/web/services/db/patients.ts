/**
 * Patients — demographics reads & search, the patient-level allergy safety
 * record, emergency-intake helpers, and anonymous-identity reconciliation.
 */

import type {
  Allergy,
  AllergyCategory,
  AllergyId,
  AllergySeverity,
  MaritalStatus,
  Patient,
  PatientId,
  StaffId,
  Visit,
} from "@careflow/shared";
import { CreatePatientInputSchema } from "@careflow/shared/validation/schemas";
import { generateId, generatePatientId, nowISO, uniquePatientId } from "./shared";
import { loadDatabase, persist } from "./engine";
import { loadScoped } from "./tenancy";

export interface CreatePatientInput {
  full_name: string;
  date_of_birth?: string | null;
  sex?: Patient["sex"];
  phone?: string | null;
  address?: string | null;
  national_id?: string | null;
  /** Mother's first name — supplies the patient ID's trailing initial. */
  mother_first_name?: string | null;
  is_emergency_anonymous?: boolean;
  /** If omitted for an emergency intake, one is generated automatically. */
  anonymous_identifier?: string;
  /** Demographic context (Phase 21) — all optional at intake. */
  occupation?: string | null;
  marital_status?: MaritalStatus;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

export interface AddAllergyInput {
  substance: string;
  category?: AllergyCategory;
  severity?: AllergySeverity;
  reaction?: string | null;
  noted_by_id?: StaffId | null;
}

// ---------------------------------------------------------------------------
// Emergency-intake helpers
// ---------------------------------------------------------------------------

const GREEK_TAGS = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
];

/**
 * Generate a human-readable anonymous tracking identifier for an unconscious /
 * unidentified emergency intake, e.g. "John Doe - Gamma - 20260531".
 */
export function generateAnonymousIdentifier(seedIndex?: number): string {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const tag =
    typeof seedIndex === "number"
      ? GREEK_TAGS[seedIndex % GREEK_TAGS.length]
      : GREEK_TAGS[Math.floor(Math.random() * GREEK_TAGS.length)];
  return `John Doe - ${tag} - ${stamp}`;
}

export function getPatients(): Patient[] {
  return loadScoped().patients;
}

export function getPatientById(id: PatientId): Patient | undefined {
  return loadScoped().patients.find((p) => p.id === id);
}

/**
 * Global patient lookup for the "find my patient" front door. Matches on name,
 * hospital number (MRN / booklet number), national ID, phone, or the temporary
 * anonymous identifier — case-insensitive substring. Returns the best matches,
 * MRN/exact-prefix hits first, capped at `limit`.
 */
export function searchPatients(query: string, limit = 8): Patient[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = loadScoped().patients.filter((p) => {
    const haystacks = [
      p.full_name,
      p.mrn ?? "",
      p.national_id ?? "",
      p.phone ?? "",
      p.anonymous_identifier ?? "",
    ];
    return haystacks.some((h) => h.toLowerCase().includes(q));
  });
  // Rank: hospital-number / name prefix matches before mid-string matches.
  const score = (p: Patient): number => {
    const mrn = (p.mrn ?? "").toLowerCase();
    const name = p.full_name.toLowerCase();
    if (mrn === q || name === q) return 0;
    if (mrn.startsWith(q) || name.startsWith(q)) return 1;
    if (mrn.includes(q) || name.includes(q)) return 2;
    return 3;
  };
  return matches
    .sort((a, b) => score(a) - score(b) || a.full_name.localeCompare(b.full_name))
    .slice(0, limit);
}

/** A patient's allergy records, most-recently noted first. */
export function getAllergiesForPatient(patientId: PatientId): Allergy[] {
  return loadScoped()
    .allergies.filter((a) => a.patient_id === patientId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ---------------------------------------------------------------------------
// Mutations — allergies (patient-level safety record)
// ---------------------------------------------------------------------------

/**
 * Record an allergy against a patient. Recording any allergy clears the
 * "no known allergies" flag — the two states are mutually exclusive. Returns
 * the created record.
 */
export function addAllergy(
  patientId: PatientId,
  input: AddAllergyInput
): Allergy {
  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`addAllergy: patient "${patientId}" not found`);
  }
  const substance = input.substance.trim();
  if (!substance) {
    throw new Error("addAllergy: a substance is required");
  }

  const timestamp = nowISO();
  const allergy: Allergy = {
    id: generateId() as AllergyId,
    hospital_id: patient.hospital_id,
    patient_id: patientId,
    substance,
    category: input.category ?? "drug",
    severity: input.severity ?? "moderate",
    reaction: input.reaction?.trim() || null,
    noted_by_id: input.noted_by_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.allergies.push(allergy);
  // An actual allergy and "no known allergies" cannot coexist.
  patient.no_known_allergies = false;
  patient.updated_at = timestamp;
  persist(db);
  return allergy;
}

/** Remove an allergy record (e.g. entered in error). */
export function removeAllergy(allergyId: AllergyId): void {
  const db = loadDatabase();
  const allergy = db.allergies.find((a) => a.id === allergyId);
  if (!allergy) return;
  db.allergies = db.allergies.filter((a) => a.id !== allergyId);
  const patient = db.patients.find((p) => p.id === allergy.patient_id);
  if (patient) patient.updated_at = nowISO();
  persist(db);
}

/**
 * Mark a patient as having no known allergies — an active clinical confirmation,
 * distinct from an empty list that simply hasn't been asked. Clearing the flag
 * returns the patient to the "not yet assessed" state. Returns the patient.
 */
export function markNoKnownAllergies(
  patientId: PatientId,
  value = true
): Patient {
  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`markNoKnownAllergies: patient "${patientId}" not found`);
  }
  patient.no_known_allergies = value;
  patient.updated_at = nowISO();
  persist(db);
  return patient;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Real identity details captured when an anonymous record is reconciled. */
export interface CompleteAnonymousInput {
  full_name: string;
  sex?: Patient["sex"];
  date_of_birth?: string | null;
  phone?: string | null;
  national_id?: string | null;
  mother_first_name?: string | null;
}

/**
 * Give an unidentified emergency patient their real identity in place — the
 * common case where the unconscious arrival turns out to be a brand-new patient.
 *
 * Unlike {@link reconcileAnonymousProfile} (which folds the record into an
 * already-registered patient), this keeps the same Patient row — so every visit,
 * admission and clinical record stays attached untouched — and simply fills in
 * the real details, mints the Cameroon patient ID, and flips the record from
 * anonymous to verified. Accepts either the anonymous Patient.id or its
 * `anonymous_identifier`.
 */
export function completeAnonymousProfile(
  anonymousId: PatientId | string,
  details: CompleteAnonymousInput
): Patient {
  const db = loadDatabase();

  const patient = db.patients.find(
    (p) =>
      p.is_emergency_anonymous &&
      (p.id === anonymousId || p.anonymous_identifier === anonymousId)
  );
  if (!patient) {
    throw new Error(
      `completeAnonymousProfile: anonymous patient "${anonymousId}" not found`
    );
  }

  patient.full_name = details.full_name;
  patient.sex = details.sex ?? patient.sex;
  patient.date_of_birth = details.date_of_birth ?? null;
  patient.phone = details.phone ?? null;
  patient.national_id = details.national_id ?? null;
  patient.mother_first_name = details.mother_first_name ?? null;
  // Now a verified record: mint the human-facing patient ID and drop the
  // anonymous tracking tag.
  patient.is_emergency_anonymous = false;
  patient.anonymous_identifier = null;
  patient.mrn = uniquePatientId(
    generatePatientId(
      patient.date_of_birth,
      patient.full_name,
      patient.mother_first_name
    ),
    db.patients.filter((p) => p.id !== patient.id).map((p) => p.mrn ?? "")
  );
  patient.updated_at = nowISO();

  persist(db);
  return patient;
}

/**
 * Merge an unidentified emergency patient into a verified permanent profile.
 *
 * The anonymous patient's visits and admissions (and, transitively, their
 * clinical records, which key off the visit) are re-pointed at the real patient.
 * The anonymous placeholder record is then removed. Accepts either the anonymous
 * Patient.id or its `anonymous_identifier`.
 */
export function reconcileAnonymousProfile(
  anonymousId: PatientId | string,
  realPatientId: PatientId
): { patient: Patient; reassignedVisits: Visit[] } {
  const db = loadDatabase();

  const anonymous = db.patients.find(
    (p) =>
      p.is_emergency_anonymous &&
      (p.id === anonymousId || p.anonymous_identifier === anonymousId)
  );
  if (!anonymous) {
    throw new Error(
      `reconcileAnonymousProfile: anonymous patient "${anonymousId}" not found`
    );
  }

  const realPatient = db.patients.find((p) => p.id === realPatientId);
  if (!realPatient) {
    throw new Error(
      `reconcileAnonymousProfile: target patient "${realPatientId}" not found`
    );
  }

  const timestamp = nowISO();

  // Re-point the anonymous patient's visits to the verified profile. The
  // clinical record (consultations, vitals, etc.) follows automatically since it
  // keys off visit_id.
  const reassignedVisits: Visit[] = [];
  for (const visit of db.visits) {
    if (visit.patient_id === anonymous.id) {
      visit.patient_id = realPatient.id;
      visit.updated_at = timestamp;
      reassignedVisits.push(visit);
    }
  }

  // Re-point admissions too (they carry their own patient_id).
  for (const admission of db.admissions) {
    if (admission.patient_id === anonymous.id) {
      admission.patient_id = realPatient.id;
      admission.updated_at = timestamp;
    }
  }

  // Carry any allergies recorded under the placeholder onto the real profile.
  for (const allergy of db.allergies) {
    if (allergy.patient_id === anonymous.id) {
      allergy.patient_id = realPatient.id;
      allergy.updated_at = timestamp;
    }
  }

  // Re-point transfer history (it carries its own patient_id).
  for (const transfer of db.transfers) {
    if (transfer.patient_id === anonymous.id) {
      transfer.patient_id = realPatient.id;
    }
  }

  // Standard registration always assigns the verified profile a patient ID, but
  // if reconciliation ever targets a record that lacks one, mint it now from the
  // identity details that the merge just confirmed.
  if (!realPatient.mrn) {
    realPatient.mrn = uniquePatientId(
      generatePatientId(
        realPatient.date_of_birth ?? null,
        realPatient.full_name,
        realPatient.mother_first_name ?? null,
      ),
      db.patients.filter((p) => p.id !== realPatient.id).map((p) => p.mrn ?? ""),
    );
  }

  realPatient.updated_at = timestamp;

  // Drop the anonymous placeholder now that its clinical history is merged.
  db.patients = db.patients.filter((p) => p.id !== anonymous.id);

  persist(db);
  return { patient: realPatient, reassignedVisits };
}

// ---------------------------------------------------------------------------
// Mutations — demographics (Phase 21)
// ---------------------------------------------------------------------------

export interface UpdatePatientDemographicsInput {
  occupation?: string | null;
  marital_status?: MaritalStatus;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

/**
 * Review-and-update the demographic context captured at intake (occupation,
 * marital status, emergency contact) — the Background panel's edit path for
 * patients registered before these fields existed, or whose details changed.
 */
export function updatePatientDemographics(
  patientId: PatientId,
  input: UpdatePatientDemographicsInput
): Patient {
  CreatePatientInputSchema.pick({
    occupation: true,
    marital_status: true,
    emergency_contact_name: true,
    emergency_contact_phone: true,
  }).parse(input);

  const db = loadDatabase();
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) {
    throw new Error(`updatePatientDemographics: patient "${patientId}" not found`);
  }

  if (input.occupation !== undefined) {
    patient.occupation = input.occupation?.trim() || null;
  }
  if (input.marital_status !== undefined) {
    patient.marital_status = input.marital_status;
  }
  if (input.emergency_contact_name !== undefined) {
    patient.emergency_contact_name = input.emergency_contact_name?.trim() || null;
  }
  if (input.emergency_contact_phone !== undefined) {
    patient.emergency_contact_phone = input.emergency_contact_phone?.trim() || null;
  }
  patient.updated_at = nowISO();
  persist(db);
  return patient;
}
