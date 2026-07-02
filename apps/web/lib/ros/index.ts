/**
 * ROS question bank — seed loader + lookup API (Phase 21).
 *
 * The bank is reference data: bundled bilingual JSON in `data/ros/`, one file
 * per body system, each a flat array of self-describing question nodes
 * (symptoms + their follow-ups + the system's pertinent history/genetics).
 * Questions are added/edited by shipping a file — no migration. This mirrors
 * the clinical-term library (`lib/clinical-terms/index.ts`): static imports,
 * system stamped from the source file, in-memory lookups.
 *
 * Structural invariants (key uniqueness, options on select types, one-level
 * follow-ups) are enforced by `lib/ros/index.test.ts` in CI rather than at
 * runtime — the bank ships with the bundle, so a bad file can never reach
 * production past a red test.
 */

import type {
  BodySystem,
  RosAnswerValue,
  RosQuestion,
} from "@careflow/shared";

import cardiacSeed from "@/data/ros/cardiac.json";
import entSeed from "@/data/ros/ent.json";
import eyesSeed from "@/data/ros/eyes.json";
import generalSeed from "@/data/ros/general.json";
import giSeed from "@/data/ros/gi.json";
import guSeed from "@/data/ros/gu.json";
import musculoskeletalSeed from "@/data/ros/musculoskeletal.json";
import neuroSeed from "@/data/ros/neuro.json";
import obstetricGynaeSeed from "@/data/ros/obstetric_gynae.json";
import psychSeed from "@/data/ros/psych.json";
import respiratorySeed from "@/data/ros/respiratory.json";
import skinSeed from "@/data/ros/skin.json";

/** Canonical display order — head-to-toe clinical convention, General first. */
export const ROS_SYSTEMS: readonly BodySystem[] = [
  "general",
  "cardiac",
  "respiratory",
  "gi",
  "gu",
  "neuro",
  "ent",
  "eyes",
  "skin",
  "musculoskeletal",
  "psych",
  "obstetric_gynae",
];

const seed = (raw: unknown): RosQuestion[] => raw as RosQuestion[];

/** Top-level questions per system (follow-ups nested inside their parents). */
const BANK: Record<BodySystem, RosQuestion[]> = {
  general: seed(generalSeed),
  cardiac: seed(cardiacSeed),
  respiratory: seed(respiratorySeed),
  gi: seed(giSeed),
  gu: seed(guSeed),
  neuro: seed(neuroSeed),
  ent: seed(entSeed),
  eyes: seed(eyesSeed),
  skin: seed(skinSeed),
  musculoskeletal: seed(musculoskeletalSeed),
  psych: seed(psychSeed),
  obstetric_gynae: seed(obstetricGynaeSeed),
};

/** Every question keyed by `key`, follow-ups flattened in. */
const BY_KEY: Map<string, RosQuestion> = new Map();
for (const questions of Object.values(BANK)) {
  for (const q of questions) {
    BY_KEY.set(q.key, q);
    for (const f of q.followups ?? []) BY_KEY.set(f.key, f);
  }
}

export function getAllSystems(): readonly BodySystem[] {
  return ROS_SYSTEMS;
}

/** The complete module for one system: its top-level questions, in file order. */
export function getSystemModule(system: BodySystem): RosQuestion[] {
  return BANK[system];
}

/** Look up any question — top-level or follow-up — by its stable key. */
export function getQuestion(key: string): RosQuestion | undefined {
  return BY_KEY.get(key);
}

export function isKnownQuestionKey(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * Bank-side answer validation (beyond the shape check in
 * `@careflow/shared` UpsertRosInputSchema): the question must exist, the
 * declared answer_type must match the bank, and select/scale values must be
 * members of the question's option set. Returns an error string or null.
 */
export function validateAnswerAgainstBank(
  questionKey: string,
  answerType: RosQuestion["type"],
  answerValue: RosAnswerValue,
): string | null {
  const q = getQuestion(questionKey);
  if (!q) return `Unknown ROS question key "${questionKey}".`;
  if (q.type !== answerType) {
    return `Question "${questionKey}" expects answer type "${q.type}", got "${answerType}".`;
  }
  if (q.type === "single_select" || q.type === "scale") {
    const allowed = (q.options ?? []).map((o) => o.value);
    if (typeof answerValue !== "string" || !allowed.includes(answerValue)) {
      return `Value is not an option of "${questionKey}".`;
    }
  }
  if (q.type === "multi_select") {
    const allowed = new Set((q.options ?? []).map((o) => o.value));
    if (
      !Array.isArray(answerValue) ||
      answerValue.some((v) => !allowed.has(v))
    ) {
      return `One or more values are not options of "${questionKey}".`;
    }
  }
  return null;
}
