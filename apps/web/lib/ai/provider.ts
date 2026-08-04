/**
 * AI provider layer (Phase 22) — one interface, env-selected implementation,
 * so the team can move Gemini → another vendor by changing env only.
 *
 * Server-only: route handlers under app/api/ai/* are the sole callers. The
 * browser never talks to a model vendor directly — the server is the
 * gatekeeper that holds the key, redacts, validates, and logs.
 *
 * Env (lazy inline guards, matching the repo convention — no central env.ts):
 *   AI_FEATURES_ENABLED=true            server-side kill switch
 *   NEXT_PUBLIC_AI_FEATURES_ENABLED=true  client UI visibility (not a secret)
 *   AI_PROVIDER=gemini | mock           default: gemini
 *   AI_MODEL=gemini-2.5-flash           default; read at call time
 *   GEMINI_API_KEY=...                  server-only; never NEXT_PUBLIC_*
 */

import { GeminiProvider } from "./gemini";
import { MockProvider } from "./mock";

export interface AiCall {
  system: string;
  user: string;
  /**
   * Which feature is calling — used by the mock provider to pick a canned
   * response, and recorded in logs. Not sent to the vendor.
   */
  tag: "plan" | "results" | "ask_patient" | "ask_cohort_plan" | "ask_cohort_answer";
  /** Base64 inline images/PDFs (Moment 2 result attachments). */
  images?: { mimeType: string; data: string }[];
  /** Clinical → low temperature. */
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiResult {
  text: string;
  promptTokens?: number;
  outputTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(call: AiCall): Promise<AiResult>;
}

/** Thrown by adapters; route handlers map it to a clean "AI unavailable". */
export class AiProviderError extends Error {
  constructor(
    message: string,
    /** HTTP-ish status from the vendor (429 = rate limit), when known. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Server-side feature gate. Off unless explicitly enabled. */
export function isAiEnabledServer(): boolean {
  const flag =
    process.env.AI_FEATURES_ENABLED ?? process.env.NEXT_PUBLIC_AI_FEATURES_ENABLED;
  return flag === "true" || flag === "1";
}

export function aiModelName(): string {
  // gemini-flash-latest tracks Google's current free Flash model. Verified
  // 2026-08: pinned older names (gemini-2.5-flash) are still LISTED by the
  // API but return 404 on generateContent for new free-tier keys.
  return process.env.AI_MODEL || "gemini-flash-latest";
}

/**
 * Resolve the active provider from env. `mock` needs no key (tests, offline
 * dev); `gemini` requires GEMINI_API_KEY — a missing key throws here so the
 * route handler can answer with a clean 503 instead of a vendor 401.
 */
export function getProvider(): AiProvider {
  const which = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (which === "mock") return new MockProvider(aiModelName());
  if (which === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new AiProviderError(
        "GEMINI_API_KEY is not set — set it in apps/web/.env.local or use AI_PROVIDER=mock",
      );
    }
    return new GeminiProvider(aiModelName(), key);
  }
  throw new AiProviderError(`Unknown AI_PROVIDER "${which}" (expected gemini | mock)`);
}
