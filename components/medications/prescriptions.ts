/**
 * Shared, pure helpers for the prescriptions + Medication Administration Record
 * (MAR) surfaces (Phase 10). No storage access — everything here is a pure
 * function or a constant map, so it is safe to import from any component and is
 * directly unit-testable (see prescriptions.test.ts).
 *
 * The doctor writes the *structure* of the medication (a `Prescription`); the
 * nurse records what actually happened at the bedside for each scheduled dose
 * (a `MedicationAdministration`). These helpers turn a prescription's free-text
 * frequency into a dosing interval and compute when the next dose is due, so the
 * MAR worklist can sort "overdue" doses to the top without a real scheduler.
 */

import type {
  MarStatus,
  MedicationAdministration,
  Prescription,
  PrescriptionStatus,
} from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Label + theme-token maps (mirror the orders.ts convention)
// ---------------------------------------------------------------------------

/** i18n keys — resolve with `t(PRESCRIPTION_STATUS_LABEL[status])`. */
export const PRESCRIPTION_STATUS_LABEL: Record<PrescriptionStatus, string> = {
  active: "prescriptionStatus.active",
  completed: "prescriptionStatus.completed",
  discontinued: "prescriptionStatus.discontinued",
};

/** Suffix of the `--status-{token}` CSS variable, or "muted" for a plain chip. */
export const PRESCRIPTION_STATUS_TOKEN: Record<
  PrescriptionStatus,
  "diagnostics" | "discharge" | "muted"
> = {
  active: "diagnostics",
  completed: "discharge",
  discontinued: "muted",
};

/** i18n keys — resolve with `t(MAR_STATUS_LABEL[status])`. */
export const MAR_STATUS_LABEL: Record<MarStatus, string> = {
  given: "marStatus.given",
  held: "marStatus.held",
  refused: "marStatus.refused",
  missed: "marStatus.missed",
};

/** Theme token per MAR outcome. "muted" renders as a plain (un-tinted) chip. */
export const MAR_STATUS_TOKEN: Record<
  MarStatus,
  "clearance" | "diagnostics" | "treatment" | "muted"
> = {
  given: "clearance",
  held: "diagnostics",
  refused: "treatment",
  missed: "muted",
};

// ---------------------------------------------------------------------------
// Quick-pick options for the prescription entry form
// ---------------------------------------------------------------------------

/** Common administration routes offered as datalist suggestions. */
export const ROUTE_OPTIONS: string[] = [
  "oral",
  "IV",
  "IM",
  "SC",
  "topical",
  "inhaled",
  "rectal",
  "sublingual",
];

/**
 * Common dosing frequencies. The phrasing here is what {@link parseFrequencyHours}
 * understands, so quick-picks always yield a schedulable interval.
 */
export const FREQUENCY_OPTIONS: string[] = [
  "once daily",
  "twice daily",
  "three times daily",
  "four times daily",
  "every 4 hours",
  "every 6 hours",
  "every 8 hours",
  "every 12 hours",
  "at night",
  "as required",
];

// ---------------------------------------------------------------------------
// Status predicate
// ---------------------------------------------------------------------------

/** A prescription still generates due doses only while it is active. */
export function isPrescriptionActive(status: PrescriptionStatus): boolean {
  return status === "active";
}

// ---------------------------------------------------------------------------
// Frequency parsing — free text → dosing interval in hours
// ---------------------------------------------------------------------------

const TIMES_PER_DAY_WORDS: Record<string, number> = {
  once: 1,
  one: 1,
  twice: 2,
  two: 2,
  three: 3,
  thrice: 3,
  four: 4,
};

/**
 * Parse a free-text frequency into a dosing interval in hours.
 *
 *  - "every 8 hours" / "q8h" / "8 hourly"  → 8
 *  - "once daily" / "od" / "daily" / "at night" → 24
 *  - "twice daily" / "bd" / "bid"          → 12
 *  - "three times daily" / "tds" / "tid"   → 8
 *  - "four times daily" / "qds" / "qid"    → 6
 *  - "as required" / "prn" / "as needed"   → null (no fixed schedule)
 *
 * Returns null when the frequency is PRN or cannot be understood — the dose is
 * then treated as on-demand rather than scheduled.
 */
export function parseFrequencyHours(frequency: string | null): number | null {
  if (!frequency) return null;
  const f = frequency.trim().toLowerCase();
  if (f === "") return null;

  // On-demand / as-needed — no fixed interval.
  if (/\b(prn|as required|as needed|when required|sos)\b/.test(f)) return null;

  // "every N hours" / "N hourly" / "qNh".
  const everyN =
    f.match(/every\s+(\d+(?:\.\d+)?)\s*(?:h|hour|hours|hrs?)/) ??
    f.match(/(\d+(?:\.\d+)?)\s*(?:h|hour|hours|hrs?)\s*ly/) ??
    f.match(/\bq\s*(\d+(?:\.\d+)?)\s*h\b/);
  if (everyN) {
    const hours = Number(everyN[1]);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }

  // "<word> times a day/daily" or "<word> daily" — checked before the bare
  // "daily" fallback so "three times daily" isn't mistaken for once daily.
  const perDayWord = f.match(
    /\b(once|twice|thrice|one|two|three|four)\b.*\b(?:times\s+)?(?:a\s+day|daily|per\s+day)\b/,
  );
  if (perDayWord) {
    const n = TIMES_PER_DAY_WORDS[perDayWord[1]];
    if (n) return 24 / n;
  }

  // "N times a day" (numeric).
  const perDayNum = f.match(/(\d+)\s*times?\s*(?:a\s+day|daily|per\s+day)/);
  if (perDayNum) {
    const n = Number(perDayNum[1]);
    if (Number.isFinite(n) && n > 0) return 24 / n;
  }

  // Latin shorthand commonly seen on a drug chart.
  if (/\b(qds|qid)\b/.test(f)) return 6;
  if (/\b(tds|tid)\b/.test(f)) return 8;
  if (/\b(bd|bid)\b/.test(f)) return 12;

  // Once-daily phrasings (Latin od/nocte/mane, plain daily, at night, nightly).
  if (
    /\b(od|nocte|mane|daily|nightly|at night|every day|each day)\b/.test(f)
  ) {
    return 24;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dose scheduling — when is the next dose due?
// ---------------------------------------------------------------------------

/**
 * - `due`      — scheduled time has arrived (within the grace window).
 * - `overdue`  — past due beyond the grace window; needs attention now.
 * - `upcoming` — scheduled, but not due yet.
 * - `prn`      — on-demand (no fixed schedule); given when clinically needed.
 * - `inactive` — prescription completed/discontinued; no doses generated.
 */
export type DoseState = "due" | "overdue" | "upcoming" | "prn" | "inactive";

export interface DoseStatus {
  state: DoseState;
  /** ISO timestamp the next dose is due, or null for PRN / inactive. */
  nextDueAt: string | null;
  /** ISO timestamp the most recent dose was actually given, or null. */
  lastGivenAt: string | null;
}

/** A dose more than this far past its due time is escalated to "overdue". */
export const OVERDUE_GRACE_MS = 30 * 60_000;

/** Sort weight so the worklist surfaces the most urgent doses first. */
export const DOSE_STATE_ORDER: Record<DoseState, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  prn: 3,
  inactive: 4,
};

/**
 * Compute the dosing state of a prescription from its frequency and the doses
 * already administered. Pure: the caller passes `now` (ms since epoch) so the
 * result is deterministic and testable.
 *
 * Scheduling model (deliberately simple, for the mock):
 *  - Inactive prescriptions generate no doses.
 *  - PRN prescriptions have no fixed next-due time.
 *  - The next dose is due `interval` hours after the last *given* dose. If none
 *    has been given yet, the first dose is due from when it was prescribed.
 */
export function computeDoseStatus(
  prescription: Pick<Prescription, "frequency" | "status" | "created_at">,
  administrations: Pick<
    MedicationAdministration,
    "status" | "administered_at"
  >[],
  now: number = Date.now(),
): DoseStatus {
  if (!isPrescriptionActive(prescription.status)) {
    return { state: "inactive", nextDueAt: null, lastGivenAt: null };
  }

  const lastGivenAt = administrations
    .filter((a) => a.status === "given" && a.administered_at)
    .map((a) => a.administered_at as string)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;

  const intervalHours = parseFrequencyHours(prescription.frequency);
  if (intervalHours === null) {
    return { state: "prn", nextDueAt: null, lastGivenAt };
  }

  const anchor = lastGivenAt ?? prescription.created_at;
  const nextDueMs = new Date(anchor).getTime() + intervalHours * 3600_000;
  const nextDueAt = new Date(nextDueMs).toISOString();
  const delta = now - nextDueMs;

  let state: DoseState;
  if (delta < 0) state = "upcoming";
  else if (delta <= OVERDUE_GRACE_MS) state = "due";
  else state = "overdue";

  return { state, nextDueAt, lastGivenAt };
}
