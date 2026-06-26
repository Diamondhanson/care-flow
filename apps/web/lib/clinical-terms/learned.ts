/**
 * Clinical-term *learned* layer — localStorage I/O wrapper (Phase 16.10).
 *
 * The learned layer is everything the seed JSON can't know ahead of time:
 *   - **custom terms** a doctor typed as free-text (not in any seed file), and
 *   - **usage counts** per term, so frequently-picked entries rank higher.
 *
 * All the actual state transitions are the pure reducers in `search.ts`
 * ({@link applyTermUse}, {@link applyCustomTerm}); this module only adds the
 * persistence — read the blob, run the reducer, write it back. It's scoped per
 * active hospital so one tenant's vocabulary never leaks into another's, exactly
 * how the future `clinical_terms` table will be RLS-scoped on the Supabase
 * cutover (Phase 17/18), at which point this file is swapped for table reads
 * with the same public contract.
 *
 * Every export is SSR-safe: on the server (no `window`) reads return the empty
 * state and writes are no-ops, so importing this from a Server Component or
 * during SSR never throws.
 */

import type { ClinicalTerm, ClinicalTermCategory } from "@/types/healthcare";
import { getActiveHospitalId } from "@/services/mockStorage";
import {
  applyCustomTerm,
  applyTermUse,
  EMPTY_LEARNED,
  type LearnedState,
  type UsageMap,
} from "./search";

const KEY_PREFIX = "careflow_clinical_terms";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}

/** Per-tenant storage key (falls back to a shared key before login). */
function storageKey(): string {
  const hospitalId = getActiveHospitalId();
  return hospitalId ? `${KEY_PREFIX}:${hospitalId}` : KEY_PREFIX;
}

/** The persisted learned state for the active tenant (empty on server). */
export function getLearnedState(): LearnedState {
  if (!isBrowser()) return EMPTY_LEARNED;
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return EMPTY_LEARNED;
    const parsed = JSON.parse(raw) as Partial<LearnedState>;
    return {
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      usage:
        parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {},
    };
  } catch {
    return EMPTY_LEARNED;
  }
}

function writeLearnedState(state: LearnedState): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {
    /* ignore persistence errors (private mode, quota, etc.) */
  }
}

/** Usage counts for the active tenant, keyed by term key. */
export function getUsageMap(): UsageMap {
  return getLearnedState().usage;
}

/** Doctor-added custom terms for one category. */
export function getCustomTerms(
  category: ClinicalTermCategory,
): ClinicalTerm[] {
  return getLearnedState().custom.filter((t) => t.category === category);
}

/**
 * Record one use of a term (increment count, stamp recency). Returns the new
 * usage map so callers can refresh ranking without a second read.
 */
export function recordTermUse(
  category: ClinicalTermCategory,
  term: Pick<ClinicalTerm, "term_en">,
  nowMs: number = Date.now(),
): UsageMap {
  const next = applyTermUse(getLearnedState(), category, term, nowMs);
  writeLearnedState(next);
  return next.usage;
}

/**
 * Add a doctor-typed custom term (free-text fallback). Idempotent by term key.
 * Returns the resolved term (the existing one if its key already existed).
 */
export function addCustomTerm(
  category: ClinicalTermCategory,
  label: string,
  extra?: Partial<Omit<ClinicalTerm, "category" | "term_en" | "term_fr">>,
): ClinicalTerm {
  const { state, term } = applyCustomTerm(
    getLearnedState(),
    category,
    label,
    extra,
  );
  writeLearnedState(state);
  return term;
}
