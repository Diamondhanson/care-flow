/**
 * Pure ROS block helpers (Phase 21) — every decision-bearing branch of the
 * RosReview UI lives here so it is node-testable (the vitest config runs in a
 * node environment, so component tests are not possible; components stay thin).
 */

import type {
  RosAnswerValue,
  RosQuestion,
  RosResponse,
  Sex,
} from "@careflow/shared";
import type { Locale } from "@/i18n";

/** Does this question apply to a patient of the given sex? (sex-gated but
 *  always addable — the gate only controls what shows by default). */
export function questionApplies(q: RosQuestion, sex: Sex): boolean {
  if (!q.sex) return true;
  return q.sex === sex;
}

/**
 * Follow-ups revealed by the parent's current answer. `show_if: "yes"` matches
 * a boolean `true`; any other `show_if` matches the literal single_select /
 * scale value. No answer (or a negative) reveals nothing.
 */
export function visibleFollowups(
  q: RosQuestion,
  parentValue: RosAnswerValue | undefined,
): RosQuestion[] {
  if (parentValue === undefined) return [];
  return (q.followups ?? []).filter((f) => {
    if (!f.show_if) return true;
    if (f.show_if === "yes") return parentValue === true;
    return parentValue === f.show_if;
  });
}

/**
 * The untouched boolean key questions of a module — what "Mark remaining as
 * No" flips, honouring the sex gate. Only booleans can be defaulted to a
 * negative; select/numeric questions have no meaningful "No".
 */
export function unansweredKeyQuestions(
  module: RosQuestion[],
  answeredKeys: ReadonlySet<string>,
  sex: Sex,
): RosQuestion[] {
  return module.filter(
    (q) =>
      q.key_question === true &&
      q.type === "boolean" &&
      !answeredKeys.has(q.key) &&
      questionApplies(q, sex),
  );
}

/** Localized unit labels for duration/numeric answers. */
const UNIT_LABELS: Record<string, { en: string; fr: string }> = {
  minutes: { en: "minutes", fr: "minutes" },
  hours: { en: "hours", fr: "heures" },
  days: { en: "days", fr: "jours" },
  weeks: { en: "weeks", fr: "semaines" },
  months: { en: "months", fr: "mois" },
  years: { en: "years", fr: "ans" },
};

export function unitLabel(unit: string, locale: Locale): string {
  const entry = UNIT_LABELS[unit];
  return entry ? entry[locale] : unit;
}

/**
 * The localized, human-readable label for an answer — what gets stored as
 * `answer_label` and printed in the compiled report. Derived from the bank's
 * bilingual option labels wherever possible.
 */
export function answerLabelFor(
  q: RosQuestion,
  value: RosAnswerValue,
  locale: Locale,
): string {
  const optionLabel = (v: string): string => {
    const opt = (q.options ?? []).find((o) => o.value === v);
    if (!opt) return v;
    return locale === "fr" ? opt.label_fr : opt.label_en;
  };

  switch (q.type) {
    case "boolean":
      if (value === true) return locale === "fr" ? "Oui" : "Yes";
      return locale === "fr" ? "Non" : "No";
    case "single_select":
    case "scale":
      return typeof value === "string" ? optionLabel(value) : String(value);
    case "multi_select":
      return Array.isArray(value) ? value.map(optionLabel).join(", ") : String(value);
    case "duration":
    case "numeric": {
      if (typeof value === "object" && value !== null && "value" in value) {
        const unit = value.unit ? ` ${unitLabel(value.unit, locale)}` : "";
        return `${value.value}${unit}`;
      }
      return String(value);
    }
    case "date":
    case "text":
    default:
      return String(value);
  }
}

/** Group a visit's responses by their question key for O(1) lookups. */
export function responsesByKey(
  responses: readonly RosResponse[],
): Map<string, RosResponse> {
  return new Map(responses.map((r) => [r.question_key, r]));
}
