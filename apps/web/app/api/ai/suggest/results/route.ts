/**
 * POST /api/ai/suggest/results — Moment 2 (Phase 22, spec §8).
 *
 * Same gatekeeper flow as /suggest/plan, plus: requires at least one result,
 * inlines image/PDF attachments from the lab-results bucket, and merges the
 * DETERMINISTIC allergy check into the model's safetyFlags — the model's own
 * judgement can never clear a recorded allergy.
 */

import { ResultsRequestSchema, ResultsSuggestionSchema } from "@careflow/shared/types/ai";

import { fetchResultAttachments } from "@/lib/ai/attachments";
import { ScopeError, verifyVisitScope } from "@/lib/ai/context";
import { callModelJson, jsonError, logInteraction } from "@/lib/ai/handler-utils";
import { buildResultsPrompt, systemPrompt } from "@/lib/ai/prompts";
import { AiProviderError, getProvider, isAiEnabledServer } from "@/lib/ai/provider";
import { redactContext } from "@/lib/ai/redact";
import { checkAllergies, checkInteractions } from "@/lib/ai/safety";
import { AuthError, requireStaff } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAiEnabledServer()) return jsonError(503, "ai_disabled");

  try {
    const caller = await requireStaff(request, ["doctor", "nurse", "admin"]);

    const parsed = ResultsRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, "bad_request", parsed.error.message);
    }
    const { visitId, locale, context } = parsed.data;
    if (context.visit.id !== visitId) {
      return jsonError(400, "bad_request", "context.visit.id does not match visitId");
    }
    if (context.results.length === 0) {
      return jsonError(409, "no_results_yet");
    }

    await verifyVisitScope(caller.supabase, visitId, context.patient.id);

    const { value: redacted, removed } = redactContext(context);
    if (removed.length > 0) {
      console.warn("[ai] results: redacted unexpected identifier fields:", removed);
    }

    // Attachments are fetched through the caller's RLS-bound client; a
    // missing/oversized file is skipped, never fatal.
    const images = await fetchResultAttachments(caller.supabase, redacted);

    const provider = getProvider();
    const startedAt = Date.now();
    const result = await callModelJson(
      provider,
      {
        system: systemPrompt(locale),
        user: buildResultsPrompt(redacted, images.length),
        tag: "results",
        images,
      },
      (json) => ResultsSuggestionSchema.parse(json),
    );
    const latencyMs = Date.now() - startedAt;

    // Deterministic checks OVERRIDE-PROOF merge: appended after the model's
    // own flags, tagged allergy_check so the UI renders them as blocking.
    const deterministicFlags = [
      ...checkAllergies(result.data.medications, redacted.allergies),
      ...checkInteractions(result.data.medications, redacted.currentMedications),
    ];
    const suggestion = {
      ...result.data,
      safetyFlags: [...result.data.safetyFlags, ...deterministicFlags],
    };

    const suggestionId = await logInteraction({
      supabase: caller.supabase,
      staff: caller.staff,
      feature: "results",
      model: provider.model,
      visitId,
      patientId: context.patient.id,
      contextJson: redacted,
      responseJson: suggestion,
      rawResponse: result.raw,
      safetyFlags: suggestion.safetyFlags,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      latencyMs,
    });

    return Response.json({ suggestion, suggestionId });
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): Response {
  if (err instanceof AuthError) return jsonError(err.status, "auth", err.message);
  if (err instanceof ScopeError) return jsonError(err.status, "scope", err.message);
  if (err instanceof AiProviderError) {
    if (err.status === 429) return jsonError(429, "rate_limited", err.message);
    return jsonError(502, "ai_unavailable", err.message);
  }
  console.error("[ai] results endpoint failed:", err);
  return jsonError(502, "ai_unavailable");
}
