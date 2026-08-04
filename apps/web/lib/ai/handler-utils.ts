/**
 * Shared plumbing for the /api/ai/* route handlers (Phase 22).
 *
 * - `callModelJson`: call the provider, parse the reply, and retry ONCE with
 *   the validation error appended when the model returns malformed JSON.
 * - `logInteraction`: write the ai_suggestions compliance row + the
 *   usage_events metering row, in parallel, through the caller's RLS-bound
 *   client. Awaited before responding (serverless platforms don't guarantee
 *   work after the response is sent, and the audit trail is a safety rule) —
 *   it costs one DB round-trip (~tens of ms) against a multi-second model
 *   call. A logging failure never breaks the doctor-facing response.
 * - `jsonError`: uniform error envelope.
 */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiFeature } from "@careflow/shared";
import type { AiSafetyFlag } from "@careflow/shared/types/ai";

import type { AiCall, AiProvider, AiResult } from "./provider";

export function jsonError(status: number, code: string, message?: string): Response {
  return Response.json({ error: code, message }, { status });
}

export interface ModelJsonResult<T> {
  data: T;
  raw: string;
  promptTokens: number;
  outputTokens: number;
}

/**
 * Run the call, JSON-parse + validate via `parse` (throws on bad data). One
 * corrective retry, then the caller maps the failure to "AI unavailable".
 * Token counts accumulate across attempts (both are billed).
 */
export async function callModelJson<T>(
  provider: AiProvider,
  call: AiCall,
  parse: (json: unknown) => T,
): Promise<ModelJsonResult<T>> {
  let promptTokens = 0;
  let outputTokens = 0;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const result: AiResult = await provider.complete(
      attempt === 0
        ? call
        : {
            ...call,
            user: `${call.user}

YOUR PREVIOUS REPLY WAS INVALID (${lastError.slice(0, 500)}).
Reply again with ONLY a valid JSON object of the requested shape — no prose,
no markdown fences.`,
          },
    );
    promptTokens += result.promptTokens ?? 0;
    outputTokens += result.outputTokens ?? 0;

    try {
      // Tolerate a fenced reply even though the prompt forbids it.
      const text = result.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
      const data = parse(JSON.parse(text));
      return { data, raw: result.text, promptTokens, outputTokens };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`model returned invalid JSON twice: ${lastError.slice(0, 300)}`);
}

export interface LogInteractionInput {
  supabase: SupabaseClient;
  staff: { id: string; hospital_id: string };
  feature: AiFeature;
  model: string;
  visitId?: string | null;
  patientId?: string | null;
  contextJson?: unknown;
  requestText?: string | null;
  responseJson?: unknown;
  rawResponse?: string | null;
  safetyFlags?: AiSafetyFlag[];
  promptTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

/**
 * Insert the ai_suggestions row (with a pre-generated id so the response can
 * reference it) and the usage_events metering row. Errors are logged, never
 * thrown — bookkeeping must not take down a successful suggestion.
 */
export async function logInteraction(input: LogInteractionInput): Promise<string> {
  const suggestionId = randomUUID();

  const suggestionInsert = input.supabase.from("ai_suggestions").insert({
    id: suggestionId,
    hospital_id: input.staff.hospital_id,
    visit_id: input.visitId ?? null,
    patient_id: input.patientId ?? null,
    requested_by_id: input.staff.id,
    feature: input.feature,
    model: input.model,
    context_json: input.contextJson ?? null,
    request_text: input.requestText ?? null,
    response_json: input.responseJson ?? null,
    raw_response: input.rawResponse ?? null,
    safety_flags: input.safetyFlags ?? [],
    decision: "shown",
    prompt_tokens: input.promptTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    latency_ms: input.latencyMs ?? null,
  });

  // Metering mirrors services/telemetry.ts: metadata primitives only, no PHI.
  const usageInsert = input.supabase.from("usage_events").insert({
    hospital_id: input.staff.hospital_id,
    event_type: "feature_used",
    actor_staff_id: input.staff.id,
    metadata: {
      feature: `ai_${input.feature}`,
      model: input.model,
      prompt_tokens: input.promptTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      latency_ms: input.latencyMs ?? 0,
    },
  });

  const [sugRes, usageRes] = await Promise.all([suggestionInsert, usageInsert]);
  if (sugRes.error) {
    console.error("[ai] ai_suggestions insert failed:", sugRes.error.message);
  }
  if (usageRes.error) {
    console.error("[ai] usage_events insert failed:", usageRes.error.message);
  }

  return suggestionId;
}
