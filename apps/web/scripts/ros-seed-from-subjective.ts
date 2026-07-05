/**
 * ROS question-bank generator (Phase 21B): promote the system-tagged symptom
 * vocabulary in `data/clinical-terms/subjective.json` into boolean questions in
 * the per-system bank files `data/ros/<system>.json`.
 *
 * Merge-idempotent by design — safe to re-run at any time:
 *   - An entry whose `key` already exists in the target file is kept VERBATIM,
 *     so hand-authored edits to generated entries (follow-ups, options,
 *     key_question flags) always survive a re-run.
 *   - Missing keys are appended in source order.
 *   - Hand-authored nodes whose keys don't come from the vocabulary (history /
 *     genetic questions, extra symptoms) are never touched.
 *   - Re-running on a clean tree therefore produces a zero diff.
 *
 * Run: pnpm dlx tsx scripts/ros-seed-from-subjective.ts   (from apps/web)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, "../data/clinical-terms/subjective.json");
const OUT_DIR = join(here, "../data/ros");

/** Exact `system` strings used in the clinical-term library → bank file names. */
const SYSTEM_TO_FILE: Record<string, string> = {
  General: "general",
  Cardiac: "cardiac",
  Respiratory: "respiratory",
  GI: "gi",
  GU: "gu",
  Neuro: "neuro",
  ENT: "ent",
  Eyes: "eyes",
  Skin: "skin",
  Musculoskeletal: "musculoskeletal",
  Psych: "psych",
  "Obstetric/Gynae": "obstetric_gynae",
};

interface SubjectiveTerm {
  term_en: string;
  term_fr: string;
  synonyms_en?: string[];
  synonyms_fr?: string[];
  system: string;
}

interface RosQuestionNode {
  key: string;
  system: string;
  kind: string;
  prompt_en: string;
  prompt_fr: string;
  type: string;
  key_question?: boolean;
  sex?: string | null;
  report_phrase_en?: string;
  report_phrase_fr?: string;
  options?: unknown[];
  triggers?: string[];
  followups?: unknown[];
  [extra: string]: unknown;
}

/** "Loss of appetite" → "loss_of_appetite"; diacritics stripped (NFD). */
function slug(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Lower-case the leading letter for mid-sentence report phrases. */
function phrase(term: string): string {
  return term.charAt(0).toLowerCase() + term.slice(1);
}

const terms: SubjectiveTerm[] = JSON.parse(readFileSync(SOURCE, "utf8"));
mkdirSync(OUT_DIR, { recursive: true });

let generated = 0;
let kept = 0;

for (const [systemLabel, file] of Object.entries(SYSTEM_TO_FILE)) {
  const outPath = join(OUT_DIR, `${file}.json`);
  const existing: RosQuestionNode[] = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : [];
  const byKey = new Map(existing.map((q) => [q.key, q]));

  const systemTerms = terms.filter((t) => t.system === systemLabel);
  const additions: RosQuestionNode[] = [];

  for (const t of systemTerms) {
    const key = `${file}.${slug(t.term_en)}`;
    if (byKey.has(key)) {
      kept++;
      continue; // authored/previous entry wins — never overwritten
    }
    additions.push({
      key,
      system: file,
      kind: "symptom",
      prompt_en: `${t.term_en}?`,
      prompt_fr: `${t.term_fr} ?`,
      type: "boolean",
      key_question: false,
      sex: file === "obstetric_gynae" ? "female" : null,
      report_phrase_en: phrase(t.term_en),
      report_phrase_fr: phrase(t.term_fr),
    });
    generated++;
  }

  if (additions.length > 0 || !existsSync(outPath)) {
    writeFileSync(
      outPath,
      JSON.stringify([...existing, ...additions], null, 2) + "\n",
    );
  }
}

console.log(
  `ros-seed: ${generated} generated, ${kept} kept verbatim across ${Object.keys(SYSTEM_TO_FILE).length} system files`,
);
