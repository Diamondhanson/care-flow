/**
 * ROS narrative compiler (Phase 21) — turns the structured `ros_responses`
 * rows of one visit into a readable, localized report, grouped per system:
 * positives (with their follow-up qualifiers), pertinent negatives, then
 * history/genetics. Pure function — derived from the rows on every call, no
 * storage; the structured rows remain the source of truth.
 *
 * Labels are re-derived from the live bank (bilingual option labels) so the
 * narrative renders in the requested locale; if a question has left the bank
 * since the answer was recorded, the row's snapshotted `question_text` /
 * `answer_label` keep the report printable (history-safe denormalization).
 */

import type { BodySystem, RosResponse } from "@careflow/shared";
import type { Locale } from "@/i18n";

import { getQuestion, ROS_SYSTEMS } from "./index";
import { answerLabelFor } from "./state";

/** Localized system display names (self-contained — the compiler is used from
 *  the service layer too, outside the React i18n provider). */
export const SYSTEM_LABELS: Record<BodySystem, { en: string; fr: string }> = {
  general: { en: "General", fr: "Général" },
  cardiac: { en: "Cardiac", fr: "Cardiaque" },
  respiratory: { en: "Respiratory", fr: "Respiratoire" },
  gi: { en: "Gastrointestinal", fr: "Gastro-intestinal" },
  gu: { en: "Genitourinary", fr: "Génito-urinaire" },
  neuro: { en: "Neurological", fr: "Neurologique" },
  ent: { en: "ENT", fr: "ORL" },
  eyes: { en: "Eyes", fr: "Yeux" },
  skin: { en: "Skin", fr: "Peau" },
  musculoskeletal: { en: "Musculoskeletal", fr: "Musculo-squelettique" },
  psych: { en: "Psychiatric", fr: "Psychiatrique" },
  obstetric_gynae: { en: "Obstetric/Gynae", fr: "Obstétrique/Gynéco" },
};

const STRINGS = {
  en: {
    reports: "Reports",
    denies: "Denies",
    history: "History/genetics",
    note: "note",
  },
  fr: {
    reports: "Signale",
    denies: "Nie",
    history: "Antécédents/génétique",
    note: "note",
  },
} as const;

/** A follow-up key belongs to its parent by prefix: "a.b.c" → parent "a.b". */
function parentKeyOf(key: string): string {
  const idx = key.lastIndexOf(".");
  return idx > 0 ? key.slice(0, idx) : key;
}

/** The phrase used for a question in prose: live report_phrase, else the
 *  snapshotted prompt with trailing "?" stripped. */
function phraseFor(r: RosResponse, locale: Locale): string {
  const q = getQuestion(r.question_key);
  const live = locale === "fr" ? q?.report_phrase_fr : q?.report_phrase_en;
  if (live) return live;
  const text = r.question_text.replace(/\s*\?\s*$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The localized answer label: re-derived from the live bank when possible,
 *  else the snapshotted label. */
function labelFor(r: RosResponse, locale: Locale): string {
  const q = getQuestion(r.question_key);
  if (q) return answerLabelFor(q, r.answer_value, locale);
  return r.answer_label;
}

/** "chest pain (character: crushing; duration: 2 hours; note: worse at night)" */
function positiveClause(
  parent: RosResponse,
  qualifiers: RosResponse[],
  locale: Locale,
): string {
  const parts: string[] = [];
  // A non-boolean parent's own answer is itself a qualifier ("gravida: 2").
  if (parent.answer_type !== "boolean") {
    parts.push(labelFor(parent, locale));
  }
  for (const f of qualifiers) {
    parts.push(`${phraseFor(f, locale)}: ${labelFor(f, locale)}`);
    if (f.note) parts.push(`${STRINGS[locale].note}: ${f.note}`);
  }
  if (parent.note) parts.push(`${STRINGS[locale].note}: ${parent.note}`);
  const phrase = phraseFor(parent, locale);
  return parts.length > 0 ? `${phrase} (${parts.join("; ")})` : phrase;
}

/**
 * Compile one visit's answered ROS questions into a localized narrative.
 * Returns "" when there is nothing to report.
 */
export function compileRosNarrative(
  responses: readonly RosResponse[],
  locale: Locale,
): string {
  if (responses.length === 0) return "";
  const t = STRINGS[locale];

  // Follow-up rows attach to their parent; everything else is top-level.
  const topLevel = new Map<string, RosResponse>();
  const followupsByParent = new Map<string, RosResponse[]>();
  const keys = new Set(responses.map((r) => r.question_key));
  for (const r of responses) {
    const parent = parentKeyOf(r.question_key);
    if (parent !== r.question_key && keys.has(parent)) {
      const list = followupsByParent.get(parent) ?? [];
      list.push(r);
      followupsByParent.set(parent, list);
    } else {
      topLevel.set(r.question_key, r);
    }
  }

  const lines: string[] = [];
  for (const system of ROS_SYSTEMS) {
    const rows = [...topLevel.values()].filter((r) => r.system === system);
    if (rows.length === 0) continue;

    const symptoms = rows.filter((r) => r.kind === "symptom");
    const background = rows.filter((r) => r.kind !== "symptom");

    const positives = symptoms.filter((r) => r.answer_value !== false);
    const negatives = symptoms.filter((r) => r.answer_value === false);

    const sentences: string[] = [];
    if (positives.length > 0) {
      const clauses = positives.map((r) =>
        positiveClause(r, followupsByParent.get(r.question_key) ?? [], locale),
      );
      sentences.push(`${t.reports} ${clauses.join(", ")}.`);
    }
    if (negatives.length > 0) {
      const clauses = negatives.map((r) => phraseFor(r, locale));
      sentences.push(`${t.denies} ${clauses.join(", ")}.`);
    }
    if (background.length > 0) {
      const clauses = background.map((r) => {
        const qualifiers = followupsByParent.get(r.question_key) ?? [];
        if (r.answer_value === false) {
          return locale === "fr"
            ? `pas de ${phraseFor(r, locale)}`
            : `no ${phraseFor(r, locale)}`;
        }
        return positiveClause(r, qualifiers, locale);
      });
      sentences.push(`${t.history}: ${clauses.join(", ")}.`);
    }

    const label = SYSTEM_LABELS[system][locale];
    lines.push(`${label}: ${sentences.join(" ")}`);
  }

  return lines.join("\n");
}
