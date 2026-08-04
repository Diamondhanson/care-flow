"use client";

/**
 * AI Assist panel (Phase 22, spec §10) — a collapsible section in the
 * doctor's console. Collapsed by default; the doctor opens it, never the
 * app. ONLINE-ONLY: the model is a cloud service, so the buttons disable
 * with a calm note when the device is offline — the rest of the drawer keeps
 * working offline untouched.
 *
 * Flow per click: assemble the context bundle from the ON-DEVICE store
 * (freshest data — unsynced outbox rows included), POST it with the bearer
 * token, render draft cards. Accept/Add/Prescribe go through the existing
 * client-side services (outbox → sync); the decision is then reported to
 * /api/ai/suggestions/:id. Suggestions are cached per visit + bundle hash so
 * an unchanged re-click is instant.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Sparkles } from "lucide-react";

import type { Consultation, Result, StaffId, Visit } from "@careflow/shared";

import { CareFlowMark } from "@/components/brand/careflow-logo";
import { useT, useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  AiApiError,
  isAiEnabledClient,
  requestPlanSuggestion,
  requestResultsSuggestion,
  useOnline,
  type PlanResponse,
  type ResultsResponse,
} from "@/lib/ai/api-client";
import { buildPatientContext, hashContext } from "@/lib/ai/client-context";

import { AiDisclaimer } from "./suggestion-bits";
import { PlanCards } from "./plan-cards";
import { ResultsCards } from "./results-cards";

type Fetch<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "done"; response: T; hash: string };

/** Per-visit suggestion cache — survives drawer close/reopen in this tab. */
const planCache = new Map<string, { hash: string; response: PlanResponse }>();
const resultsCache = new Map<string, { hash: string; response: ResultsResponse }>();

export function AiAssistPanel({
  visit,
  consultations,
  results,
  recorderId,
  onMutated,
}: {
  visit: Visit;
  consultations: Consultation[];
  results: Result[];
  recorderId: StaffId | null;
  onMutated: () => void;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const online = useOnline();

  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<Fetch<PlanResponse>>(() => {
    const cached = planCache.get(visit.id);
    return cached
      ? { status: "done", response: cached.response, hash: cached.hash }
      : { status: "idle" };
  });
  const [reviewed, setReviewed] = useState<Fetch<ResultsResponse>>(() => {
    const cached = resultsCache.get(visit.id);
    return cached
      ? { status: "done", response: cached.response, hash: cached.hash }
      : { status: "idle" };
  });

  if (!isAiEnabledClient()) return null;

  const activeLocale = mounted ? locale : "en";
  const latest = consultations[0] ?? null;
  const canPlan = Boolean(latest?.subjective || latest?.ros_summary);
  const canReview = results.length > 0;
  const busy = plan.status === "loading" || reviewed.status === "loading";

  async function suggestPlan() {
    const ctx = buildPatientContext(visit.id);
    if (!ctx) return;
    const hash = hashContext(ctx);
    if (plan.status === "done" && plan.hash === hash) return; // unchanged → keep
    setPlan({ status: "loading" });
    try {
      const response = await requestPlanSuggestion(visit.id, activeLocale, ctx);
      planCache.set(visit.id, { hash, response });
      setPlan({ status: "done", response, hash });
    } catch (err) {
      setPlan({ status: "error", code: err instanceof AiApiError ? err.code : "ai_unavailable" });
    }
  }

  async function reviewResults() {
    const ctx = buildPatientContext(visit.id);
    if (!ctx) return;
    const hash = hashContext(ctx);
    if (reviewed.status === "done" && reviewed.hash === hash) return;
    setReviewed({ status: "loading" });
    try {
      const response = await requestResultsSuggestion(visit.id, activeLocale, ctx);
      resultsCache.set(visit.id, { hash, response });
      setReviewed({ status: "done", response, hash });
    } catch (err) {
      setReviewed({
        status: "error",
        code: err instanceof AiApiError ? err.code : "ai_unavailable",
      });
    }
  }

  const errorText = (code: string) =>
    code === "rate_limited"
      ? t("ai.rateLimited")
      : code === "network"
        ? t("ai.offline")
        : t("ai.unavailable");

  return (
    <section className="flex flex-col rounded-md border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-11 items-center gap-2 p-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <CareFlowMark className="size-4 shrink-0" />
        <h3 className="text-sm font-semibold">{t("ai.assist")}</h3>
        {!online ? (
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {t("ai.offline")}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {!online ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t("ai.offline")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={!online || busy || !canPlan}
              title={!canPlan ? t("ai.needsConsultation") : undefined}
              onClick={suggestPlan}
            >
              <Sparkles className="size-3.5" style={{ color: "var(--cf-accent)" }} />
              {plan.status === "loading" ? t("ai.generating") : t("ai.suggestNextSteps")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={!online || busy || !canReview}
              title={!canReview ? t("ai.needsResults") : undefined}
              onClick={reviewResults}
            >
              <FlaskConical className="size-3.5" style={{ color: "var(--cf-accent)" }} />
              {reviewed.status === "loading" ? t("ai.generating") : t("ai.reviewResults")}
            </Button>
          </div>

          {plan.status === "loading" || reviewed.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <div className="h-16 animate-pulse rounded-md border border-border bg-card" />
              <div className="h-16 animate-pulse rounded-md border border-border bg-card" />
            </div>
          ) : null}

          {plan.status === "error" ? (
            <p className="text-xs" style={{ color: "var(--status-warning)" }}>
              {errorText(plan.code)}
            </p>
          ) : null}
          {plan.status === "done" ? (
            <PlanCards
              suggestion={plan.response.suggestion}
              suggestionId={plan.response.suggestionId}
              visitId={visit.id}
              recorderId={recorderId}
              onMutated={onMutated}
            />
          ) : null}

          {reviewed.status === "error" ? (
            <p className="text-xs" style={{ color: "var(--status-warning)" }}>
              {errorText(reviewed.code)}
            </p>
          ) : null}
          {reviewed.status === "done" ? (
            <ResultsCards
              suggestion={reviewed.response.suggestion}
              suggestionId={reviewed.response.suggestionId}
              visitId={visit.id}
              recorderId={recorderId}
              onMutated={onMutated}
            />
          ) : null}

          <AiDisclaimer />
        </div>
      ) : null}
    </section>
  );
}
