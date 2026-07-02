import { describe, expect, it } from "vitest";

import type { RosQuestion } from "@careflow/shared";
import subjectiveSeed from "@/data/clinical-terms/subjective.json";

import {
  getAllSystems,
  getQuestion,
  getSystemModule,
  isKnownQuestionKey,
  ROS_SYSTEMS,
  validateAnswerAgainstBank,
} from "./index";
import { normalizeSystem, systemForTerm, systemsForComplaint } from "./routing";

const SELECT_TYPES = new Set(["single_select", "multi_select", "scale"]);
const VALID_TYPES = new Set([
  "boolean",
  "single_select",
  "multi_select",
  "scale",
  "duration",
  "numeric",
  "date",
  "text",
]);
const VALID_KINDS = new Set(["symptom", "history", "genetic"]);

/** Same slug rule as scripts/ros-seed-from-subjective.ts. */
function slug(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function allNodes(): { node: RosQuestion; parent: RosQuestion | null }[] {
  const out: { node: RosQuestion; parent: RosQuestion | null }[] = [];
  for (const system of ROS_SYSTEMS) {
    for (const q of getSystemModule(system)) {
      out.push({ node: q, parent: null });
      for (const f of q.followups ?? []) out.push({ node: f, parent: q });
    }
  }
  return out;
}

describe("ROS question bank", () => {
  it("covers all 12 systems with at least one question each", () => {
    expect(getAllSystems()).toHaveLength(12);
    for (const system of ROS_SYSTEMS) {
      expect(getSystemModule(system).length).toBeGreaterThan(0);
    }
  });

  it("contains every subjective clinical term as a symptom question", () => {
    for (const term of subjectiveSeed as {
      term_en: string;
      system: string;
    }[]) {
      const system = normalizeSystem(term.system);
      expect(system).not.toBeNull();
      const key = `${system}.${slug(term.term_en)}`;
      expect(isKnownQuestionKey(key), `missing ${key}`).toBe(true);
    }
  });

  it("has globally unique keys, correctly prefixed", () => {
    const seen = new Set<string>();
    for (const { node, parent } of allNodes()) {
      expect(seen.has(node.key), `duplicate key ${node.key}`).toBe(false);
      seen.add(node.key);
      const prefix = parent ? `${parent.key}.` : `${node.system ?? ""}.`;
      if (parent) {
        expect(node.key.startsWith(prefix), `${node.key} !~ ${prefix}`).toBe(
          true,
        );
      }
    }
    for (const system of ROS_SYSTEMS) {
      for (const q of getSystemModule(system)) {
        expect(q.key.startsWith(`${system}.`), `${q.key} !~ ${system}.`).toBe(
          true,
        );
        expect(q.system).toBe(system);
      }
    }
  });

  it("every node has bilingual prompts, a valid type and kind", () => {
    for (const { node, parent } of allNodes()) {
      expect(node.prompt_en?.trim().length, node.key).toBeGreaterThan(0);
      expect(node.prompt_fr?.trim().length, node.key).toBeGreaterThan(0);
      expect(VALID_TYPES.has(node.type), `${node.key}: ${node.type}`).toBe(
        true,
      );
      if (!parent) {
        expect(VALID_KINDS.has(node.kind), `${node.key}: ${node.kind}`).toBe(
          true,
        );
      }
    }
  });

  it("select/scale nodes carry complete bilingual options; others carry none", () => {
    for (const { node } of allNodes()) {
      if (SELECT_TYPES.has(node.type)) {
        expect(node.options?.length, node.key).toBeGreaterThan(1);
        for (const o of node.options ?? []) {
          expect(o.value?.trim().length, node.key).toBeGreaterThan(0);
          expect(o.label_en?.trim().length, node.key).toBeGreaterThan(0);
          expect(o.label_fr?.trim().length, node.key).toBeGreaterThan(0);
        }
        const values = (node.options ?? []).map((o) => o.value);
        expect(new Set(values).size, node.key).toBe(values.length);
      } else {
        expect(node.options ?? [], node.key).toHaveLength(0);
      }
    }
  });

  it("follow-ups are one level deep and gated by show_if", () => {
    for (const { node, parent } of allNodes()) {
      if (parent) {
        expect(node.followups ?? [], node.key).toHaveLength(0);
        expect(node.show_if, node.key).toBeTruthy();
      }
    }
  });

  it("sex gates are valid and obstetric questions are female-gated", () => {
    for (const { node } of allNodes()) {
      expect([null, undefined, "male", "female"]).toContain(node.sex);
    }
    for (const q of getSystemModule("obstetric_gynae")) {
      expect(q.sex, q.key).toBe("female");
    }
  });

  it("every system has authored key questions and history/genetics nodes", () => {
    for (const system of ROS_SYSTEMS) {
      const module = getSystemModule(system);
      const keyQuestions = module.filter((q) => q.key_question === true);
      const background = module.filter((q) => q.kind !== "symptom");
      expect(keyQuestions.length, system).toBeGreaterThanOrEqual(5);
      expect(background.length, system).toBeGreaterThanOrEqual(3);
    }
  });

  describe("validateAnswerAgainstBank", () => {
    it("rejects unknown keys and type mismatches", () => {
      expect(validateAnswerAgainstBank("cardiac.nope", "boolean", true)).toMatch(
        /Unknown/,
      );
      expect(
        validateAnswerAgainstBank("cardiac.chest_pain", "text", "hi"),
      ).toMatch(/expects answer type/);
    });

    it("accepts a valid boolean answer", () => {
      expect(
        validateAnswerAgainstBank("cardiac.chest_pain", "boolean", true),
      ).toBeNull();
    });

    it("enforces option membership on select answers", () => {
      const select = allNodes().find(
        ({ node }) => node.type === "single_select" || node.type === "scale",
      );
      expect(select).toBeTruthy();
      const { node } = select!;
      expect(
        validateAnswerAgainstBank(node.key, node.type, "not_a_real_option"),
      ).toMatch(/not an option/);
      expect(
        validateAnswerAgainstBank(node.key, node.type, node.options![0].value),
      ).toBeNull();
    });
  });

  describe("routing", () => {
    it("normalizes clinical-term system labels", () => {
      expect(normalizeSystem("Cardiac")).toBe("cardiac");
      expect(normalizeSystem("Obstetric/Gynae")).toBe("obstetric_gynae");
      expect(normalizeSystem("Musculoskeletal")).toBe("musculoskeletal");
      expect(normalizeSystem("Not A System")).toBeNull();
    });

    it("routes terms to systems via the subjective library (EN, FR, synonyms)", () => {
      expect(systemForTerm("Chest pain")).toBe("cardiac");
      expect(systemForTerm("Douleur thoracique")).toBe("cardiac");
      expect(systemForTerm("heart pain")).toBe("cardiac");
      expect(systemForTerm("totally unknown complaint")).toBeNull();
    });

    it("routes a multi-line chief complaint: first resolving line is primary", () => {
      const routing = systemsForComplaint("Chest pain\nCough");
      expect(routing.primary).toBe("cardiac");
      expect(routing.secondary).toContain("respiratory");
    });

    it("getQuestion resolves follow-up keys", () => {
      const withFollowups = allNodes().find(
        ({ node, parent }) => !parent && (node.followups?.length ?? 0) > 0,
      );
      expect(withFollowups).toBeTruthy();
      const f = withFollowups!.node.followups![0];
      expect(getQuestion(f.key)?.key).toBe(f.key);
    });
  });
});
