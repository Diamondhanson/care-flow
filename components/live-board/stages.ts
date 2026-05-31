import type { CareStage, VisitType } from "@/types/healthcare";

/**
 * The live board groups the eight `care_stage` values into four scannable
 * columns that mirror the physical flow of the floor. The two terminal stages
 * (`discharged`, `followed_up`) close the visit and drop it off the board, so
 * they have no column here.
 *
 * Each column maps to a `--status-{token}` theme token defined in globals.css
 * (light + dark). Shared by the journey board, patient cards, and the stat
 * counts so the surfaces never drift.
 */
export interface BoardColumn {
  key: string;
  label: string;
  /** Suffix of the `--status-{token}` CSS variable in globals.css. */
  token: "boarding" | "diagnostics" | "treatment" | "discharge";
  /** The `care_stage` values that belong in this column. */
  stages: CareStage[];
}

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { key: "intake", label: "Intake", token: "boarding", stages: ["registration", "triage"] },
  { key: "consultation", label: "Consultation", token: "diagnostics", stages: ["consultation", "diagnostics"] },
  { key: "treatment", label: "Treatment", token: "treatment", stages: ["treatment"] },
  { key: "discharge", label: "Discharge", token: "discharge", stages: ["discharge_planning"] },
] as const;

/** The board column a given care stage belongs to, or null if terminal. */
export function columnForStage(stage: CareStage): BoardColumn | null {
  return BOARD_COLUMNS.find((c) => c.stages.includes(stage)) ?? null;
}

// ---------------------------------------------------------------------------
// Stage ordering — drives the "advance" action in the clinical drawer.
// Inpatient / emergency visits walk the full path; outpatients short-circuit
// straight from diagnostics to discharge (no admission, no treatment ward).
// ---------------------------------------------------------------------------

const FULL_ORDER: CareStage[] = [
  "registration",
  "triage",
  "consultation",
  "diagnostics",
  "treatment",
  "discharge_planning",
  "discharged",
  "followed_up",
];

const OUTPATIENT_ORDER: CareStage[] = [
  "registration",
  "triage",
  "consultation",
  "diagnostics",
  "discharged",
];

function orderFor(visitType: VisitType): CareStage[] {
  return visitType === "outpatient" ? OUTPATIENT_ORDER : FULL_ORDER;
}

/**
 * The next stage in the care journey for a visit of the given type, or null if
 * already at the final stage.
 */
export function nextStage(stage: CareStage, visitType: VisitType): CareStage | null {
  const order = orderFor(visitType);
  const idx = order.indexOf(stage);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

const STAGE_LABELS: Record<CareStage, string> = {
  registration: "Registration",
  triage: "Triage",
  consultation: "Consultation",
  diagnostics: "Diagnostics",
  treatment: "Treatment",
  discharge_planning: "Discharge Planning",
  discharged: "Discharged",
  followed_up: "Followed Up",
};

export function stageLabel(stage: CareStage): string {
  return STAGE_LABELS[stage];
}

/** Token to accent a card by, falling back to the intake token for terminal stages. */
export function tokenForStage(stage: CareStage): BoardColumn["token"] {
  return columnForStage(stage)?.token ?? "boarding";
}
