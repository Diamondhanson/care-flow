"use client";

/**
 * Moment 1 draft cards (Phase 22, spec §10): suggested assessment + plan
 * (editable, Accept writes through the existing client-side consultation
 * service), a read-only differential, and suggested tests (Add → existing
 * create-order service). Nothing here writes without an explicit click.
 */

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";

import type { PlanSuggestion } from "@careflow/shared/types/ai";
import { ORDER_TYPES, type OrderType, type StaffId, type VisitId } from "@careflow/shared";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/locale-provider";
import { recordDecision } from "@/lib/ai/api-client";
import { insertAiSoapDraft } from "@/lib/ai/soap-draft";
import { addOrder } from "@/services/mockStorage";

import { ConfidenceBadge, SourceChips, WhyLine } from "./suggestion-bits";

/** The model is told to use the real order_type enum; fall back to lab. */
function toOrderType(raw: string): OrderType {
  const norm = raw.trim().toLowerCase();
  return (ORDER_TYPES as readonly string[]).includes(norm) ? (norm as OrderType) : "lab";
}

function EditableNoteCard({
  title,
  suggested,
  confidence,
  rationale,
  sources,
  onAccept,
  disabled,
}: {
  title: string;
  suggested: string;
  confidence: PlanSuggestion["assessment"]["confidence"];
  rationale: string;
  sources: string[];
  onAccept: (finalText: string) => void;
  disabled: boolean;
}) {
  const { t } = useT();
  const [text, setText] = useState(suggested);
  const [state, setState] = useState<"draft" | "saved" | "dismissed">("draft");

  if (state === "dismissed") return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold">{title}</h4>
        <ConfidenceBadge level={confidence} />
        {state === "saved" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" style={{ color: "var(--success)" }} />
            {t("ai.insertedNote")}
          </span>
        ) : null}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Size to the suggestion so nothing arrives clipped: ~70 chars per
        // line, between 5 and 12 rows.
        rows={Math.min(12, Math.max(5, Math.ceil(suggested.length / 70)))}
        disabled={disabled || state === "saved"}
        className="text-sm leading-relaxed"
      />
      <WhyLine rationale={rationale} />
      <SourceChips sources={sources} />
      {state === "draft" ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={disabled || !text.trim()}
            onClick={() => {
              onAccept(text.trim());
              setState("saved");
            }}
          >
            <Check className="size-3.5" />
            {t("ai.accept")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setState("dismissed")}>
            <X className="size-3.5" />
            {t("ai.dismiss")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PlanCards({
  suggestion,
  suggestionId,
  visitId,
  recorderId,
  onMutated,
}: {
  suggestion: PlanSuggestion;
  suggestionId: string;
  visitId: VisitId;
  recorderId: StaffId | null;
  onMutated: () => void;
}) {
  const { t } = useT();
  const [addedTests, setAddedTests] = useState<Set<number>>(new Set());

  /**
   * Accepting an assessment/plan inserts it into the consultation form's
   * input fields as chips (via the AI_SOAP_DRAFT_EVENT hand-off) — the
   * clinical-term guard applies, every chip stays editable/removable, and
   * nothing is written until the doctor presses "Save consultation".
   * Deliberately does NOT touch the store: a store mutation would bump the
   * drawer's resetKey and wipe the very drafts we just inserted.
   */
  function acceptNote(part: "assessment" | "plan", finalText: string) {
    insertAiSoapDraft({ visitId, part, text: finalText });
    const suggested = suggestion[part].text.trim();
    recordDecision(suggestionId, finalText === suggested ? "accepted" : "edited", {
      part,
      value: finalText,
    });
  }

  function addTest(index: number) {
    const test = suggestion.suggestedTests[index];
    if (!test) return;
    addOrder(visitId, {
      ordered_by_id: recorderId,
      order_type: toOrderType(test.orderType),
      description: test.description,
    });
    recordDecision(suggestionId, "accepted", { part: "test", value: test });
    setAddedTests((prev) => new Set(prev).add(index));
    onMutated();
  }

  if (suggestion.insufficientData) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        {t("ai.insufficientData")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <EditableNoteCard
        title={t("ai.assessment")}
        suggested={suggestion.assessment.text}
        confidence={suggestion.assessment.confidence}
        rationale={suggestion.assessment.rationale}
        sources={suggestion.assessment.sources}
        onAccept={(text) => acceptNote("assessment", text)}
        disabled={false}
      />

      {suggestion.differential.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <h4 className="text-xs font-semibold">{t("ai.differential")}</h4>
          {/* Ranked list: number → condition + ICD-10, likelihood pinned
              right, rationale indented under its condition. Dividers keep
              each possibility visually separate. */}
          <ol className="flex flex-col divide-y divide-border/60">
            {suggestion.differential.map((d, i) => (
              <li key={i} className="flex flex-col gap-1 py-2.5 first:pt-1 last:pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] text-muted-foreground"
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{d.condition}</span>
                  {d.icd10 ? (
                    <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {d.icd10}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0">
                    <ConfidenceBadge level={d.likelihood} />
                  </span>
                </div>
                <p className="pl-7 text-xs leading-relaxed text-muted-foreground">
                  {d.rationale}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <EditableNoteCard
        title={t("ai.plan")}
        suggested={suggestion.plan.text}
        confidence={suggestion.plan.confidence}
        rationale={suggestion.plan.rationale}
        sources={suggestion.plan.sources}
        onAccept={(text) => acceptNote("plan", text)}
        disabled={false}
      />

      {suggestion.suggestedTests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
          <h4 className="text-xs font-semibold">{t("ai.tests")}</h4>
          <ul className="flex flex-col gap-1.5">
            {suggestion.suggestedTests.map((test, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-sm">
                    {test.description}
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {toOrderType(test.orderType)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{test.reason}</span>
                </div>
                {addedTests.has(i) ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5" style={{ color: "var(--success)" }} />
                    {t("ai.added")}
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => addTest(i)}>
                    <Plus className="size-3.5" />
                    {t("ai.add")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {suggestion.notes ? (
        <p className="text-xs text-muted-foreground">{suggestion.notes}</p>
      ) : null}
    </div>
  );
}
