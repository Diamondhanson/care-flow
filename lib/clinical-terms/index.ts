/**
 * Clinical-term library — seed loader + public search API (Phase 16.10).
 *
 * The *seed* layer is the bundled JSON in `data/clinical-terms/`, one file per
 * category. Each file is a flat array of category-less {@link ClinicalTermSeed}
 * objects (cleaner to hand-edit / paste into); this module stamps the category
 * from the filename so the rest of the app sees fully-formed {@link ClinicalTerm}s.
 *
 * The *learned* layer (doctor-added custom terms + per-term usage counts) lives
 * in `learned.ts` behind an SSR guard. `searchTerms` composes the two: seed +
 * learned-custom are de-duplicated, then ranked with the learned usage map so
 * frequently-picked terms float to the top.
 *
 * Everything stateful is delegated to the pure helpers in `search.ts`, so this
 * module stays a thin wiring layer.
 */

import type {
  ClinicalTerm,
  ClinicalTermCategory,
  ClinicalTermSeed,
} from "@/types/healthcare";
import { DEFAULT_LOCALE, type Locale } from "@/i18n";

import subjectiveSeed from "@/data/clinical-terms/subjective.json";
import examinationSeed from "@/data/clinical-terms/examination.json";
import assessmentSeed from "@/data/clinical-terms/assessment.json";
import planSeed from "@/data/clinical-terms/plan.json";
import medicationSeed from "@/data/clinical-terms/medication.json";
import investigationsSeed from "@/data/clinical-terms/investigations.json";

import { dedupeTerms, rankTerms } from "./search";
import { getCustomTerms, getUsageMap } from "./learned";

/** Stamp `category` onto every seed entry from its source file. */
function withCategory(
  category: ClinicalTermCategory,
  seeds: readonly ClinicalTermSeed[],
): ClinicalTerm[] {
  return seeds.map((s) => ({ ...s, category }));
}

/** All bundled seed terms, fully-formed, grouped by category. */
export const SEED_TERMS: Record<ClinicalTermCategory, ClinicalTerm[]> = {
  subjective: withCategory("subjective", subjectiveSeed as ClinicalTermSeed[]),
  examination: withCategory("examination", examinationSeed as ClinicalTermSeed[]),
  assessment: withCategory("assessment", assessmentSeed as ClinicalTermSeed[]),
  plan: withCategory("plan", planSeed as ClinicalTermSeed[]),
  medication: withCategory("medication", medicationSeed as ClinicalTermSeed[]),
  investigations: withCategory(
    "investigations",
    investigationsSeed as ClinicalTermSeed[],
  ),
};

export const CLINICAL_TERM_CATEGORIES = Object.keys(
  SEED_TERMS,
) as ClinicalTermCategory[];

/**
 * Seed + learned-custom terms for one category, de-duplicated by term key.
 * Learned-custom terms come first so a doctor's own entry wins a key collision.
 */
export function allTerms(category: ClinicalTermCategory): ClinicalTerm[] {
  return dedupeTerms(getCustomTerms(category), SEED_TERMS[category]);
}

export interface SearchTermsOptions {
  limit?: number;
}

/**
 * The public search entry point used by the autocomplete UI: filter the
 * category's terms (seed + learned) by `query`, ranked by match strength →
 * usage → recency → label. An empty query returns the top terms by usage.
 */
export function searchTerms(
  category: ClinicalTermCategory,
  query: string,
  locale: Locale = DEFAULT_LOCALE,
  options: SearchTermsOptions = {},
): ClinicalTerm[] {
  return rankTerms(
    allTerms(category),
    query,
    locale,
    getUsageMap(),
    options.limit,
  );
}

export { recordTermUse, addCustomTerm } from "./learned";
