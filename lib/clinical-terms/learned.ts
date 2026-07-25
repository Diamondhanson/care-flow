/**
 * Clinical-term *learned* layer (Phase 16.10, re-backed in Stage 2).
 *
 * The learned layer is everything the seed JSON can't know ahead of time:
 *   - **custom terms** a doctor typed as free-text (not in any seed file), and
 *   - **usage counts** per term, so frequently-picked entries rank higher.
 *
 * Originally this lived in a device-only localStorage blob — a term one doctor
 * added never reached anyone else and vanished with the cache. It is now backed
 * by the synced `clinical_terms` rows in the local store (services/mockStorage),
 * so learned vocabulary flows through the ordinary outbox → Supabase → hydration
 * path: per-hospital, on every device, surviving cache resets.
 *
 * The public contract is unchanged, and a legacy device blob is imported (and
 * uploaded) once, the first time this module reads state for a hospital.
 *
 * Every export is SSR-safe: on the server reads return the empty state and
 * writes are no-ops.
 */

import type { ClinicalTerm, ClinicalTermCategory } from "@/types/healthcare";
import {
  addCustomClinicalTermRow,
  getActiveHospitalId,
  getClinicalTermRows,
  importLegacyLearnedState,
  recordClinicalTermUseRow,
} from "@/services/mockStorage";
import {
  applyCustomTerm,
  EMPTY_LEARNED,
  termKey,
  type LearnedState,
  type UsageMap,
} from "./search";

const LEGACY_KEY_PREFIX = "careflow_clinical_terms";

function isBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}

/** Legacy per-tenant storage key (pre-Stage-2 device-only blob). */
function legacyStorageKey(): string {
  const hospitalId = getActiveHospitalId();
  return hospitalId ? `${LEGACY_KEY_PREFIX}:${hospitalId}` : LEGACY_KEY_PREFIX;
}

/**
 * One-time migration: if the old device-only blob exists, convert it into
 * synced rows (which also uploads it), then remove the blob.
 */
function migrateLegacyBlobIfPresent(): void {
  if (!isBrowser()) return;
  const key = legacyStorageKey();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<LearnedState>;
    const custom = Array.isArray(parsed.custom) ? parsed.custom : [];
    const usage =
      parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};

    const byKey = new Map<
      string,
      {
        term_key: string;
        category: ClinicalTermCategory;
        custom_term: ClinicalTerm | null;
        usage_count: number;
        last_used_at: string | null;
      }
    >();
    for (const term of custom) {
      const k = termKey(term.category, term);
      byKey.set(k, {
        term_key: k,
        category: term.category,
        custom_term: term,
        usage_count: 0,
        last_used_at: null,
      });
    }
    for (const [k, stat] of Object.entries(usage)) {
      const category = k.split("::")[0] as ClinicalTermCategory;
      const existing = byKey.get(k);
      const count = typeof stat?.count === "number" ? stat.count : 0;
      const last =
        typeof stat?.lastUsedAt === "number"
          ? new Date(stat.lastUsedAt).toISOString()
          : null;
      if (existing) {
        existing.usage_count = count;
        existing.last_used_at = last;
      } else {
        byKey.set(k, {
          term_key: k,
          category,
          custom_term: null,
          usage_count: count,
          last_used_at: last,
        });
      }
    }
    importLegacyLearnedState([...byKey.values()]);
  } catch {
    /* an unreadable legacy blob is abandoned — the synced rows take over */
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* best-effort cleanup */
  }
}

/** The learned state for the active tenant, built from the synced rows. */
export function getLearnedState(): LearnedState {
  if (!isBrowser()) return EMPTY_LEARNED;
  migrateLegacyBlobIfPresent();
  const rows = getClinicalTermRows();
  if (rows.length === 0) return EMPTY_LEARNED;
  const custom: ClinicalTerm[] = [];
  const usage: UsageMap = {};
  for (const row of rows) {
    if (row.custom_term) custom.push(row.custom_term);
    if (row.usage_count > 0) {
      usage[row.term_key] = {
        count: row.usage_count,
        lastUsedAt: row.last_used_at ? Date.parse(row.last_used_at) : 0,
      };
    }
  }
  return { custom, usage };
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
  if (!isBrowser()) return {};
  recordClinicalTermUseRow(category, termKey(category, term), nowMs);
  return getLearnedState().usage;
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
  const { term } = applyCustomTerm(getLearnedState(), category, label, extra);
  if (isBrowser()) {
    addCustomClinicalTermRow(category, termKey(category, term), term);
  }
  return term;
}
