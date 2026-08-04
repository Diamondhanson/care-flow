/**
 * PATCH /api/ai/suggestions/:id — record the clinician's decision (Phase 22).
 *
 * This endpoint NEVER writes clinical rows. The UI performs the actual write
 * through the existing client-side services (outbox → sync), then reports
 * the decision here so the ai_suggestions compliance row reflects what the
 * doctor did (accepted / edited / dismissed + the final value). RLS scopes
 * the update to the caller's hospital.
 */

import { DecisionRequestSchema } from "@careflow/shared/types/ai";

import { jsonError } from "@/lib/ai/handler-utils";
import { isAiEnabledServer } from "@/lib/ai/provider";
import { AuthError, requireStaff } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isAiEnabledServer()) return jsonError(503, "ai_disabled");

  try {
    const caller = await requireStaff(request, ["doctor", "nurse", "admin"]);
    const { id } = await ctx.params;

    const parsed = DecisionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, "bad_request", parsed.error.message);
    }

    const { data, error } = await caller.supabase
      .from("ai_suggestions")
      .update({
        decision: parsed.data.decision,
        accepted_json: parsed.data.acceptedJson ?? null,
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[ai] decision update failed:", error.message);
      return jsonError(500, "update_failed");
    }
    if (!data) return jsonError(404, "not_found");

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.status, "auth", err.message);
    console.error("[ai] decision endpoint failed:", err);
    return jsonError(500, "update_failed");
  }
}
