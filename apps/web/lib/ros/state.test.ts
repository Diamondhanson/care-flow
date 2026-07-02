import { describe, expect, it } from "vitest";

import type { RosQuestion } from "@careflow/shared";

import {
  answerLabelFor,
  questionApplies,
  unansweredKeyQuestions,
  visibleFollowups,
} from "./state";

const boolQ = (key: string, extra: Partial<RosQuestion> = {}): RosQuestion => ({
  key,
  system: "cardiac",
  kind: "symptom",
  prompt_en: `${key}?`,
  prompt_fr: `${key} ?`,
  type: "boolean",
  ...extra,
});

describe("visibleFollowups", () => {
  const parent = boolQ("cardiac.chest_pain", {
    followups: [
      boolQ("cardiac.chest_pain.character", {
        type: "single_select",
        show_if: "yes",
        options: [
          { value: "crushing", label_en: "Crushing", label_fr: "Écrasante" },
        ],
      }),
    ],
  });

  it("reveals nothing when unanswered or answered No", () => {
    expect(visibleFollowups(parent, undefined)).toHaveLength(0);
    expect(visibleFollowups(parent, false)).toHaveLength(0);
  });

  it("reveals 'yes'-gated follow-ups on a true answer", () => {
    expect(visibleFollowups(parent, true)).toHaveLength(1);
  });

  it("matches literal show_if values on select parents", () => {
    const selectParent: RosQuestion = {
      ...boolQ("neuro.seizure_type"),
      type: "single_select",
      options: [
        { value: "focal", label_en: "Focal", label_fr: "Focale" },
        { value: "generalized", label_en: "Generalized", label_fr: "Généralisée" },
      ],
      followups: [
        boolQ("neuro.seizure_type.aura", { show_if: "focal" }),
      ],
    };
    expect(visibleFollowups(selectParent, "focal")).toHaveLength(1);
    expect(visibleFollowups(selectParent, "generalized")).toHaveLength(0);
  });
});

describe("questionApplies / sex gating", () => {
  const gated = boolQ("obstetric_gynae.amenorrhoea", { sex: "female" });
  it("gates by sex, open when ungated", () => {
    expect(questionApplies(gated, "female")).toBe(true);
    expect(questionApplies(gated, "male")).toBe(false);
    expect(questionApplies(gated, "unknown")).toBe(false);
    expect(questionApplies(boolQ("cardiac.chest_pain"), "unknown")).toBe(true);
  });
});

describe("unansweredKeyQuestions (mark-remaining-as-No set)", () => {
  const systemModule: RosQuestion[] = [
    boolQ("cardiac.chest_pain", { key_question: true }),
    boolQ("cardiac.palpitations", { key_question: true }),
    boolQ("cardiac.minor_symptom"),
    boolQ("cardiac.severity_scale", {
      key_question: true,
      type: "scale",
      options: [{ value: "mild", label_en: "Mild", label_fr: "Légère" }],
    }),
    boolQ("obstetric.gated", { key_question: true, sex: "female" }),
  ];

  it("returns only unanswered boolean key questions that pass the sex gate", () => {
    const result = unansweredKeyQuestions(
      systemModule,
      new Set(["cardiac.chest_pain"]),
      "male",
    );
    expect(result.map((q) => q.key)).toEqual(["cardiac.palpitations"]);
  });

  it("includes sex-gated questions for an eligible patient", () => {
    const result = unansweredKeyQuestions(systemModule, new Set(), "female");
    expect(result.map((q) => q.key)).toContain("obstetric.gated");
  });
});

describe("answerLabelFor", () => {
  it("localizes booleans", () => {
    const q = boolQ("cardiac.chest_pain");
    expect(answerLabelFor(q, true, "en")).toBe("Yes");
    expect(answerLabelFor(q, true, "fr")).toBe("Oui");
    expect(answerLabelFor(q, false, "fr")).toBe("Non");
  });

  it("resolves option labels per locale", () => {
    const q = boolQ("x.character", {
      type: "single_select",
      options: [
        { value: "crushing", label_en: "Crushing", label_fr: "Écrasante" },
      ],
    });
    expect(answerLabelFor(q, "crushing", "en")).toBe("Crushing");
    expect(answerLabelFor(q, "crushing", "fr")).toBe("Écrasante");
  });

  it("joins multi-select labels", () => {
    const q = boolQ("x.radiation", {
      type: "multi_select",
      options: [
        { value: "left_arm", label_en: "Left arm", label_fr: "Bras gauche" },
        { value: "jaw", label_en: "Jaw", label_fr: "Mâchoire" },
      ],
    });
    expect(answerLabelFor(q, ["left_arm", "jaw"], "fr")).toBe(
      "Bras gauche, Mâchoire",
    );
  });

  it("formats duration values with localized units", () => {
    const q = boolQ("x.duration", { type: "duration" });
    expect(answerLabelFor(q, { value: 2, unit: "hours" }, "en")).toBe("2 hours");
    expect(answerLabelFor(q, { value: 2, unit: "hours" }, "fr")).toBe("2 heures");
  });
});
