import type { AdmissionStage } from "@/types/healthcare";

/**
 * Canonical mapping between admission stages, their kanban column labels, and
 * the `--status-*` theme tokens. Shared by the journey board, patient cards,
 * and the stat counts so the four surfaces never drift.
 */
export interface StageConfig {
  stage: AdmissionStage;
  label: string;
  /** Suffix of the `--status-{token}` CSS variable in globals.css. */
  token: "boarding" | "treatment" | "discharge" | "clearance";
}

export const STAGE_CONFIG: readonly StageConfig[] = [
  { stage: "boarding", label: "Boarding", token: "boarding" },
  { stage: "treatment", label: "Treatment", token: "treatment" },
  { stage: "discharge_planning", label: "Discharge Planning", token: "discharge" },
  { stage: "followed_up", label: "Followed Up", token: "clearance" },
] as const;

/** The next stage in the care journey, or null if already at the final stage. */
export function nextStage(stage: AdmissionStage): AdmissionStage | null {
  const idx = STAGE_CONFIG.findIndex((s) => s.stage === stage);
  if (idx < 0 || idx >= STAGE_CONFIG.length - 1) return null;
  return STAGE_CONFIG[idx + 1].stage;
}

export function stageConfig(stage: AdmissionStage): StageConfig {
  return STAGE_CONFIG.find((s) => s.stage === stage) ?? STAGE_CONFIG[0];
}
