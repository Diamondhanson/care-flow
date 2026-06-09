/**
 * Clinical-term search — pure layer (Phase 16.10).
 *
 * Everything here is a pure transform: terms + query + usage in, ranked matches
 * out. No React, no DOM, no localStorage — so the matching/ranking and the
 * learned-state reducers are directly unit-testable in node, and reused verbatim
 * by the `learned` I/O wrapper and the `TermAutocomplete` UI.
 *
 * Matching is accent-insensitive and spans the canonical EN/FR terms plus every
 * synonym (incl. lay terms), so partial or colloquial spellings still surface
 * the right entry.
 */

import type { ClinicalTerm, ClinicalTermCategory } from "@/types/healthcare";
import type { Locale } from "@/i18n";

/** Lowercase + strip diacritics, for accent-insensitive matching. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Every string a term can be matched against (canonical + synonyms, both langs). */
export function matchStrings(term: ClinicalTerm): string[] {
  return [
    term.term_en,
    term.term_fr,
    ...(term.synonyms_en ?? []),
    ...(term.synonyms_fr ?? []),
  ].filter((s): s is string => Boolean(s && s.trim()));
}

/**
 * Match strength of a term against an already-normalized query. Higher is
 * better; 0 means no match. An empty query matches everything equally (1) so
 * ranking falls through to usage → recency → alphabetical.
 *
 *  3 — a match-string equals the query exactly
 *  2 — a match-string starts with the query
 *  1 — a word inside a match-string starts with the query
 *  0.5 — the query appears somewhere inside a match-string
 */
export function matchScore(term: ClinicalTerm, normalizedQuery: string): number {
  if (!normalizedQuery) return 1;
  let best = 0;
  for (const raw of matchStrings(term)) {
    const s = normalizeText(raw);
    if (!s) continue;
    if (s === normalizedQuery) return 3;
    if (s.startsWith(normalizedQuery)) {
      best = Math.max(best, 2);
      continue;
    }
    if (s.split(/\s+/).some((w) => w.startsWith(normalizedQuery))) {
      best = Math.max(best, 1);
      continue;
    }
    if (s.includes(normalizedQuery)) best = Math.max(best, 0.5);
  }
  return best;
}

/** Usage statistics for one term, keyed by {@link termKey}. */
export interface UsageStat {
  count: number;
  lastUsedAt: number;
}

export type UsageMap = Record<string, UsageStat>;

/** Stable identity for a term: category + its normalized canonical English. */
export function termKey(
  category: ClinicalTermCategory,
  term: Pick<ClinicalTerm, "term_en">,
): string {
  return `${category}::${normalizeText(term.term_en)}`;
}

/** The label to show for a term in the active locale (falls back across langs). */
export function displayTerm(term: ClinicalTerm, locale: Locale): string {
  return locale === "fr"
    ? term.term_fr || term.term_en
    : term.term_en || term.term_fr;
}

/** Merge seed + learned-custom terms, de-duplicating by {@link termKey}. */
export function dedupeTerms(...lists: readonly ClinicalTerm[][]): ClinicalTerm[] {
  const seen = new Set<string>();
  const out: ClinicalTerm[] = [];
  for (const list of lists) {
    for (const term of list) {
      const key = termKey(term.category, term);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

/**
 * Filter to matching terms and rank them, capped at `limit`. Ranking order:
 * match strength → usage count → recency → display-label alphabetical.
 */
export function rankTerms(
  terms: readonly ClinicalTerm[],
  query: string,
  locale: Locale,
  usage: UsageMap,
  limit = 30,
): ClinicalTerm[] {
  const q = normalizeText(query);
  const scored: {
    term: ClinicalTerm;
    score: number;
    count: number;
    last: number;
    label: string;
  }[] = [];

  for (const term of terms) {
    const score = matchScore(term, q);
    if (score <= 0) continue;
    const stat = usage[termKey(term.category, term)];
    scored.push({
      term,
      score,
      count: stat?.count ?? 0,
      last: stat?.lastUsedAt ?? 0,
      label: displayTerm(term, locale),
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.count - a.count ||
      b.last - a.last ||
      a.label.localeCompare(b.label),
  );

  return scored.slice(0, limit).map((s) => s.term);
}

// ---------------------------------------------------------------------------
// Learned-state reducers (pure) — the `learned` module wraps these with I/O.
// ---------------------------------------------------------------------------

/** The persisted learned layer: doctor-added terms + per-term usage counts. */
export interface LearnedState {
  custom: ClinicalTerm[];
  usage: UsageMap;
}

export const EMPTY_LEARNED: LearnedState = { custom: [], usage: {} };

/** Record one use of a term (increment count, stamp recency). Returns new state. */
export function applyTermUse(
  state: LearnedState,
  category: ClinicalTermCategory,
  term: Pick<ClinicalTerm, "term_en">,
  nowMs: number,
): LearnedState {
  const key = termKey(category, term);
  const prev = state.usage[key];
  return {
    custom: state.custom,
    usage: {
      ...state.usage,
      [key]: { count: (prev?.count ?? 0) + 1, lastUsedAt: nowMs },
    },
  };
}

/**
 * Add a doctor-typed custom term (free-text fallback). Idempotent: a term whose
 * key already exists in `custom` is left untouched. Returns new state + the term.
 */
export function applyCustomTerm(
  state: LearnedState,
  category: ClinicalTermCategory,
  label: string,
  extra?: Partial<Omit<ClinicalTerm, "category" | "term_en" | "term_fr">>,
): { state: LearnedState; term: ClinicalTerm } {
  const trimmed = label.trim();
  const key = termKey(category, { term_en: trimmed });
  const existing = state.custom.find((c) => termKey(c.category, c) === key);
  if (existing) return { state, term: existing };
  const term: ClinicalTerm = {
    category,
    term_en: trimmed,
    term_fr: trimmed,
    ...extra,
  };
  return { state: { custom: [...state.custom, term], usage: state.usage }, term };
}
