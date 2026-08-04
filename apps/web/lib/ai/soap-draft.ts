/**
 * AI → SOAP-form draft hand-off (Phase 22).
 *
 * Accepting an AI assessment/plan does NOT write the record directly — it
 * inserts the text into the consultation form's input fields (the TermChips
 * surfaces), where it behaves exactly like text the doctor typed: every chip
 * is editable/removable, the clinical-term guard applies, and nothing is
 * saved until the doctor presses "Save consultation". One write path, no
 * hidden rows.
 *
 * Same window-event pattern as services/visit-drawer.ts.
 */

export const AI_SOAP_DRAFT_EVENT = "careflow:ai-soap-draft";

export interface AiSoapDraftDetail {
  visitId: string;
  part: "assessment" | "plan";
  text: string;
}

export function insertAiSoapDraft(detail: AiSoapDraftDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiSoapDraftDetail>(AI_SOAP_DRAFT_EVENT, { detail }));
}

/**
 * Convert AI prose into TermChips lines (the field value is a newline-joined
 * chip list — see components/clinical-terms/term-autocomplete.tsx). One
 * sentence per chip keeps each chip individually removable.
 */
export function textToChipLines(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Merge inserted chip lines into the field's current value (append, dedupe). */
export function mergeChipValue(current: string, incoming: string): string {
  const existing = current
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set(existing);
  const added = textToChipLines(incoming).filter((line) => !seen.has(line));
  return [...existing, ...added].join("\n");
}
