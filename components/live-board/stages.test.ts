import { describe, expect, it } from "vitest";

import {
  BOARD_COLUMNS,
  columnForStage,
  nextStage,
  nextStepLabel,
  stageLabel,
  tokenForStage,
} from "@/components/live-board/stages";
import { translate } from "@/i18n";

describe("columnForStage", () => {
  it("maps every in-progress stage to exactly one board column", () => {
    expect(columnForStage("registration")?.key).toBe("intake");
    expect(columnForStage("triage")?.key).toBe("intake");
    expect(columnForStage("consultation")?.key).toBe("consultation");
    expect(columnForStage("diagnostics")?.key).toBe("consultation");
    expect(columnForStage("treatment")?.key).toBe("treatment");
    expect(columnForStage("discharge_planning")?.key).toBe("discharge");
  });

  it("returns null for terminal stages (off the board)", () => {
    expect(columnForStage("discharged")).toBeNull();
    expect(columnForStage("followed_up")).toBeNull();
  });

  it("partitions all four columns without overlap", () => {
    const seen = new Set<string>();
    for (const col of BOARD_COLUMNS) {
      for (const stage of col.stages) {
        expect(seen.has(stage)).toBe(false);
        seen.add(stage);
      }
    }
    expect(BOARD_COLUMNS).toHaveLength(4);
  });
});

describe("nextStage", () => {
  it("walks the full path for inpatient and emergency visits", () => {
    expect(nextStage("registration", "inpatient")).toBe("triage");
    expect(nextStage("diagnostics", "inpatient")).toBe("treatment");
    expect(nextStage("treatment", "inpatient")).toBe("discharge_planning");
    expect(nextStage("discharge_planning", "inpatient")).toBe("discharged");
    expect(nextStage("discharged", "inpatient")).toBe("followed_up");
    expect(nextStage("diagnostics", "emergency")).toBe("treatment");
  });

  it("short-circuits outpatients from diagnostics straight to discharged", () => {
    expect(nextStage("diagnostics", "outpatient")).toBe("discharged");
    expect(nextStage("consultation", "outpatient")).toBe("diagnostics");
  });

  it("returns null at the end of the journey", () => {
    expect(nextStage("followed_up", "inpatient")).toBeNull();
    expect(nextStage("discharged", "outpatient")).toBeNull();
  });
});

describe("nextStepLabel", () => {
  it("names the action that advances the visit, keyed off the next stage", () => {
    // registration → triage → "Take vitals & triage"
    expect(translate("en", nextStepLabel("registration", "inpatient")!)).toBe(
      "Take vitals & triage",
    );
    // triage → consultation → "Send to doctor"
    expect(translate("en", nextStepLabel("triage", "inpatient")!)).toBe(
      "Send to doctor",
    );
    // treatment → discharge_planning → "Plan discharge"
    expect(translate("en", nextStepLabel("treatment", "inpatient")!)).toBe(
      "Plan discharge",
    );
  });

  it("respects the outpatient short-circuit (diagnostics → discharge)", () => {
    // Outpatient diagnostics advances to discharged → "Discharge patient".
    expect(translate("en", nextStepLabel("diagnostics", "outpatient")!)).toBe(
      "Discharge patient",
    );
    // Inpatient diagnostics advances to treatment → "Start treatment".
    expect(translate("en", nextStepLabel("diagnostics", "inpatient")!)).toBe(
      "Start treatment",
    );
  });

  it("translates to French", () => {
    expect(translate("fr", nextStepLabel("triage", "inpatient")!)).toBe(
      "Envoyer au médecin",
    );
  });

  it("returns null once the visit reaches the end of its path", () => {
    expect(nextStepLabel("followed_up", "inpatient")).toBeNull();
    expect(nextStepLabel("discharged", "outpatient")).toBeNull();
  });
});

describe("stageLabel & tokenForStage", () => {
  it("provides a human label for each stage", () => {
    expect(translate("en", stageLabel("discharge_planning"))).toBe("Discharge planning");
    expect(translate("en", stageLabel("followed_up"))).toBe("Followed up");
  });

  it("falls back to the intake token for terminal stages", () => {
    expect(tokenForStage("treatment")).toBe("treatment");
    expect(tokenForStage("discharged")).toBe("boarding");
  });
});
