/**
 * Pure, storage-agnostic helpers for the editable ward/bed floor map — bed
 * status label/token maps, occupancy tallies, floor grouping, and the bed-label
 * numbering used when an admin adds beds. No localStorage access here so these
 * stay unit-testable in a plain node environment.
 */

import type { Bed, BedStatus } from "@/types/healthcare";

/** i18n keys — resolve with `t(BED_STATUS_LABEL[status])`. */
export const BED_STATUS_LABEL: Record<BedStatus, string> = {
  free: "bedStatus.free",
  occupied: "bedStatus.occupied",
  reserved: "bedStatus.reserved",
  cleaning: "bedStatus.cleaning",
  maintenance: "bedStatus.maintenance",
};

/** Maps each bed status to a clinical `--status-*` token. */
export const BED_STATUS_TOKEN: Record<
  BedStatus,
  "clearance" | "treatment" | "boarding" | "diagnostics" | "muted"
> = {
  free: "clearance",
  occupied: "treatment",
  reserved: "boarding",
  cleaning: "diagnostics",
  maintenance: "muted",
};

/** Statuses an admin may set by hand on a bed that holds no patient. */
export const MANUAL_BED_STATUSES: BedStatus[] = [
  "free",
  "reserved",
  "cleaning",
  "maintenance",
];

export interface BedTally {
  total: number;
  /** A patient is physically in the bed. */
  occupied: number;
  /** Ready to receive a patient. */
  available: number;
  /** Reserved / cleaning / maintenance — neither free nor holding a patient. */
  unavailable: number;
}

/** Count beds by availability for a ward/floor header. */
export function tallyBeds(beds: Pick<Bed, "status">[]): BedTally {
  let occupied = 0;
  let available = 0;
  let unavailable = 0;
  for (const bed of beds) {
    if (bed.status === "occupied") occupied += 1;
    else if (bed.status === "free") available += 1;
    else unavailable += 1;
  }
  return { total: beds.length, occupied, available, unavailable };
}

/** True when at least one bed is free to receive a patient. */
export function hasAvailableBed(beds: Pick<Bed, "status">[]): boolean {
  return beds.some((b) => b.status === "free");
}

/**
 * The next `count` "Bed N" labels, continuing past the highest trailing number
 * already present so appended beds never collide. A fresh ward (no existing
 * labels) starts at "Bed 1".
 */
export function nextBedLabels(existing: string[], count: number): string[] {
  let max = 0;
  for (const label of existing) {
    const match = label.match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  const labels: string[] = [];
  for (let i = 1; i <= Math.max(0, Math.floor(count)); i += 1) {
    labels.push(`Bed ${max + i}`);
  }
  return labels;
}

/**
 * Group items carrying a `floor_label` into ordered floor buckets. Null/blank
 * labels collapse into a single "Unassigned floor" bucket placed last. Floors
 * otherwise keep first-seen order.
 */
export function groupByFloor<T extends { floor_label: string | null }>(
  items: T[],
): { floor: string; items: T[] }[] {
  const UNASSIGNED = "Unassigned floor";
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const floor = item.floor_label?.trim() || UNASSIGNED;
    if (!buckets.has(floor)) {
      buckets.set(floor, []);
      order.push(floor);
    }
    buckets.get(floor)!.push(item);
  }
  order.sort((a, b) => {
    if (a === UNASSIGNED) return 1;
    if (b === UNASSIGNED) return -1;
    return 0;
  });
  return order.map((floor) => ({ floor, items: buckets.get(floor)! }));
}
