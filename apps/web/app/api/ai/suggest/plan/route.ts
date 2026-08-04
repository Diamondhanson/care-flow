/**
 * POST /api/ai/suggest/plan — Moment 1 (Phase 22, spec §8).
 *
 * The client sends the on-device context bundle + its Supabase access token;
 * this handler is the gatekeeper: bearer auth → RLS scope check → zod parse →
 * redact → model → validate → log. The AI writes nothing clinical — the
 * response is drafts for the doctor.
 */

import { PlanRequestSchema, PlanSuggestionSchema } from "@careflow/shared/types/ai";

import { ScopeError, verifyVisitScope } from "@/lib/ai/context";
import { callModelJson, jsonError, logInteraction } from "@/lib/ai/handler-utils";
import { buildPlanPrompt, systemPrompt } from "@/lib/ai/prompts";
import { AiProviderError, getProvider, isAiEnabledServer } from "@/lib/ai/provider";
import { redactContext } from "@/lib/ai/redact";
import { AuthError, requireStaff } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAiEnabledServer()) return jsonError(503, "ai_disabled");

  try {
    const caller = await requireStaff(request, ["doctor", "nurse", "admin"]);

    const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, "bad_request", parsed.error.message);
    }
    const { visitId, locale, context } = parsed.data;
    if (context.visit.id !== visitId) {
      return jsonError(400, "bad_request", "context.visit.id does not match visitId");
    }

    await verifyVisitScope(caller.supabase, visitId, context.patient.id);

    const { value: redacted, removed } = redactContext(context);
    if (removed.length > 0) {
      console.warn("[ai] plan: redacted unexpected identifier fields:", removed);
    }

    const provider = getProvider();
    const startedAt = Date.now();
    const result = await callModelJson(
      provider,
      { system: systemPrompt(locale), user: buildPlanPrompt(redacted), tag: "plan" },
      (json) => PlanSuggestionSchema.parse(json),
    );
    const latencyMs = Date.now() - startedAt;

    const suggestionId = await logInteraction({
      supabase: caller.supabase,
      staff: caller.staff,
      feature: "plan",
      model: provider.model,
      visitId,
      patientId: context.patient.id,
      contextJson: redacted,
      responseJson: result.data,
      rawResponse: result.raw,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      latencyMs,
    });

    return Response.json({ suggestion: result.data, suggestionId });
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
  console.error("[ai] plan endpoint failed:", err);
  return jsonError(502, "ai_unavailable");
}
