import { describe, expect, it } from "vitest";

import {
  AskAnswerSchema,
  COHORT_TABLE_COLUMNS,
  CohortQuerySchema,
  PatientContextSchema,
  PlanSuggestionSchema,
  ResultsSuggestionSchema,
} from "./ai";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

const validContext = {
  patient: { id: UUID, initials: "JD", ageYears: 34, sex: "male" },
  history: [
    { type: "past_medical", description: "Type 2 diabetes", onset: "2015", isActive: true },
  ],
  allergies: [
    { substance: "Penicillin", category: "drug", reaction: "Rash", severity: "moderate" },
  ],
  visit: {
    id: UUID,
    type: "outpatient",
    stage: "consultation",
    chiefComplaint: "Fever and cough",
    triageLevel: 3,
  },
  subjective: "3 days of fever, productive cough.",
  examination: null,
  ros: [{ system: "respiratory", question: "Cough?", answer: "Yes, productive" }],
  vitals: {
    spo2: 96,
    pulse: 92,
    bpSystolic: 120,
    bpDiastolic: 80,
    temperatureC: 38.4,
    weightKg: 70,
    gcs: null,
    recordedAt: "2026-08-01T10:00:00.000Z",
  },
  orders: [{ id: UUID, type: "lab", description: "Full Blood Count", status: "requested" }],
  results: [
    {
      orderId: UUID,
      orderDescription: "Full Blood Count",
      value: "WBC 14.2",
      referenceRange: "4.0-11.0",
      isAbnormal: true,
      summary: null,
      attachmentPath: null,
    },
  ],
  existingDiagnoses: [{ description: "Malaria", icd10: "B54", isPrimary: true }],
  currentMedications: [{ drug: "Metformin", dose: "500 mg", route: "oral", frequency: "bd" }],
};

const validPlan = {
  assessment: {
    text: "Consider community-acquired pneumonia.",
    confidence: "moderate",
    rationale: "Fever, productive cough, raised WBC.",
    sources: ["subjective", "result:FBC"],
  },
  differential: [
    {
      condition: "Community-acquired pneumonia",
      icd10: "J18.9",
      likelihood: "moderate",
      rationale: "Fever + cough + leukocytosis.",
    },
  ],
  plan: {
    text: "Consider chest X-ray and empiric antibiotics per local guidance.",
    confidence: "moderate",
    rationale: "Confirm consolidation before treatment.",
    sources: ["subjective", "vitals"],
  },
  suggestedTests: [
    { orderType: "imaging", description: "Chest X-ray", reason: "Confirm consolidation" },
  ],
  insufficientData: false,
};

const validResults = {
  diagnoses: [
    {
      description: "Community-acquired pneumonia",
      icd10: "J18.9",
      isPrimary: true,
      confidence: "moderate",
      rationale: "Consolidation on CXR.",
      sources: ["result:CXR"],
    },
  ],
  medications: [
    {
      drugName: "Amoxicillin",
      dose: "500 mg",
      route: "oral",
      frequency: "every 8 hours",
      duration: "7 days",
      instructions: null,
      reason: "First-line for CAP",
      confidence: "moderate",
    },
  ],
  disposition: {
    recommendation: "discharge",
    confidence: "moderate",
    rationale: "Stable vitals, oral therapy appropriate.",
    suggestedWard: null,
  },
  safetyFlags: [
    { severity: "critical", message: "Penicillin allergy recorded.", source: "allergy_check" },
  ],
  insufficientData: false,
};

// ---------------------------------------------------------------------------

describe("PatientContextSchema", () => {
  it("accepts a well-formed bundle", () => {
    expect(PatientContextSchema.safeParse(validContext).success).toBe(true);
  });

  it("rejects a non-uuid visit id", () => {
    const bad = { ...validContext, visit: { ...validContext.visit, id: "nope" } };
    expect(PatientContextSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects oversized arrays (caps enforced)", () => {
    const bad = {
      ...validContext,
      ros: Array.from({ length: 41 }, () => validContext.ros[0]),
    };
    expect(PatientContextSchema.safeParse(bad).success).toBe(false);
  });
});

describe("model output schemas", () => {
  it("accepts a valid PlanSuggestion", () => {
    expect(PlanSuggestionSchema.safeParse(validPlan).success).toBe(true);
  });

  it("rejects a PlanSuggestion with an unknown confidence", () => {
    const bad = {
      ...validPlan,
      assessment: { ...validPlan.assessment, confidence: "certain" },
    };
    expect(PlanSuggestionSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a valid ResultsSuggestion and defaults flag source", () => {
    const parsed = ResultsSuggestionSchema.parse(validResults);
    expect(parsed.disposition.recommendation).toBe("discharge");
  });

  it("rejects a disposition outside admit/discharge/observe", () => {
    const bad = {
      ...validResults,
      disposition: { ...validResults.disposition, recommendation: "transfer" },
    };
    expect(ResultsSuggestionSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a minimal AskAnswer", () => {
    expect(
      AskAnswerSchema.safeParse({ answer: "Not recorded.", usedSources: [] }).success,
    ).toBe(true);
  });
});

describe("CohortQuerySchema", () => {
  it("accepts a valid filter object and applies defaults", () => {
    const parsed = CohortQuerySchema.parse({
      table: "diagnoses",
      columns: ["description", "created_at"],
      filters: [{ column: "description", op: "ilike", value: "%malaria%" }],
    });
    expect(parsed.limit).toBe(50);
    expect(parsed.filters).toHaveLength(1);
  });

  it("rejects an un-whitelisted table", () => {
    expect(
      CohortQuerySchema.safeParse({ table: "patients", columns: ["full_name"] }).success,
    ).toBe(false);
  });

  it("rejects a limit above the hard cap", () => {
    expect(
      CohortQuerySchema.safeParse({
        table: "visits",
        columns: ["id"],
        limit: 5000,
      }).success,
    ).toBe(false);
  });

  it("whitelist never contains direct identifiers", () => {
    const banned = ["full_name", "phone", "email", "national_id", "address", "mrn"];
    for (const cols of Object.values(COHORT_TABLE_COLUMNS)) {
      for (const col of cols) {
        expect(banned).not.toContain(col);
      }
    }
  });
});
