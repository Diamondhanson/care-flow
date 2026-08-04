"use client";

/**
 * Browser-side client for the /api/ai/* endpoints (Phase 22).
 *
 * Sessions live in localStorage, so every call carries the Supabase access
 * token as a bearer header — the route handlers rebuild an RLS-bound client
 * from it. The AI features are ONLINE-ONLY (the model is a cloud service);
 * `useOnline` powers the graceful offline state, and the offline-first rest
 * of the app is untouched.
 */

import { useEffect, useState } from "react";

import type {
  AskAnswer,
  AskRequest,
  PatientContext,
  PlanSuggestion,
  ResultsSuggestion,
} from "@careflow/shared/types/ai";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

/** Client-side visibility gate (server enforcement is separate). */
export function isAiEnabledClient(): boolean {
  const flag = process.env.NEXT_PUBLIC_AI_FEATURES_ENABLED;
  return (flag === "true" || flag === "1") && isSupabaseConfigured();
}

/** navigator.onLine as React state, mount-guarded (starts true on SSR). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export class AiApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AiApiError";
  }
}

async function accessToken(): Promise<string> {
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
  } catch {
    // fall through to the error below
  }
  throw new AiApiError("auth", 401, "No active session.");
}

async function callAi<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiApiError("network", 0, "Network request failed.");
  }

  if (!res.ok) {
    let code = "ai_unavailable";
    let message: string | undefined;
    try {
      const parsed = (await res.json()) as { error?: string; message?: string };
      code = parsed.error ?? code;
      message = parsed.message;
    } catch {
      // non-JSON error body
    }
    throw new AiApiError(code, res.status, message);
  }
  return (await res.json()) as T;
}

export interface PlanResponse {
  suggestion: PlanSuggestion;
  suggestionId: string;
}
export interface ResultsResponse {
  suggestion: ResultsSuggestion;
  suggestionId: string;
}
export interface AskResponse {
  answer: AskAnswer;
  suggestionId: string;
  queryPreview?: string;
  totalCount?: number | null;
  table?: { columns: string[]; rows: Record<string, unknown>[] };
}

export function requestPlanSuggestion(
  visitId: string,
  locale: "en" | "fr",
  context: PatientContext,
): Promise<PlanResponse> {
  return callAi("/api/ai/suggest/plan", "POST", { visitId, locale, context });
}

export function requestResultsSuggestion(
  visitId: string,
  locale: "en" | "fr",
  context: PatientContext,
): Promise<ResultsResponse> {
  return callAi("/api/ai/suggest/results", "POST", { visitId, locale, context });
}

export function askCareFlow(request: AskRequest): Promise<AskResponse> {
  return callAi("/api/ai/ask", "POST", request);
}

/** Fire-and-forget decision recording — never blocks the doctor's action. */
export function recordDecision(
  suggestionId: string,
  decision: "accepted" | "edited" | "dismissed",
  acceptedJson?: unknown,
): void {
  void callAi(`/api/ai/suggestions/${suggestionId}`, "PATCH", {
    decision,
    acceptedJson: acceptedJson ?? null,
  }).catch((err) => {
    console.warn("[ai] failed to record decision:", err);
  });
}
