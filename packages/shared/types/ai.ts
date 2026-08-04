/**
 * AI Clinical Assist — shared zod schemas + types (Phase 22).
 *
 * Three kinds of contract live here, all crossing a trust boundary:
 *
 *  1. `PatientContextSchema` — the context bundle the CLIENT assembles from
 *     the on-device store and POSTs to `/api/ai/*`. The device is the source
 *     of freshest truth (offline-first outbox), but the server never trusts
 *     the shape: it zod-parses the bundle and verifies tenant scope via the
 *     bearer-token RLS client before anything reaches the model.
 *
 *  2. `PlanSuggestionSchema` / `ResultsSuggestionSchema` / `AskAnswerSchema` —
 *     the STRUCTURED output the model must return. Route handlers parse the
 *     model's JSON with these; anything malformed → "AI unavailable", never a
 *     crash and never a silent partial suggestion.
 *
 *  3. `CohortQuerySchema` + the column whitelist — the ONLY way Ask CareFlow
 *     (cohort mode) touches data. The model returns a structured filter
 *     object (never SQL); the server validates it against the whitelist and
 *     builds the query with the supabase-js query builder through the
 *     caller's RLS-bound client. Whitelisted columns deliberately exclude
 *     direct identifiers (names, phone, email, national ID) because result
 *     rows are fed back to the model.
 *
 * The one rule that governs everything: the AI never writes to the medical
 * record. See docs/CareFlow-AI-Build-Spec.md (Rev 2).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Per-suggestion confidence — the model must express uncertainty. */
export const ConfidenceSchema = z.enum(["low", "moderate", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Locales the clinician UI supports; free text is returned in this language. */
export const AiLocaleSchema = z.enum(["en", "fr"]);
export type AiLocale = z.infer<typeof AiLocaleSchema>;

/**
 * A safety flag surfaced to the doctor. `critical` renders as a blocking
 * banner that must be acknowledged before accepting a medication. Produced by
 * the model AND by the deterministic server-side allergy check (`source`
 * distinguishes them; the deterministic check can never be overridden by the
 * model's own judgement).
 */
export const AiSafetyFlagSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().max(500),
  source: z.enum(["model", "allergy_check"]).default("model"),
});
export type AiSafetyFlag = z.infer<typeof AiSafetyFlagSchema>;

// ---------------------------------------------------------------------------
// 1. Patient context bundle (device → server → model)
// ---------------------------------------------------------------------------
// Caps are enforced here (server-side parse) so an oversized or hand-crafted
// payload is rejected at the boundary. Free-text fields carry clinical prose;
// direct identifiers (full name, phone, email, national ID) must never be in
// the bundle — the client omits them and the server's redact pass asserts it.

const trimmedString = (max: number) => z.string().max(max);

export const PatientContextSchema = z.object({
  patient: z.object({
    id: z.uuid(),
    /** Initials only — never the full name. */
    initials: z.string().max(8),
    ageYears: z.number().int().min(0).max(130).nullable(),
    sex: trimmedString(20).nullable(),
  }),
  history: z
    .array(
      z.object({
        type: trimmedString(40),
        description: trimmedString(500),
        onset: trimmedString(80).nullable(),
        isActive: z.boolean().nullable(),
      }),
    )
    .max(30),
  allergies: z
    .array(
      z.object({
        substance: trimmedString(200),
        category: trimmedString(40).nullable(),
        reaction: trimmedString(300).nullable(),
        severity: trimmedString(40).nullable(),
      }),
    )
    .max(30),
  visit: z.object({
    id: z.uuid(),
    type: trimmedString(40),
    stage: trimmedString(40),
    chiefComplaint: trimmedString(1000).nullable(),
    triageLevel: z.number().int().min(1).max(5).nullable(),
  }),
  subjective: trimmedString(8000).nullable(),
  examination: trimmedString(8000).nullable(),
  ros: z
    .array(
      z.object({
        system: trimmedString(60),
        question: trimmedString(300),
        answer: trimmedString(300),
      }),
    )
    .max(40),
  vitals: z
    .object({
      spo2: z.number().nullable(),
      pulse: z.number().nullable(),
      bpSystolic: z.number().nullable(),
      bpDiastolic: z.number().nullable(),
      temperatureC: z.number().nullable(),
      weightKg: z.number().nullable(),
      gcs: z.number().nullable(),
      recordedAt: trimmedString(40).nullable(),
    })
    .nullable(),
  orders: z
    .array(
      z.object({
        id: z.uuid(),
        type: trimmedString(40),
        description: trimmedString(500),
        status: trimmedString(40),
      }),
    )
    .max(20),
  results: z
    .array(
      z.object({
        orderId: z.uuid().nullable(),
        orderDescription: trimmedString(500),
        value: trimmedString(1000).nullable(),
        referenceRange: trimmedString(300).nullable(),
        isAbnormal: z.boolean(),
        summary: trimmedString(2000).nullable(),
        /** Storage object path of an attached scan/PDF (server fetches it). */
        attachmentPath: trimmedString(300).nullable(),
      }),
    )
    .max(15),
  existingDiagnoses: z
    .array(
      z.object({
        description: trimmedString(500),
        icd10: trimmedString(20).nullable(),
        isPrimary: z.boolean(),
      }),
    )
    .max(15),
  currentMedications: z
    .array(
      z.object({
        drug: trimmedString(200),
        dose: trimmedString(100).nullable(),
        route: trimmedString(60).nullable(),
        frequency: trimmedString(100).nullable(),
      }),
    )
    .max(20),
});
export type PatientContext = z.infer<typeof PatientContextSchema>;

// ---------------------------------------------------------------------------
// 2. Structured model outputs
// ---------------------------------------------------------------------------

/** Moment 1 — after subjective/ROS: assessment + differential + plan + tests. */
export const PlanSuggestionSchema = z.object({
  assessment: z.object({
    text: z.string().max(4000),
    confidence: ConfidenceSchema,
    rationale: z.string().max(1000),
    sources: z.array(z.string().max(120)).max(20),
  }),
  differential: z
    .array(
      z.object({
        condition: z.string().max(300),
        icd10: z.string().max(20).nullable(),
        likelihood: ConfidenceSchema,
        rationale: z.string().max(600),
      }),
    )
    .max(6),
  plan: z.object({
    text: z.string().max(4000),
    confidence: ConfidenceSchema,
    rationale: z.string().max(1000),
    sources: z.array(z.string().max(120)).max(20),
  }),
  suggestedTests: z
    .array(
      z.object({
        orderType: z.string().max(40),
        description: z.string().max(300),
        reason: z.string().max(600),
      }),
    )
    .max(8),
  insufficientData: z.boolean(),
  notes: z.string().max(1000).nullish(),
});
export type PlanSuggestion = z.infer<typeof PlanSuggestionSchema>;

/** Moment 2 — after results: diagnoses + medications + disposition. */
export const ResultsSuggestionSchema = z.object({
  diagnoses: z
    .array(
      z.object({
        description: z.string().max(500),
        icd10: z.string().max(20).nullable(),
        isPrimary: z.boolean(),
        confidence: ConfidenceSchema,
        rationale: z.string().max(1000),
        sources: z.array(z.string().max(120)).max(20),
      }),
    )
    .max(6),
  medications: z
    .array(
      z.object({
        drugName: z.string().max(200),
        dose: z.string().max(100).nullable(),
        route: z.string().max(60).nullable(),
        frequency: z.string().max(100).nullable(),
        duration: z.string().max(100).nullable(),
        instructions: z.string().max(500).nullable(),
        reason: z.string().max(600),
        confidence: ConfidenceSchema,
      }),
    )
    .max(8),
  disposition: z.object({
    recommendation: z.enum(["admit", "discharge", "observe"]),
    confidence: ConfidenceSchema,
    rationale: z.string().max(1000),
    suggestedWard: z.string().max(120).nullable(),
  }),
  safetyFlags: z.array(AiSafetyFlagSchema).max(20),
  insufficientData: z.boolean(),
});
export type ResultsSuggestion = z.infer<typeof ResultsSuggestionSchema>;

/** Ask CareFlow — the model's answer envelope (both modes). */
export const AskAnswerSchema = z.object({
  answer: z.string().max(8000),
  usedSources: z.array(z.string().max(120)).max(30),
  followUps: z.array(z.string().max(300)).max(4).nullish(),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

// ---------------------------------------------------------------------------
// 3. Cohort mode — structured read-only query intent (never SQL)
// ---------------------------------------------------------------------------

/**
 * Tables + columns the cohort planner may touch. Everything is already
 * `hospital_id`-scoped by RLS; this whitelist additionally excludes direct
 * identifiers because query rows are fed back to the model for summarising.
 * Keys are real table names; values are the full set of selectable/filterable
 * columns.
 */
export const COHORT_TABLE_COLUMNS = {
  visits: [
    "id",
    "visit_type",
    "status",
    "stage",
    "chief_complaint",
    "triage_level",
    "arrived_at",
    "closed_at",
  ],
  diagnoses: ["id", "visit_id", "icd10_code", "description", "is_primary", "created_at"],
  prescriptions: [
    "id",
    "visit_id",
    "drug_name",
    "dose",
    "route",
    "frequency",
    "duration",
    "status",
    "created_at",
  ],
  orders: [
    "id",
    "visit_id",
    "order_type",
    "description",
    "status",
    "created_at",
    "completed_at",
  ],
  results: ["id", "order_id", "value", "reference_range", "is_abnormal", "recorded_at"],
  admissions: [
    "id",
    "visit_id",
    "status",
    "stage",
    "reason",
    "is_medical_cleared",
    "is_financial_cleared",
    "is_pharmacy_ready",
    "admitted_at",
    "discharged_at",
  ],
  treatment_records: [
    "id",
    "visit_id",
    "spo2",
    "pulse",
    "bp_systolic",
    "bp_diastolic",
    "temperature_c",
    "weight_kg",
    "gcs_score",
    "recorded_at",
  ],
  allergies: ["id", "patient_id", "substance", "category", "severity", "created_at"],
} as const;

export type CohortTable = keyof typeof COHORT_TABLE_COLUMNS;
export const COHORT_TABLES = Object.keys(COHORT_TABLE_COLUMNS) as CohortTable[];

/** Filter operators, mapped 1:1 onto supabase-js query-builder methods. */
export const CohortOpSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "ilike",
  "in",
  "is_null",
  "not_null",
]);
export type CohortOp = z.infer<typeof CohortOpSchema>;

const CohortFilterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(25),
]);

// ---------------------------------------------------------------------------
// 4. Request envelopes (device → /api/ai/*)
// ---------------------------------------------------------------------------
// Defined here (not in apps/web) because zod is a dependency of this package,
// and because the request shape is a shared contract between the panel and
// the route handlers.

export const PlanRequestSchema = z.object({
  visitId: z.uuid(),
  locale: AiLocaleSchema.default("en"),
  context: PatientContextSchema,
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const ResultsRequestSchema = PlanRequestSchema;
export type ResultsRequest = z.infer<typeof ResultsRequestSchema>;

export const AskRequestSchema = z.object({
  mode: z.enum(["patient", "cohort"]),
  question: z.string().min(1).max(2000),
  patientId: z.uuid().nullish(),
  locale: AiLocaleSchema.default("en"),
  context: PatientContextSchema.nullish(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const DecisionRequestSchema = z.object({
  decision: z.enum(["accepted", "edited", "dismissed"]),
  acceptedJson: z.unknown().nullish(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/**
 * The structured, read-only query intent the model returns in cohort mode.
 * Shape-validated here; table/column membership is checked by the server's
 * cohort guard against `COHORT_TABLE_COLUMNS` (schema alone can't express
 * "column belongs to the chosen table").
 */
export const CohortQuerySchema = z.object({
  table: z.enum(COHORT_TABLES as [CohortTable, ...CohortTable[]]),
  columns: z.array(z.string().max(64)).min(1).max(12),
  filters: z
    .array(
      z.object({
        column: z.string().max(64),
        op: CohortOpSchema,
        value: CohortFilterValueSchema.nullish(),
      }),
    )
    .max(8)
    .default([]),
  orderBy: z
    .object({ column: z.string().max(64), ascending: z.boolean() })
    .nullish(),
  /** Hard row cap — the guard also enforces it server-side. */
  limit: z.number().int().min(1).max(100).default(50),
  /** v1 supports count-only aggregation; richer aggregates are out of scope. */
  aggregate: z.enum(["count"]).nullish(),
});
export type CohortQuery = z.infer<typeof CohortQuerySchema>;
