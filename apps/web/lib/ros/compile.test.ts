import { describe, expect, it } from "vitest";

import type {
  RosResponse,
  Unbranded,
} from "@careflow/shared";

import { compileRosNarrative } from "./compile";

let n = 0;
function response(overrides: Partial<Unbranded<RosResponse>>): RosResponse {
  n += 1;
  return {
    id: `ros_${n}`,
    hospital_id: "hosp_demo",
    visit_id: "vis_1",
    consultation_id: null,
    system: "cardiac",
    question_key: `synthetic.q${n}`,
    kind: "symptom",
    question_text: "Question?",
    answer_type: "boolean",
    answer_value: true,
    answer_label: "Yes",
    note: null,
    recorded_by_id: null,
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  } as RosResponse;
}

describe("compileRosNarrative", () => {
  it("returns an empty string for no responses", () => {
    expect(compileRosNarrative([], "en")).toBe("");
  });

  it("compiles positives, negatives and history from snapshots (keys not in bank)", () => {
    // Synthetic keys exercise the fallback path: prompt/answer snapshots only,
    // so the expected strings are fully deterministic.
    const rows: RosResponse[] = [
      response({
        question_key: "cardiac.zz_synthetic_pain",
        question_text: "Synthetic pain?",
        answer_value: true,
      }),
      response({
        question_key: "cardiac.zz_synthetic_pain.duration",
        question_text: "Duration",
        answer_type: "duration",
        answer_value: { value: 2, unit: "hours" },
        answer_label: "2 hours",
      }),
      response({
        question_key: "cardiac.zz_synthetic_palpitations",
        question_text: "Synthetic palpitations?",
        answer_value: false,
        answer_label: "No",
      }),
      response({
        question_key: "cardiac.zz_synthetic_fhx",
        kind: "genetic",
        question_text: "Synthetic family heart disease?",
        answer_value: true,
      }),
    ];

    const en = compileRosNarrative(rows, "en");
    expect(en).toBe(
      "Cardiac: Reports synthetic pain (duration: 2 hours). " +
        "Denies synthetic palpitations. " +
        "History/genetics: synthetic family heart disease.",
    );
  });

  it("localizes the same rows into French", () => {
    const rows: RosResponse[] = [
      response({
        question_key: "respiratory.zz_synthetic_cough",
        system: "respiratory",
        question_text: "Toux synthétique ?",
        answer_value: false,
      }),
    ];
    expect(compileRosNarrative(rows, "fr")).toBe(
      "Respiratoire: Nie toux synthétique.",
    );
  });

  it("groups systems in canonical order on separate lines", () => {
    const rows: RosResponse[] = [
      response({
        system: "respiratory",
        question_key: "respiratory.zz_a",
        question_text: "A?",
        answer_value: false,
      }),
      response({
        system: "general",
        question_key: "general.zz_b",
        question_text: "B?",
        answer_value: false,
      }),
    ];
    const lines = compileRosNarrative(rows, "en").split("\n");
    expect(lines[0]).toMatch(/^General:/);
    expect(lines[1]).toMatch(/^Respiratory:/);
  });

  it("uses live bank report phrases and localized labels for real keys", () => {
    const rows: RosResponse[] = [
      response({
        question_key: "cardiac.chest_pain",
        question_text: "Chest pain?",
        answer_value: true,
      }),
    ];
    const en = compileRosNarrative(rows, "en");
    expect(en).toContain("chest pain");
    const fr = compileRosNarrative(rows, "fr");
    expect(fr).toContain("douleur thoracique");
    expect(fr).toMatch(/^Cardiaque: Signale/);
  });

  it("includes per-answer notes and non-boolean top-level answers", () => {
    const rows: RosResponse[] = [
      response({
        question_key: "gu.zz_synthetic_para",
        system: "gu",
        kind: "history",
        question_text: "Para",
        answer_type: "numeric",
        answer_value: { value: 3 },
        answer_label: "3",
        note: "one stillbirth",
      }),
    ];
    expect(compileRosNarrative(rows, "en")).toBe(
      "Genitourinary: History/genetics: para (3; note: one stillbirth).",
    );
  });
});
