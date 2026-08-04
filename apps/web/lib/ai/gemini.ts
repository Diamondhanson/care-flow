/**
 * Gemini adapter — plain fetch against the Generative Language API, no SDK
 * dependency (keeps the bundle lean and avoids Turbopack/server-bundling
 * surprises). JSON output is requested via `responseMimeType`; the strict
 * gate is the zod parse in the route handler, never the vendor.
 *
 * The API key travels in the `x-goog-api-key` header — NOT as a `?key=`
 * query param, which would leak into request logs.
 */

import { AiProviderError, type AiCall, type AiProvider, type AiResult } from "./provider";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Generous but bounded — Moment 2 with attachments is the slow path. */
const TIMEOUT_MS = 45_000;

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { code?: number; message?: string };
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(call: AiCall): Promise<AiResult> {
    const parts: Record<string, unknown>[] = [{ text: call.user }];
    for (const img of call.images ?? []) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    }

    const body = {
      system_instruction: { parts: [{ text: call.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: call.temperature ?? 0.2,
        maxOutputTokens: call.maxOutputTokens ?? 4096,
        responseMimeType: "application/json",
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${this.model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AiProviderError(
        err instanceof Error && err.name === "AbortError"
          ? `Gemini request timed out after ${TIMEOUT_MS}ms`
          : `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const errJson = (await res.json()) as GeminiResponse;
        detail = errJson.error?.message ?? "";
      } catch {
        // non-JSON error body — status alone is enough
      }
      throw new AiProviderError(
        `Gemini responded ${res.status}${detail ? `: ${detail}` : ""}`,
        res.status,
      );
    }

    const json = (await res.json()) as GeminiResponse;
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    if (!text) {
      throw new AiProviderError(
        `Gemini returned no text (finishReason: ${json.candidates?.[0]?.finishReason ?? "unknown"})`,
      );
    }

    return {
      text,
      promptTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    };
  }
}
