/**
 * Prompt templates (Phase 22, spec §7). One system prompt for every feature;
 * the task block varies. All prompts demand STRUCTURED JSON only — the route
 * handler zod-parses the reply and retries once on malformed output, so the
 * prompts describe the exact shape in plain text.
 */

import type { AiLocale, PatientContext } from "@careflow/shared/types/ai";
import { COHORT_TABLE_COLUMNS } from "@careflow/shared/types/ai";

const LOCALE_NAME: Record<AiLocale, string> = { en: "English", fr: "French" };

export function systemPrompt(locale: AiLocale): string {
  return `You are a clinical decision-support assistant inside CareFlow, a hospital
operations system. You assist a licensed clinician who makes every final
decision. You are suggestive, never authoritative.

Rules:
- You do NOT diagnose or prescribe on your own. You propose options for the
  clinician to accept, edit, or reject. Use suggestive language ("Consider…").
- Use ONLY the patient data provided. Never invent findings, results, or
  history.
- If the data is insufficient for a safe suggestion, say so and set
  insufficientData=true. Do not guess.
- For every suggestion give a short rationale (1-2 sentences) and list the
  data fields you used (the "sources"), e.g. "subjective", "vitals",
  "allergies", "ros:<system>", "result:<order description>".
- Give a confidence level ("low" | "moderate" | "high") and prefer caution.
- Always consider the patient's allergies and current medications before
  suggesting any drug.
- Reply ONLY with JSON that matches the requested shape. No prose, no
  markdown fences, nothing outside the JSON object.
- Free-text values shown to the clinician must be written in ${LOCALE_NAME[locale]}.`;
}

// ---------------------------------------------------------------------------
// JSON shapes, described in plain text (the strict gate is zod server-side).
// ---------------------------------------------------------------------------

const PLAN_SHAPE = `{
  "assessment": { "text": string, "confidence": "low"|"moderate"|"high", "rationale": string, "sources": string[] },
  "differential": [ { "condition": string, "icd10": string|null, "likelihood": "low"|"moderate"|"high", "rationale": string } ],
  "plan": { "text": string, "confidence": "low"|"moderate"|"high", "rationale": string, "sources": string[] },
  "suggestedTests": [ { "orderType": "lab"|"imaging"|"procedure", "description": string, "reason": string } ],
  "insufficientData": boolean,
  "notes": string|null
}
Limits: differential max 6, suggestedTests max 8.`;

const RESULTS_SHAPE = `{
  "diagnoses": [ { "description": string, "icd10": string|null, "isPrimary": boolean, "confidence": "low"|"moderate"|"high", "rationale": string, "sources": string[] } ],
  "medications": [ { "drugName": string, "dose": string|null, "route": string|null, "frequency": string|null, "duration": string|null, "instructions": string|null, "reason": string, "confidence": "low"|"moderate"|"high" } ],
  "disposition": { "recommendation": "admit"|"discharge"|"observe", "confidence": "low"|"moderate"|"high", "rationale": string, "suggestedWard": string|null },
  "safetyFlags": [ { "severity": "info"|"warning"|"critical", "message": string, "source": "model" } ],
  "insufficientData": boolean
}
Limits: diagnoses max 6, medications max 8, safetyFlags max 20.`;

const ASK_SHAPE = `{
  "answer": string,
  "usedSources": string[],
  "followUps": string[]|null
}
Limits: followUps max 4.`;

const COHORT_QUERY_SHAPE = `{
  "table": string,
  "columns": string[],
  "filters": [ { "column": string, "op": "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"ilike"|"in"|"is_null"|"not_null", "value": string|number|boolean|array|null } ],
  "orderBy": { "column": string, "ascending": boolean } | null,
  "limit": number,
  "aggregate": "count" | null
}
Limits: columns max 12, filters max 8, limit max 100.`;

// ---------------------------------------------------------------------------
// Task blocks
// ---------------------------------------------------------------------------

export function buildPlanPrompt(ctx: PatientContext): string {
  return `TASK — Moment 1 (after the subjective and review of systems):
Based on the patient context below, propose (1) a clinical assessment, (2) a
short ranked differential, (3) a plan, and (4) recommended tests that would
confirm or exclude the leading possibilities. The clinician will review every
item; nothing you output is applied automatically.

PATIENT CONTEXT (the only data you may use):
${JSON.stringify(ctx)}

Reply ONLY with JSON of this exact shape:
${PLAN_SHAPE}`;
}

export function buildResultsPrompt(ctx: PatientContext, attachmentCount: number): string {
  return `TASK — Moment 2 (test results are now available${attachmentCount > 0 ? `, including ${attachmentCount} attached image(s)/document(s)` : ""}):
Based on the patient context below — paying particular attention to the
"results" array${attachmentCount > 0 ? " and the attached files" : ""} — propose (1) diagnosis(es) with ICD-10 where
possible, (2) medication options checked against the patient's allergies and
current medications, and (3) an admit / observe / discharge recommendation.
Raise safetyFlags for any interaction, contraindication, or allergy concern
you can see. The clinician decides everything.

PATIENT CONTEXT (the only data you may use):
${JSON.stringify(ctx)}

Reply ONLY with JSON of this exact shape:
${RESULTS_SHAPE}`;
}

export function buildAskPatientPrompt(ctx: PatientContext, question: string): string {
  return `TASK — Ask CareFlow (single patient, read-only):
Answer the clinician's question using ONLY this patient's recorded data
below. Cite which parts you used in "usedSources". If the question asks for
something not present in the data, say clearly that it is not recorded —
never infer or invent. Suggest up to 4 natural follow-up questions.

CLINICIAN'S QUESTION:
${question}

PATIENT RECORD (the only data you may use):
${JSON.stringify(ctx)}

Reply ONLY with JSON of this exact shape:
${ASK_SHAPE}`;
}

export function buildCohortPlanPrompt(question: string): string {
  return `TASK — Ask CareFlow (cohort, step 1 of 2 — plan a read-only query):
The clinician asked a question about a group of patients. You cannot touch
the database; instead, return ONE structured read-only query intent that the
server will validate and execute. Pick exactly one table and only columns
that belong to it, from this whitelist (table → allowed columns):

${JSON.stringify(COHORT_TABLE_COLUMNS)}

Notes:
- Timestamps are ISO strings; filter date ranges with "gte"/"lte" on the
  table's timestamp column.
- Use "ilike" with % wildcards for free-text matching (e.g. a diagnosis name).
- If the question only needs a number, set "aggregate": "count".
- Row limit is 100 maximum; prefer 50.

CLINICIAN'S QUESTION:
${question}

Reply ONLY with JSON of this exact shape:
${COHORT_QUERY_SHAPE}`;
}

export function buildCohortAnswerPrompt(
  question: string,
  queryPreview: string,
  rows: unknown[],
  totalCount: number | null,
): string {
  return `TASK — Ask CareFlow (cohort, step 2 of 2 — summarise the rows):
A validated read-only query has already been executed against the hospital's
own records. Summarise what the rows show, in plain language, as a direct
answer to the clinician's question. Mention concrete numbers. If the rows
cannot answer the question, say so plainly. Do not speculate beyond the rows.

CLINICIAN'S QUESTION:
${question}

QUERY THAT RAN:
${queryPreview}
${totalCount !== null ? `TOTAL MATCHING ROWS: ${totalCount}` : ""}

ROWS (may be capped):
${JSON.stringify(rows)}

Reply ONLY with JSON of this exact shape:
${ASK_SHAPE}
For "usedSources", cite the table and columns you drew on (e.g. "diagnoses.description").`;
}
