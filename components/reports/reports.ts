/**
 * Reporting & analytics — pure aggregation layer (Phase 12).
 *
 * Every function here is a pure transform from raw collections (read out of the
 * service layer by the page) into chart-ready shapes. No persistence, no React,
 * no DOM — so the whole module is unit-testable in node and reused verbatim by
 * the on-screen dashboard and the PDF/Excel exporters (one source of truth, the
 * numbers never drift between the screen and the download).
 */

import type {
  Admission,
  Bed,
  CareStage,
  Department,
  Diagnosis,
  Patient,
  Result,
  Sex,
  Visit,
  VisitType,
  Ward,
} from "@/types/healthcare";
import { translate } from "@/i18n";

/** Minimal translator shape (matches `useT().t`) used by the render/export layer. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Resolve a slice's display label: a localized `labelKey` wins over raw data. */
export function sliceLabel(slice: CountSlice, t: Translate): string {
  return slice.labelKey ? t(slice.labelKey) : slice.label;
}

/** English label baked from the dictionary — kept so the screen/export have a
 *  sensible fallback and the pure tests can assert without a translator. */
function en(key: string): string {
  return translate("en", key);
}

// ---------------------------------------------------------------------------
// Palette — the categorical chart colors, paired so the screen (CSS vars) and
// the PDF (sRGB) render the same hue for the same series index.
// ---------------------------------------------------------------------------

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

/** sRGB equivalents of CHART_COLORS (light variant) for the PDF exporter. */
export const CHART_RGB: readonly (readonly [number, number, number])[] = [
  [63, 111, 214],
  [139, 92, 246],
  [33, 164, 90],
  [224, 161, 6],
  [20, 151, 181],
  [224, 64, 90],
  [226, 112, 29],
  [210, 63, 154],
];

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

// i18n message keys — resolve with the active `t` (or `en()` for a fallback).
export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  outpatient: "visitType.outpatient",
  inpatient: "visitType.inpatient",
  emergency: "visitType.emergency",
};

export const CARE_STAGE_LABEL: Record<CareStage, string> = {
  registration: "stage.registration",
  triage: "stage.triage",
  consultation: "stage.consultation",
  diagnostics: "stage.diagnostics",
  treatment: "stage.treatment",
  discharge_planning: "stage.discharge_planning",
  discharged: "stage.discharged",
  followed_up: "stage.followed_up",
};

const SEX_LABEL: Record<Sex, string> = {
  male: "sex.male",
  female: "sex.female",
  other: "sex.other",
  unknown: "sex.unknown",
};

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

export type RangePreset = "7d" | "30d" | "90d" | "all" | "custom";

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  "7d": "rangePreset.7d",
  "30d": "rangePreset.30d",
  "90d": "rangePreset.90d",
  all: "rangePreset.all",
  custom: "rangePreset.custom",
};

export interface DateRange {
  startMs: number;
  endMs: number;
}

const DAY_MS = 86_400_000;

/** End-of-day (UTC) ms for the day containing `ms` — keeps "today" inclusive. */
function endOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS - 1;
}

/** Build a concrete range from a preset, anchored to `nowMs`. */
export function presetRange(preset: Exclude<RangePreset, "custom">, nowMs: number): DateRange {
  const endMs = endOfDay(nowMs);
  switch (preset) {
    case "7d":
      return { startMs: endMs - 7 * DAY_MS + 1, endMs };
    case "30d":
      return { startMs: endMs - 30 * DAY_MS + 1, endMs };
    case "90d":
      return { startMs: endMs - 90 * DAY_MS + 1, endMs };
    case "all":
      return { startMs: 0, endMs };
  }
}

function inRange(iso: string | null, range: DateRange): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return ms >= range.startMs && ms <= range.endMs;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface CountSlice {
  key: string;
  /** English fallback label (from the dictionary or raw data). */
  label: string;
  /** Optional i18n key; when set, the render/export layer localizes it. */
  labelKey?: string;
  value: number;
}

export interface TimeBucket {
  key: string;
  label: string;
  outpatient: number;
  inpatient: number;
  emergency: number;
  total: number;
}

function tally<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const k = keyOf(row);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Set of patient ids with at least one visit inside the range. */
function patientsSeen(visits: Visit[], range: DateRange): Set<string> {
  const set = new Set<string>();
  for (const v of visits) {
    if (inRange(v.arrived_at, range)) set.add(v.patient_id);
  }
  return set;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface ReportKpis {
  totalVisits: number;
  uniquePatients: number;
  outpatient: number;
  inpatient: number;
  emergency: number;
  admissionsStarted: number;
  discharges: number;
  currentInpatients: number;
  bedOccupancyPct: number;
  avgLosDays: number | null;
}

export function computeKpis(
  visits: Visit[],
  admissions: Admission[],
  beds: Bed[],
  range: DateRange,
): ReportKpis {
  const ranged = visits.filter((v) => inRange(v.arrived_at, range));
  const byType = tally(ranged, (v) => v.visit_type);
  const discharged = admissions.filter((a) => inRange(a.discharged_at, range));
  const los = lengthOfStay(admissions, range);
  const occupiedBeds = beds.filter(
    (b) => b.status === "occupied" || b.status === "reserved",
  ).length;

  return {
    totalVisits: ranged.length,
    uniquePatients: new Set(ranged.map((v) => v.patient_id)).size,
    outpatient: byType.get("outpatient") ?? 0,
    inpatient: byType.get("inpatient") ?? 0,
    emergency: byType.get("emergency") ?? 0,
    admissionsStarted: admissions.filter((a) => inRange(a.admitted_at, range)).length,
    discharges: discharged.length,
    currentInpatients: admissions.filter((a) => a.status === "active").length,
    bedOccupancyPct: beds.length ? Math.round((occupiedBeds / beds.length) * 100) : 0,
    avgLosDays: los.avgDays,
  };
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

function bucketLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Visits bucketed across the range. Daily buckets for spans up to ~6 weeks,
 * weekly thereafter, so the x-axis never becomes unreadable. Empty buckets are
 * kept (value 0) so lines/areas stay continuous.
 */
export function visitsOverTime(visits: Visit[], range: DateRange): TimeBucket[] {
  const start = range.startMs === 0
    ? earliestArrival(visits, range.endMs)
    : range.startMs;
  const daily = range.endMs - start <= 46 * DAY_MS;
  const bucketMs = daily ? DAY_MS : 7 * DAY_MS;
  const alignedStart = Math.floor(start / DAY_MS) * DAY_MS;

  const buckets: TimeBucket[] = [];
  for (let t = alignedStart; t <= range.endMs; t += bucketMs) {
    buckets.push({
      key: new Date(t).toISOString().slice(0, 10),
      label: bucketLabel(t),
      outpatient: 0,
      inpatient: 0,
      emergency: 0,
      total: 0,
    });
  }
  if (buckets.length === 0) return buckets;

  for (const v of visits) {
    const ms = Date.parse(v.arrived_at);
    if (ms < range.startMs || ms > range.endMs || ms < alignedStart) continue;
    const idx = Math.floor((ms - alignedStart) / bucketMs);
    const b = buckets[idx];
    if (!b) continue;
    b[v.visit_type] += 1;
    b.total += 1;
  }
  return buckets;
}

function earliestArrival(visits: Visit[], fallback: number): number {
  let min = fallback;
  for (const v of visits) {
    const ms = Date.parse(v.arrived_at);
    if (ms < min) min = ms;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Categorical breakdowns
// ---------------------------------------------------------------------------

export function visitTypeMix(visits: Visit[], range: DateRange): CountSlice[] {
  const ranged = visits.filter((v) => inRange(v.arrived_at, range));
  const counts = tally(ranged, (v) => v.visit_type);
  return (["outpatient", "inpatient", "emergency"] as VisitType[]).map((t) => ({
    key: t,
    label: en(VISIT_TYPE_LABEL[t]),
    labelKey: VISIT_TYPE_LABEL[t],
    value: counts.get(t) ?? 0,
  }));
}

export function departmentThroughput(
  visits: Visit[],
  departments: Department[],
  range: DateRange,
): CountSlice[] {
  const name = new Map(departments.map((d) => [d.id, d.name]));
  const ranged = visits.filter((v) => inRange(v.arrived_at, range));
  const counts = tally(ranged, (v) => v.department_id ?? "__none__");
  return [...counts.entries()]
    .map(([id, value]) => {
      if (id === "__none__") {
        return { key: id, label: en("reports.unassigned"), labelKey: "reports.unassigned", value };
      }
      const resolved = name.get(id);
      return resolved
        ? { key: id, label: resolved, value }
        : { key: id, label: en("reports.unknown"), labelKey: "reports.unknown", value };
    })
    .sort((a, b) => b.value - a.value);
}

export function topDiagnoses(
  diagnoses: Diagnosis[],
  range: DateRange,
  limit = 8,
): CountSlice[] {
  const ranged = diagnoses.filter((d) => inRange(d.created_at, range));
  const byDesc = new Map<string, { code: string | null; count: number }>();
  for (const d of ranged) {
    const entry = byDesc.get(d.description) ?? { code: d.icd10_code, count: 0 };
    entry.count += 1;
    byDesc.set(d.description, entry);
  }
  return [...byDesc.entries()]
    .map(([description, { code, count }]) => ({
      key: code ?? description,
      label: code ? `${code} · ${description}` : description,
      value: count,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Length of stay (from admissions discharged within the range)
// ---------------------------------------------------------------------------

export interface LosReport {
  buckets: CountSlice[];
  avgDays: number | null;
  medianDays: number | null;
  count: number;
}

const LOS_BUCKETS: { key: string; labelKey: string; test: (d: number) => boolean }[] = [
  { key: "lt1", labelKey: "reports.los.lt1", test: (d) => d < 1 },
  { key: "1-2", labelKey: "reports.los.d1_2", test: (d) => d >= 1 && d < 3 },
  { key: "3-4", labelKey: "reports.los.d3_4", test: (d) => d >= 3 && d < 5 },
  { key: "5-7", labelKey: "reports.los.d5_7", test: (d) => d >= 5 && d < 8 },
  { key: "8-14", labelKey: "reports.los.d8_14", test: (d) => d >= 8 && d < 15 },
  { key: "15+", labelKey: "reports.los.d15", test: (d) => d >= 15 },
];

export function lengthOfStay(admissions: Admission[], range: DateRange): LosReport {
  const stays: number[] = [];
  for (const a of admissions) {
    if (!a.discharged_at || !inRange(a.discharged_at, range)) continue;
    const days = (Date.parse(a.discharged_at) - Date.parse(a.admitted_at)) / DAY_MS;
    if (Number.isFinite(days) && days >= 0) stays.push(days);
  }
  const buckets = LOS_BUCKETS.map((b) => ({
    key: b.key,
    label: en(b.labelKey),
    labelKey: b.labelKey,
    value: stays.filter((d) => b.test(d)).length,
  }));
  const avgDays = stays.length
    ? Math.round((stays.reduce((s, d) => s + d, 0) / stays.length) * 10) / 10
    : null;
  const sorted = [...stays].sort((a, b) => a - b);
  const medianDays = sorted.length
    ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10
    : null;
  return { buckets, avgDays, medianDays, count: stays.length };
}

// ---------------------------------------------------------------------------
// Occupancy (point-in-time snapshots)
// ---------------------------------------------------------------------------

export interface WardOccupancyRow {
  key: string;
  ward: string;
  total: number;
  occupied: number;
  free: number;
  pct: number;
}

export function wardOccupancy(wards: Ward[], beds: Bed[]): WardOccupancyRow[] {
  return wards.map((ward) => {
    const wardBeds = beds.filter((b) => b.ward_id === ward.id);
    const occupied = wardBeds.filter(
      (b) => b.status === "occupied" || b.status === "reserved",
    ).length;
    const total = wardBeds.length;
    return {
      key: ward.id,
      ward: ward.name,
      total,
      occupied,
      free: total - occupied,
      pct: total ? Math.round((occupied / total) * 100) : 0,
    };
  });
}

/** Open visits grouped by care stage, in board order (the live funnel). */
export function stageDistribution(visits: Visit[]): CountSlice[] {
  const open = visits.filter((v) => v.status === "open");
  const counts = tally(open, (v) => v.stage);
  return (Object.keys(CARE_STAGE_LABEL) as CareStage[])
    .map((s) => ({
      key: s,
      label: en(CARE_STAGE_LABEL[s]),
      labelKey: CARE_STAGE_LABEL[s],
      value: counts.get(s) ?? 0,
    }))
    .filter((slice) => slice.value > 0);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface AbnormalRate {
  abnormal: number;
  normal: number;
  total: number;
  pct: number;
}

export function abnormalRate(results: Result[], range: DateRange): AbnormalRate {
  const ranged = results.filter((r) => inRange(r.recorded_at, range));
  const abnormal = ranged.filter((r) => r.is_abnormal).length;
  const total = ranged.length;
  return {
    abnormal,
    normal: total - abnormal,
    total,
    pct: total ? Math.round((abnormal / total) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Demographics (over patients seen within the range)
// ---------------------------------------------------------------------------

export function sexMix(
  patients: Patient[],
  visits: Visit[],
  range: DateRange,
): CountSlice[] {
  const seen = patientsSeen(visits, range);
  const ranged = patients.filter((p) => seen.has(p.id));
  const counts = tally(ranged, (p) => p.sex);
  return (Object.keys(SEX_LABEL) as Sex[])
    .map((s) => ({
      key: s,
      label: en(SEX_LABEL[s]),
      labelKey: SEX_LABEL[s],
      value: counts.get(s) ?? 0,
    }))
    .filter((slice) => slice.value > 0);
}

const AGE_BUCKETS: { key: string; label: string; test: (a: number) => boolean }[] = [
  { key: "0-12", label: "0–12", test: (a) => a <= 12 },
  { key: "13-18", label: "13–18", test: (a) => a >= 13 && a <= 18 },
  { key: "19-35", label: "19–35", test: (a) => a >= 19 && a <= 35 },
  { key: "36-50", label: "36–50", test: (a) => a >= 36 && a <= 50 },
  { key: "51-65", label: "51–65", test: (a) => a >= 51 && a <= 65 },
  { key: "66+", label: "66+", test: (a) => a >= 66 },
];

export function ageOf(dob: string | null, nowMs: number): number | null {
  if (!dob) return null;
  const ms = Date.parse(dob);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((nowMs - ms) / (365.25 * DAY_MS));
}

export function ageDistribution(
  patients: Patient[],
  visits: Visit[],
  range: DateRange,
  nowMs: number,
): CountSlice[] {
  const seen = patientsSeen(visits, range);
  const ages = patients
    .filter((p) => seen.has(p.id))
    .map((p) => ageOf(p.date_of_birth, nowMs))
    .filter((a): a is number => a !== null && a >= 0);
  return AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    value: ages.filter((a) => b.test(a)).length,
  }));
}

// ---------------------------------------------------------------------------
// Clearance bottlenecks
// ---------------------------------------------------------------------------

/** Current active admissions still waiting on each discharge clearance gate. */
export function clearanceBottlenecks(admissions: Admission[]): CountSlice[] {
  const active = admissions.filter((a) => a.status === "active");
  return [
    {
      key: "medical",
      label: en("reports.clearance.medical"),
      labelKey: "reports.clearance.medical",
      value: active.filter((a) => !a.is_medical_cleared).length,
    },
    {
      key: "financial",
      label: en("reports.clearance.financial"),
      labelKey: "reports.clearance.financial",
      value: active.filter((a) => !a.is_financial_cleared).length,
    },
    {
      key: "pharmacy",
      label: en("reports.clearance.pharmacy"),
      labelKey: "reports.clearance.pharmacy",
      value: active.filter((a) => !a.is_pharmacy_ready).length,
    },
  ];
}

// ---------------------------------------------------------------------------
// Bundle — one call assembles the whole report so the dashboard and exporters
// stay in lockstep.
// ---------------------------------------------------------------------------

export interface ReportData {
  visits: Visit[];
  patients: Patient[];
  admissions: Admission[];
  diagnoses: Diagnosis[];
  results: Result[];
  departments: Department[];
  wards: Ward[];
  beds: Bed[];
}

export interface FullReport {
  range: DateRange;
  generatedAtMs: number;
  kpis: ReportKpis;
  visitsOverTime: TimeBucket[];
  visitTypeMix: CountSlice[];
  departmentThroughput: CountSlice[];
  topDiagnoses: CountSlice[];
  los: LosReport;
  wardOccupancy: WardOccupancyRow[];
  stageDistribution: CountSlice[];
  abnormal: AbnormalRate;
  sexMix: CountSlice[];
  ageDistribution: CountSlice[];
  clearanceBottlenecks: CountSlice[];
}

export function buildReport(
  data: ReportData,
  range: DateRange,
  nowMs: number,
): FullReport {
  return {
    range,
    generatedAtMs: nowMs,
    kpis: computeKpis(data.visits, data.admissions, data.beds, range),
    visitsOverTime: visitsOverTime(data.visits, range),
    visitTypeMix: visitTypeMix(data.visits, range),
    departmentThroughput: departmentThroughput(data.visits, data.departments, range),
    topDiagnoses: topDiagnoses(data.diagnoses, range),
    los: lengthOfStay(data.admissions, range),
    wardOccupancy: wardOccupancy(data.wards, data.beds),
    stageDistribution: stageDistribution(data.visits),
    abnormal: abnormalRate(data.results, range),
    sexMix: sexMix(data.patients, data.visits, range),
    ageDistribution: ageDistribution(data.patients, data.visits, range, nowMs),
    clearanceBottlenecks: clearanceBottlenecks(data.admissions),
  };
}
