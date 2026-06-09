import type { CareStage, VisitType } from "@/types/healthcare";

/**
 * The live board groups the active `care_stage` values into four scannable
 * columns that mirror the physical flow of the floor. The terminal stages
 * (`discharged`, `followed_up`, `deceased`) close the visit and drop it off the
 * board, so they have no column here.
 *
 * Each column maps to a `--status-{token}` theme token defined in globals.css
 * (light + dark). Shared by the journey board, patient cards, and the stat
 * counts so the surfaces never drift.
 */
export interface BoardColumn {
  key: string;
  /** i18n message key — resolve with `t(column.label)`. */
  label: string;
  /** Suffix of the `--status-{token}` CSS variable in globals.css. */
  token: "boarding" | "diagnostics" | "treatment" | "discharge";
  /** The `care_stage` values that belong in this column. */
  stages: CareStage[];
}

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { key: "intake", label: "boardColumn.intake", token: "boarding", stages: ["registration", "triage"] },
  { key: "consultation", label: "boardColumn.consultation", token: "diagnostics", stages: ["consultation", "diagnostics"] },
  { key: "treatment", label: "boardColumn.treatment", token: "treatment", stages: ["treatment"] },
  { key: "discharge", label: "boardColumn.discharge", token: "discharge", stages: ["discharge_planning"] },
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
  registration: "stage.registration",
  triage: "stage.triage",
  consultation: "stage.consultation",
  diagnostics: "stage.diagnostics",
  treatment: "stage.treatment",
  discharge_planning: "stage.discharge_planning",
  discharged: "stage.discharged",
  followed_up: "stage.followed_up",
  deceased: "stage.deceased",
};

/** i18n message key for a care stage — resolve with `t(stageLabel(stage))`. */
export function stageLabel(stage: CareStage): string {
  return STAGE_LABELS[stage];
}

// ---------------------------------------------------------------------------
// "Next step" nudges (Phase 16) — teach the workflow on the board itself. Each
// card shows the single action that moves the patient forward, phrased as a
// verb for the person reading the board ("Send to doctor", not "Consultation").
// The hint is keyed off the *next* stage in this visit's path, so it respects
// the outpatient short-circuit. Terminal stages have no next step → null.
// ---------------------------------------------------------------------------

const NEXT_STEP_LABELS: Record<CareStage, string> = {
  registration: "nextStep.registration",
  triage: "nextStep.triage",
  consultation: "nextStep.consultation",
  diagnostics: "nextStep.diagnostics",
  treatment: "nextStep.treatment",
  discharge_planning: "nextStep.discharge_planning",
  discharged: "nextStep.discharged",
  followed_up: "nextStep.followed_up",
  // Terminal: a death is never a "next step" the board nudges toward; this entry
  // exists only to satisfy the exhaustive CareStage record and is never read.
  deceased: "nextStep.followed_up",
};

/**
 * i18n message key for the action that advances this visit to its next stage,
 * or `null` if the visit is already at the final stage of its path. Resolve
 * with `t(nextStepLabel(stage, visitType))`.
 */
export function nextStepLabel(
  stage: CareStage,
  visitType: VisitType,
): string | null {
  const next = nextStage(stage, visitType);
  return next ? NEXT_STEP_LABELS[next] : null;
}

/** Token to accent a card by, falling back to the intake token for terminal stages. */
export function tokenForStage(stage: CareStage): BoardColumn["token"] {
  return columnForStage(stage)?.token ?? "boarding";
}
