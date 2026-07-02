/**
 * Complaint → system routing (Phase 21).
 *
 * The chief complaint chosen at intake usually comes from the clinical-term
 * library, whose subjective terms carry a `system` tag ("Cardiac",
 * "Obstetric/Gynae", …). This module normalizes that tag to a `BodySystem`
 * and resolves free-text complaints back to a term so the doctor's ROS block
 * can auto-open the right module.
 *
 * v1 ships primary-system routing only (free from the existing tags). The
 * curated secondary map (e.g. chest pain → also review respiratory + GI) is a
 * Phase-F refinement — additions go in SECONDARY_SYSTEMS below.
 */

import type { BodySystem } from "@careflow/shared";
import { SEED_TERMS } from "@/lib/clinical-terms";

/**
 * Normalize a clinical-term `system` label to a `BodySystem`:
 * lowercase, `/` and spaces → `_`, "Obstetric/Gynae" → "obstetric_gynae".
 */
export function normalizeSystem(label: string): BodySystem | null {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, "_");
  const KNOWN: Record<string, BodySystem> = {
    general: "general",
    cardiac: "cardiac",
    respiratory: "respiratory",
    gi: "gi",
    gu: "gu",
    neuro: "neuro",
    ent: "ent",
    eyes: "eyes",
    skin: "skin",
    musculoskeletal: "musculoskeletal",
    psych: "psych",
    obstetric_gynae: "obstetric_gynae",
  };
  return KNOWN[normalized] ?? null;
}

/**
 * Resolve one term/complaint line to its body system by matching the
 * subjective term library (term_en / term_fr / synonyms, case-insensitive).
 */
export function systemForTerm(term: string): BodySystem | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  for (const t of SEED_TERMS.subjective) {
    if (
      t.term_en.toLowerCase() === needle ||
      t.term_fr.toLowerCase() === needle ||
      (t.synonyms_en ?? []).some((s) => s.toLowerCase() === needle) ||
      (t.synonyms_fr ?? []).some((s) => s.toLowerCase() === needle)
    ) {
      return t.system ? normalizeSystem(t.system) : null;
    }
  }
  return null;
}

/**
 * Curated complaint-system → additional systems worth reviewing for a
 * differential. Populated in Phase 21F; empty = primary-only routing.
 */
export const SECONDARY_SYSTEMS: Partial<Record<BodySystem, BodySystem[]>> = {};

export interface ComplaintRouting {
  primary: BodySystem | null;
  secondary: BodySystem[];
}

/**
 * Route a chief complaint to ROS systems. Chief complaints written via the
 * intake chips may hold several newline-separated terms — the first line that
 * resolves wins as primary; other resolving lines join the secondary set.
 */
export function systemsForComplaint(chiefComplaint: string): ComplaintRouting {
  const lines = chiefComplaint
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let primary: BodySystem | null = null;
  const secondary = new Set<BodySystem>();

  for (const line of lines) {
    const system = systemForTerm(line);
    if (!system) continue;
    if (!primary) {
      primary = system;
    } else if (system !== primary) {
      secondary.add(system);
    }
  }

  for (const extra of primary ? (SECONDARY_SYSTEMS[primary] ?? []) : []) {
    if (extra !== primary) secondary.add(extra);
  }

  return { primary, secondary: [...secondary] };
}
