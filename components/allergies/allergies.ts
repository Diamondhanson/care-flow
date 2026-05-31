/**
 * Pure, storage-agnostic helpers for the patient allergy record — label/token
 * maps, quick-picks, and the severity-ordering used to surface the most
 * dangerous reaction first. No localStorage access here so these stay unit
 * testable in a plain node environment.
 */

import type { Allergy, AllergyCategory, AllergySeverity } from "@/types/healthcare";

export const ALLERGY_CATEGORY_LABEL: Record<AllergyCategory, string> = {
  drug: "Drug",
  food: "Food",
  environmental: "Environmental",
  other: "Other",
};

export const ALLERGY_SEVERITY_LABEL: Record<AllergySeverity, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
  life_threatening: "Life-threatening",
};

/** Maps each severity to a clinical `--status-*` token (worst = alert purple). */
export const ALLERGY_SEVERITY_TOKEN: Record<
  AllergySeverity,
  "treatment" | "boarding" | "muted"
> = {
  life_threatening: "treatment",
  severe: "treatment",
  moderate: "boarding",
  mild: "muted",
};

/** Sort weight — lower sorts first, so the most dangerous allergy leads. */
export const ALLERGY_SEVERITY_RANK: Record<AllergySeverity, number> = {
  life_threatening: 0,
  severe: 1,
  moderate: 2,
  mild: 3,
};

export const ALLERGY_CATEGORY_OPTIONS: AllergyCategory[] = [
  "drug",
  "food",
  "environmental",
  "other",
];

export const ALLERGY_SEVERITY_OPTIONS: AllergySeverity[] = [
  "mild",
  "moderate",
  "severe",
  "life_threatening",
];

/** Common allergens for the quick-pick datalist; category pre-fills on select. */
export const COMMON_ALLERGENS: { substance: string; category: AllergyCategory }[] =
  [
    { substance: "Penicillin", category: "drug" },
    { substance: "Sulfa drugs", category: "drug" },
    { substance: "Aspirin", category: "drug" },
    { substance: "NSAIDs", category: "drug" },
    { substance: "Codeine", category: "drug" },
    { substance: "Iodine contrast", category: "drug" },
    { substance: "Peanuts", category: "food" },
    { substance: "Shellfish", category: "food" },
    { substance: "Eggs", category: "food" },
    { substance: "Latex", category: "environmental" },
    { substance: "Pollen", category: "environmental" },
    { substance: "Bee stings", category: "environmental" },
  ];

/** Look up the category most associated with a known allergen (for auto-fill). */
export function categoryForAllergen(substance: string): AllergyCategory | null {
  const match = COMMON_ALLERGENS.find(
    (a) => a.substance.toLowerCase() === substance.trim().toLowerCase(),
  );
  return match ? match.category : null;
}

/** Worst-first, then alphabetical by substance — the order to display them in. */
export function sortAllergiesBySeverity<
  T extends Pick<Allergy, "severity" | "substance">,
>(allergies: T[]): T[] {
  return [...allergies].sort((a, b) => {
    const byRank =
      ALLERGY_SEVERITY_RANK[a.severity] - ALLERGY_SEVERITY_RANK[b.severity];
    if (byRank !== 0) return byRank;
    return a.substance.localeCompare(b.substance);
  });
}

/** The single most severe allergy level present, or null when the list is empty. */
export function highestSeverity(
  allergies: Pick<Allergy, "severity">[],
): AllergySeverity | null {
  if (allergies.length === 0) return null;
  return allergies.reduce<AllergySeverity>((worst, a) => {
    return ALLERGY_SEVERITY_RANK[a.severity] < ALLERGY_SEVERITY_RANK[worst]
      ? a.severity
      : worst;
  }, "mild");
}

/**
 * The three states the allergy banner can show. "unassessed" (empty list and
 * not confirmed) is deliberately distinct from "none" — never imply a patient
 * is allergy-free when no one has asked.
 */
export type AllergyDisplayState = "has-allergies" | "none" | "unassessed";

export function allergyDisplayState(
  noKnownAllergies: boolean,
  allergyCount: number,
): AllergyDisplayState {
  if (allergyCount > 0) return "has-allergies";
  if (noKnownAllergies) return "none";
  return "unassessed";
}
