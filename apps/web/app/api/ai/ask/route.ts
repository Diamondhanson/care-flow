/**
 * POST /api/ai/ask — Ask CareFlow (Phase 22, spec §8 + §11). Read-only.
 *
 * patient mode (doctor/nurse/admin): answers from the on-device bundle the
 *   client sent — the freshest record — after scope verification + redaction.
 *
 * cohort mode (doctor/admin only): two model steps around one guarded read:
 *   1. the model plans a STRUCTURED filter object (never SQL),
 *   2. the guard validates it against the whitelist and runs it through the
 *      caller's RLS-bound client,
 *   3. the model summarises the returned rows in plain language.
 */

import {
  AskAnswerSchema,
  AskRequestSchema,
  type PatientContext,
} from "@careflow/shared/types/ai";

import { ScopeError, verifyPatientScope } from "@/lib/ai/context";
import {
  CohortGuardError,
  describeCohortQuery,
  runCohortQuery,
  validateCohortQuery,
} from "@/lib/ai/cohort-guard";
import { callModelJson, jsonError, logInteraction } from "@/lib/ai/handler-utils";
import {
  buildAskPatientPrompt,
  buildCohortAnswerPrompt,
  buildCohortPlanPrompt,
  systemPrompt,
} from "@/lib/ai/prompts";
import { AiProviderError, getProvider, isAiEnabledServer } from "@/lib/ai/provider";
import { redactContext } from "@/lib/ai/redact";
import { AuthError, requireStaff, type CallerIdentity } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAiEnabledServer()) return jsonError(503, "ai_disabled");

  try {
    const parsed = AskRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, "bad_request", parsed.error.message);
    }
    const body = parsed.data;

    if (body.mode === "patient") {
      const caller = await requireStaff(request, ["doctor", "nurse", "admin"]);
      if (!body.patientId || !body.context) {
        return jsonError(400, "bad_request", "patient mode requires patientId + context");
      }
      if (body.context.patient.id !== body.patientId) {
        return jsonError(400, "bad_request", "context patient does not match patientId");
      }
      return await askPatient(caller, body.patientId, body.context, body.question, body.locale);
    }

    // Cohort research is role-gated tighter than per-patient care.
    const caller = await requireStaff(request, ["doctor", "admin"]);
    return await askCohort(caller, body.question, body.locale);
  } catch (err) {
    return mapError(err);
  }
}

async function askPatient(
  caller: CallerIdentity,
  patientId: string,
  context: PatientContext,
  question: string,
  locale: "en" | "fr",
): Promise<Response> {
  await verifyPatientScope(caller.supabase, patientId);

  const { value: redacted, removed } = redactContext(context);
  if (removed.length > 0) {
    console.warn("[ai] ask(patient): redacted unexpected identifier fields:", removed);
  }

  const provider = getProvider();
  const startedAt = Date.now();
  const result = await callModelJson(
    provider,
    {
      system: systemPrompt(locale),
      user: buildAskPatientPrompt(redacted, question),
      tag: "ask_patient",
    },
    (json) => AskAnswerSchema.parse(json),
  );
  const latencyMs = Date.now() - startedAt;

  const suggestionId = await logInteraction({
    supabase: caller.supabase,
    staff: caller.staff,
    feature: "ask_patient",
    model: provider.model,
    visitId: redacted.visit.id,
    patientId,
    contextJson: redacted,
    requestText: question,
    responseJson: result.data,
    rawResponse: result.raw,
    promptTokens: result.promptTokens,
    outputTokens: result.outputTokens,
    latencyMs,
  });

  return Response.json({ answer: result.data, suggestionId });
}

async function askCohort(
  caller: CallerIdentity,
  question: string,
  locale: "en" | "fr",
): Promise<Response> {
  const provider = getProvider();
  const startedAt = Date.now();
  let promptTokens = 0;
  let outputTokens = 0;

  // Step 1 — plan a structured, whitelisted read (validateCohortQuery throws
  // inside the parse callback, so a bad plan gets ONE corrective retry).
  const planned = await callModelJson(
    provider,
    {
      system: systemPrompt(locale),
      user: buildCohortPlanPrompt(question),
      tag: "ask_cohort_plan",
    },
    (json) => validateCohortQuery(json),
  );
  promptTokens += planned.promptTokens;
  outputTokens += planned.outputTokens;

  // Step 2 — execute through the caller's RLS-bound client.
  const queryPreview = describeCohortQuery(planned.data);
  const { rows, totalCount } = await runCohortQuery(caller.supabase, planned.data);

  // Step 3 — summarise the rows in plain language.
  const answered = await callModelJson(
    provider,
    {
      system: systemPrompt(locale),
      user: buildCohortAnswerPrompt(question, queryPreview, rows, totalCount),
      tag: "ask_cohort_answer",
    },
    (json) => AskAnswerSchema.parse(json),
  );
  promptTokens += answered.promptTokens;
  outputTokens += answered.outputTokens;
  const latencyMs = Date.now() - startedAt;

  const suggestionId = await logInteraction({
    supabase: caller.supabase,
    staff: caller.staff,
    feature: "ask_cohort",
    model: provider.model,
    requestText: question,
    responseJson: {
      answer: answered.data,
      query: planned.data,
      queryPreview,
      totalCount,
      rowsReturned: rows.length,
    },
    rawResponse: answered.raw,
    promptTokens,
    outputTokens,
    latencyMs,
  });

  return Response.json({
    answer: answered.data,
    suggestionId,
    queryPreview,
    totalCount,
    table: {
      columns: planned.data.aggregate === "count" ? [] : planned.data.columns,
      rows,
    },
  });
}

function mapError(err: unknown): Response {
  if (err instanceof AuthError) return jsonError(err.status, "auth", err.message);
  if (err instanceof ScopeError) return jsonError(err.status, "scope", err.message);
  if (err instanceof CohortGuardError) {
    return jsonError(502, "ai_unavailable", err.message);
  }
  if (err instanceof AiProviderError) {
    if (err.status === 429) return jsonError(429, "rate_limited", err.message);
    return jsonError(502, "ai_unavailable", err.message);
  }
  console.error("[ai] ask endpoint failed:", err);
  return jsonError(502, "ai_unavailable");
}
