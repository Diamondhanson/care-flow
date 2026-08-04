import { describe, expect, it } from "vitest";

import { PatientContextSchema } from "@careflow/shared/types/ai";
import type {
  Allergy,
  Consultation,
  Patient,
  Prescription,
  RosResponse,
  TreatmentRecord,
  Visit,
} from "@careflow/shared";

import {
  buildPatientContextFromRows,
  hashContext,
  type PatientContextRows,
} from "@/lib/ai/client-context";

/** Test sugar: brand plain strings as entity ids (same trick as mockStorage.test.ts). */
const brand = <T,>(v: string): T => v as unknown as T;

const NOW = new Date("2026-08-04T12:00:00.000Z").getTime();
const UUID_P = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const UUID_V = "7f9619ff-8b86-4d01-b42d-00cf4fc964aa";

function fixtureRows(): PatientContextRows {
  const patient = {
    id: brand<Patient["id"]>(UUID_P),
    hospital_id: brand<Patient["hospital_id"]>("h1"),
    mrn: "981120JD - N",
    full_name: "Jane Doe",
    date_of_birth: "1998-11-20",
    mother_first_name: "Ngo",
    sex: "female",
    phone: "+237600000000",
    address: "Douala",
    national_id: "CM-123",
    is_emergency_anonymous: false,
    anonymous_identifier: null,
    no_known_allergies: false,
    occupation: null,
    marital_status: "unknown",
    emergency_contact_name: null,
    emergency_contact_phone: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Patient;

  const visit = {
    id: brand<Visit["id"]>(UUID_V),
    hospital_id: brand<Visit["hospital_id"]>("h1"),
    patient_id: patient.id,
    visit_type: "outpatient",
    status: "open",
    stage: "consultation",
    department_id: null,
    attending_doctor_id: null,
    registered_by_id: null,
    chief_complaint: "Fever and cough",
    triage_notes: null,
    triage_level: 3,
    arrived_at: "2026-08-04T09:00:00.000Z",
    closed_at: null,
    created_at: "2026-08-04T09:00:00.000Z",
    updated_at: "2026-08-04T09:00:00.000Z",
  } as unknown as Visit;

  const consultation = {
    id: "c1",
    hospital_id: "h1",
    visit_id: visit.id,
    doctor_id: null,
    subjective: "3 days of fever and productive cough.",
    examination: "Crackles right base.",
    assessment: null,
    plan: null,
    ros_summary: "Respiratory: productive cough.",
    created_at: "2026-08-04T10:00:00.000Z",
    updated_at: "2026-08-04T10:00:00.000Z",
  } as unknown as Consultation;

  const vitalsOld = {
    id: "tr1",
    visit_id: visit.id,
    spo2: 99,
    pulse: 70,
    bp_systolic: 110,
    bp_diastolic: 70,
    temperature_c: 36.8,
    weight_kg: 60,
    gcs_score: null,
    recorded_at: "2026-08-04T09:10:00.000Z",
  } as unknown as TreatmentRecord;

  const vitalsNew = {
    ...vitalsOld,
    id: "tr2",
    spo2: 95,
    pulse: 96,
    temperature_c: 38.6,
    recorded_at: "2026-08-04T11:30:00.000Z",
  } as unknown as TreatmentRecord;

  return {
    visit,
    patient,
    allergies: [
      {
        id: "a1",
        patient_id: patient.id,
        substance: "Penicillin",
        category: "drug",
        severity: "severe",
        reaction: "Rash",
      } as unknown as Allergy,
    ],
    history: [],
    consultations: [consultation],
    ros: Array.from(
      { length: 30 },
      (_, i) =>
        ({
          id: `r${i}`,
          system: "respiratory",
          question_text: `Question ${i}?`,
          answer_label: `Answer ${i}`,
        }) as unknown as RosResponse,
    ),
    vitals: [vitalsNew, vitalsOld],
    orders: [],
    results: [],
    diagnoses: [],
    prescriptions: [
      {
        id: "rx1",
        drug_name: "Metformin",
        dose: "500 mg",
        route: "oral",
        frequency: "bd",
        status: "active",
      } as unknown as Prescription,
      {
        id: "rx2",
        drug_name: "Old drug",
        dose: null,
        route: null,
        frequency: null,
        status: "discontinued",
      } as unknown as Prescription,
    ],
    nowMs: NOW,
  };
}

describe("buildPatientContextFromRows", () => {
  it("builds a bundle that passes the shared server-side schema", () => {
    const ctx = buildPatientContextFromRows(fixtureRows());
    const parsed = PatientContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);
  });

  it("carries initials + age, never the name or contact details", () => {
    const ctx = buildPatientContextFromRows(fixtureRows());
    expect(ctx.patient.initials).toBe("JD");
    expect(ctx.patient.ageYears).toBe(27);
    expect(JSON.stringify(ctx)).not.toMatch(/Jane|Doe|\+237|CM-123|Douala|981120|Ngo/);
  });

  it("uses the latest consultation and the most recent vitals", () => {
    const ctx = buildPatientContextFromRows(fixtureRows());
    expect(ctx.subjective).toContain("productive cough");
    expect(ctx.vitals?.temperatureC).toBe(38.6);
    expect(ctx.vitals?.spo2).toBe(95);
  });

  it("caps the ROS list at 20, keeping the most recent answers", () => {
    const ctx = buildPatientContextFromRows(fixtureRows());
    expect(ctx.ros).toHaveLength(20);
    expect(ctx.ros[19]!.answer).toBe("Answer 29");
  });

  it("includes only active medications", () => {
    const ctx = buildPatientContextFromRows(fixtureRows());
    expect(ctx.currentMedications).toHaveLength(1);
    expect(ctx.currentMedications[0]!.drug).toBe("Metformin");
  });

  it("falls back to PT initials for anonymous patients", () => {
    const rows = fixtureRows();
    rows.patient = {
      ...rows.patient,
      is_emergency_anonymous: true,
      anonymous_identifier: "John Doe - Gamma - 20260531",
    } as unknown as PatientContextRows["patient"];
    const ctx = buildPatientContextFromRows(rows);
    expect(ctx.patient.initials).toBe("JDG");
  });
});

describe("hashContext", () => {
  it("is stable for identical bundles and changes when content changes", () => {
    const a = buildPatientContextFromRows(fixtureRows());
    const b = buildPatientContextFromRows(fixtureRows());
    expect(hashContext(a)).toBe(hashContext(b));

    const rows = fixtureRows();
    rows.consultations = [];
    const c = buildPatientContextFromRows(rows);
    expect(hashContext(c)).not.toBe(hashContext(a));
  });
});
