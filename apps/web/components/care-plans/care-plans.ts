/**
 * Pure, storage-agnostic helpers for the nursing care plan — the category
 * ordering + label keys for the quick-pick, an icon map, and the small bits of
 * derived state the page reads (active-need counts, the handover-waiting cue).
 * No localStorage access here so these stay unit-testable in plain node.
 */

import {
  Activity,
  Bath,
  Bed,
  Brain,
  Croissant,
  Droplets,
  HandHeart,
  HeartPulse,
  MessageCircleHeart,
  Moon,
  Shield,
  Shirt,
  Sparkles,
  Thermometer,
  type LucideIcon,
} from "lucide-react";

import type {
  CareNeedCategory,
  CarePlanEntry,
  CarePlanItem,
} from "@/types/healthcare";

/**
 * Display order for the 14 care-need categories (Henderson's components, named
 * practically) — the order they appear in the quick-pick and any grouped list.
 */
export const CARE_NEED_CATEGORIES: CareNeedCategory[] = [
  "breathing",
  "nutrition",
  "elimination",
  "mobility_positioning",
  "sleep_rest",
  "hygiene",
  "temperature",
  "dressing",
  "safety",
  "communication_emotional",
  "pain_comfort",
  "spiritual",
  "wound_skin_care",
  "other",
];

/** i18n keys — resolve with `t(CARE_NEED_CATEGORY_LABEL[category])`. */
export const CARE_NEED_CATEGORY_LABEL: Record<CareNeedCategory, string> = {
  breathing: "carePlan.category.breathing",
  nutrition: "carePlan.category.nutrition",
  elimination: "carePlan.category.elimination",
  mobility_positioning: "carePlan.category.mobility_positioning",
  sleep_rest: "carePlan.category.sleep_rest",
  hygiene: "carePlan.category.hygiene",
  temperature: "carePlan.category.temperature",
  dressing: "carePlan.category.dressing",
  safety: "carePlan.category.safety",
  communication_emotional: "carePlan.category.communication_emotional",
  pain_comfort: "carePlan.category.pain_comfort",
  spiritual: "carePlan.category.spiritual",
  wound_skin_care: "carePlan.category.wound_skin_care",
  other: "carePlan.category.other",
};

/** A small icon per category so the plan reads at a glance. */
export const CARE_NEED_CATEGORY_ICON: Record<CareNeedCategory, LucideIcon> = {
  breathing: HeartPulse,
  nutrition: Croissant,
  elimination: Droplets,
  mobility_positioning: Bed,
  sleep_rest: Moon,
  hygiene: Bath,
  temperature: Thermometer,
  dressing: Shirt,
  safety: Shield,
  communication_emotional: MessageCircleHeart,
  pain_comfort: HandHeart,
  spiritual: Sparkles,
  wound_skin_care: Activity,
  other: Brain,
};

/** Active needs first, then oldest-first within a status — the stable plan order. */
export function sortCarePlanItems<
  T extends Pick<CarePlanItem, "status" | "created_at">,
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Count of still-active care needs. */
export function activeNeedCount(
  items: Pick<CarePlanItem, "status">[],
): number {
  return items.filter((i) => i.status === "active").length;
}

/** The most recent handover note in a log, or null when there is none. */
export function latestHandover<
  T extends Pick<CarePlanEntry, "is_handover" | "recorded_at">,
>(entries: T[]): T | null {
  return (
    [...entries]
      .filter((e) => e.is_handover)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0] ?? null
  );
}

/**
 * Whether a "handover waiting" cue should show for an admission — true when at
 * least one handover note exists. (Read-tracking per nurse arrives with real
 * auth in Phase 17; until then the presence of a handover is the signal.)
 */
export function hasHandoverWaiting(
  entries: Pick<CarePlanEntry, "is_handover">[],
): boolean {
  return entries.some((e) => e.is_handover);
}
