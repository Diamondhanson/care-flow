/**
 * Mock provider — canned, schema-valid JSON per feature. Selected with
 * AI_PROVIDER=mock. Lets unit tests and offline development exercise the
 * whole pipeline (validation, safety checks, logging, UI) without a network
 * call or an API key.
 */

import type { AiCall, AiProvider, AiResult } from "./provider";

const MOCK_PLAN = {
  assessment: {
    text: "Consider a lower respiratory tract infection. Clinical picture (fever, productive cough, raised pulse) is compatible with community-acquired pneumonia; malaria remains possible in this setting and should be excluded.",
    confidence: "moderate",
    rationale: "Fever with productive cough and tachycardia; no results yet to confirm.",
    sources: ["subjective", "vitals", "ros:respiratory"],
  },
  differential: [
    {
      condition: "Community-acquired pneumonia",
      icd10: "J18.9",
      likelihood: "moderate",
      rationale: "Fever, productive cough, tachycardia.",
    },
    {
      condition: "Malaria",
      icd10: "B54",
      likelihood: "moderate",
      rationale: "Endemic setting; fever without localising source is common.",
    },
    {
      condition: "Acute bronchitis",
      icd10: "J20.9",
      likelihood: "low",
      rationale: "Possible, but systemic features favour pneumonia.",
    },
  ],
  plan: {
    text: "Consider confirming with a chest X-ray and malaria RDT plus full blood count. Encourage fluids and antipyretics while awaiting results.",
    confidence: "moderate",
    rationale: "Targeted tests separate the two leading possibilities before treatment.",
    sources: ["subjective", "vitals"],
  },
  suggestedTests: [
    { orderType: "imaging", description: "Chest X-ray", reason: "Confirm or exclude consolidation" },
    { orderType: "lab", description: "Malaria RDT", reason: "Exclude malaria as the febrile source" },
    { orderType: "lab", description: "Full Blood Count", reason: "Assess for bacterial infection" },
  ],
  insufficientData: false,
  notes: "Mock suggestion — generated without a model call.",
};

const MOCK_RESULTS = {
  diagnoses: [
    {
      description: "Community-acquired pneumonia",
      icd10: "J18.9",
      isPrimary: true,
      confidence: "moderate",
      rationale: "Raised WBC with abnormal result flagged; clinical picture compatible.",
      sources: ["result:Full Blood Count", "subjective"],
    },
  ],
  medications: [
    {
      drugName: "Amoxicillin",
      dose: "500 mg",
      route: "oral",
      frequency: "every 8 hours",
      duration: "7 days",
      instructions: "Take with food.",
      reason: "First-line oral therapy for community-acquired pneumonia.",
      confidence: "moderate",
    },
    {
      drugName: "Paracetamol",
      dose: "1 g",
      route: "oral",
      frequency: "every 6 hours as needed",
      duration: "3 days",
      instructions: "Maximum 4 g in 24 hours.",
      reason: "Antipyretic / analgesic support.",
      confidence: "high",
    },
  ],
  disposition: {
    recommendation: "discharge",
    confidence: "moderate",
    rationale: "Stable vitals and oral therapy appropriate; review if deterioration.",
    suggestedWard: null,
  },
  safetyFlags: [],
  insufficientData: false,
};

const MOCK_ASK = {
  answer:
    "Mock answer: based only on the recorded data, the patient has one open visit with fever and cough documented in the subjective note; no abnormal vitals were recorded today.",
  usedSources: ["subjective", "vitals"],
  followUps: ["Were any orders placed this visit?", "Any recorded allergies?"],
};

const MOCK_COHORT_PLAN = {
  table: "diagnoses",
  columns: ["description", "icd10_code", "created_at"],
  filters: [{ column: "description", op: "ilike", value: "%malaria%" }],
  orderBy: { column: "created_at", ascending: false },
  limit: 50,
  aggregate: null,
};

export class MockProvider implements AiProvider {
  readonly name = "mock";

  constructor(readonly model: string) {}

  async complete(call: AiCall): Promise<AiResult> {
    const canned =
      call.tag === "plan"
        ? MOCK_PLAN
        : call.tag === "results"
          ? MOCK_RESULTS
          : call.tag === "ask_cohort_plan"
            ? MOCK_COHORT_PLAN
            : MOCK_ASK;
    return {
      text: JSON.stringify(canned),
      promptTokens: 0,
      outputTokens: 0,
    };
  }
}
