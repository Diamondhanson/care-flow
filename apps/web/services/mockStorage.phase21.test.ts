/**
 * Phase 21 service-layer tests — patient background (patient_history) and
 * Review of Systems (ros_responses).
 *
 * These flows write in one call and read in another, which needs persistence
 * between `loadDatabase()` calls. In the node test environment mockStorage
 * returns a fresh seed per call, so this file installs a window/localStorage
 * polyfill BEFORE the service runs (mockStorage checks `typeof window` at call
 * time). Kept separate from mockStorage.test.ts, whose tests are written
 * against the non-persisted node behaviour — vitest isolates module state per
 * test file, so the polyfill cannot leak.
 */

import { beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();
(globalThis as Record<string, unknown>).window = {
  localStorage: memoryStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
(globalThis as Record<string, unknown>).localStorage = memoryStorage;

import {
  addConsultation,
  addPatientHistory,
  clearRosResponse,
  resetDatabase,
  deletePatientHistory,
  getHistoryForPatient,
  getPatientById,
  getRosResponsesForVisit,
  updatePatientDemographics,
  updatePatientHistory,
  upsertRosResponse,
} from "@/services/mockStorage";
import { compileRosNarrative } from "@/lib/ros/compile";
import type {
  PatientId,
  StaffId,
  VisitId,
} from "@careflow/shared";

/** Test sugar: brand a seeded string id at a typed call boundary. */
const brand = <T extends string>(v: string): T => v as T;


beforeEach(() => {
  // A fresh store per test: the engine keeps the authoritative copy in memory
  // (Stage 3), so clearing localStorage alone no longer re-seeds — reset the
  // engine explicitly, then clear the legacy storage shim.
  memoryStorage.clear();
  resetDatabase();
});

describe("patient history CRUD", () => {
  it("adds, reads, updates and deletes a background record", () => {
    const added = addPatientHistory(brand<PatientId>("pat_bello"), {
      type: "past_medical",
      description: "Asthma",
      onset: "childhood",
      is_active: true,
      noted_by_id: brand<StaffId>("staff_okafor"),
    });
    expect(added.patient_id).toBe("pat_bello");
    expect(added.hospital_id).toBe("hosp_demo");
    expect(getHistoryForPatient(brand<PatientId>("pat_bello")).map((h) => h.id)).toContain(
      added.id,
    );

    const updated = updatePatientHistory(added.id, {
      description: "Asthma (well controlled)",
      is_active: false,
    });
    expect(updated.description).toBe("Asthma (well controlled)");
    expect(updated.is_active).toBe(false);
    expect(updated.onset).toBe("childhood"); // untouched fields survive

    deletePatientHistory(added.id);
    expect(getHistoryForPatient(brand<PatientId>("pat_bello")).map((h) => h.id)).not.toContain(
      added.id,
    );
  });

  it("orders history by type group, then recency", () => {
    const social = addPatientHistory(brand<PatientId>("pat_bello"), {
      type: "social",
      description: "Non-smoker",
      detail: { alcohol: "occasional" },
    });
    const medical = addPatientHistory(brand<PatientId>("pat_bello"), {
      type: "past_medical",
      description: "Hypertension",
    });
    const list = getHistoryForPatient(brand<PatientId>("pat_bello"));
    const medicalIdx = list.findIndex((h) => h.id === medical.id);
    const socialIdx = list.findIndex((h) => h.id === social.id);
    expect(medicalIdx).toBeGreaterThanOrEqual(0);
    expect(socialIdx).toBeGreaterThanOrEqual(0);
    expect(medicalIdx).toBeLessThan(socialIdx);
  });

  it("rejects a detail payload that does not match the type's shape", () => {
    expect(() =>
      addPatientHistory(brand<PatientId>("pat_bello"), {
        type: "social",
        description: "Smoker",
        detail: { injected: "<script>" }, // unknown key for social
      }),
    ).toThrow();
    expect(() =>
      addPatientHistory(brand<PatientId>("pat_bello"), {
        type: "past_medical",
        description: "Diabetes",
        detail: { anything: true }, // past_medical carries no detail
      }),
    ).toThrow();
  });

  it("throws for an unknown patient", () => {
    expect(() =>
      addPatientHistory(brand<PatientId>("nope"), { type: "family", description: "X" }),
    ).toThrow(/not found/);
  });
});

describe("updatePatientDemographics", () => {
  it("review-and-updates occupation, marital status and emergency contact", () => {
    const updated = updatePatientDemographics(brand<PatientId>("pat_anon_gamma"), {
      occupation: "Farmer",
      marital_status: "married",
      emergency_contact_name: "Ama K.",
      emergency_contact_phone: "+237670000000",
    });
    expect(updated.occupation).toBe("Farmer");
    expect(updated.marital_status).toBe("married");
    expect(getPatientById(brand<PatientId>("pat_anon_gamma"))?.emergency_contact_name).toBe("Ama K.");
  });

  it("only touches the provided fields; empty strings clear to null", () => {
    updatePatientDemographics(brand<PatientId>("pat_owusu"), { occupation: "Retired teacher" });
    const partial = updatePatientDemographics(brand<PatientId>("pat_owusu"), { occupation: "" });
    expect(partial.occupation).toBeNull();
    // marital_status untouched by either call
    expect(partial.marital_status).toBe("widowed");
  });

  it("rejects oversized input and unknown patients", () => {
    expect(() =>
      updatePatientDemographics(brand<PatientId>("pat_owusu"), { occupation: "x".repeat(200) }),
    ).toThrow();
    expect(() =>
      updatePatientDemographics(brand<PatientId>("nope"), { occupation: "Farmer" }),
    ).toThrow(/not found/);
  });
});

describe("upsertRosResponse / clearRosResponse", () => {
  const chestPain = {
    system: "cardiac" as const,
    question_key: "cardiac.chest_pain",
    kind: "symptom" as const,
    question_text: "Chest pain?",
    answer_type: "boolean" as const,
    answer_label: "Yes",
    recorded_by_id: brand<StaffId>("staff_okafor"),
  };

  it("re-answering updates the row in place — never a duplicate", () => {
    const first = upsertRosResponse(brand<VisitId>("vis_mensah"), {
      ...chestPain,
      answer_value: true,
    });
    const second = upsertRosResponse(brand<VisitId>("vis_mensah"), {
      ...chestPain,
      answer_value: false,
      answer_label: "No",
    });
    expect(second.id).toBe(first.id);
    const rows = getRosResponsesForVisit(brand<VisitId>("vis_mensah")).filter(
      (r) => r.question_key === "cardiac.chest_pain",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].answer_value).toBe(false);
    expect(rows[0].answer_label).toBe("No");
  });

  it("clearing deletes the row; absence = not asked", () => {
    upsertRosResponse(brand<VisitId>("vis_mensah"), { ...chestPain, answer_value: true });
    clearRosResponse(brand<VisitId>("vis_mensah"), "cardiac.chest_pain");
    expect(
      getRosResponsesForVisit(brand<VisitId>("vis_mensah")).find(
        (r) => r.question_key === "cardiac.chest_pain",
      ),
    ).toBeUndefined();
    // Clearing an absent answer is a no-op, not an error.
    clearRosResponse(brand<VisitId>("vis_mensah"), "cardiac.chest_pain");
  });

  it("stores a follow-up answer with its selected option", () => {
    const row = upsertRosResponse(brand<VisitId>("vis_mensah"), {
      system: "cardiac",
      question_key: "cardiac.chest_pain.character",
      kind: "symptom",
      question_text: "Character",
      answer_type: "single_select",
      answer_value: "crushing",
      answer_label: "Crushing",
    });
    expect(row.answer_value).toBe("crushing");
  });

  it("rejects unknown bank keys and mismatched answer shapes", () => {
    expect(() =>
      upsertRosResponse(brand<VisitId>("vis_mensah"), {
        ...chestPain,
        question_key: "cardiac.not_a_question",
        answer_value: true,
      }),
    ).toThrow(/Unknown/);
    expect(() =>
      upsertRosResponse(brand<VisitId>("vis_mensah"), {
        ...chestPain,
        answer_value: "yes please" as unknown as boolean, // boolean question
      }),
    ).toThrow();
    expect(() =>
      upsertRosResponse(brand<VisitId>("vis_mensah"), {
        ...chestPain,
        question_key: "cardiac.chest_pain.character",
        answer_type: "single_select",
        answer_value: "not_a_real_option",
        answer_label: "?",
      }),
    ).toThrow(/not an option/);
  });

  it("throws for an unknown visit", () => {
    expect(() =>
      upsertRosResponse(brand<VisitId>("nope"), { ...chestPain, answer_value: true }),
    ).toThrow(/not found/);
  });
});

describe("addConsultation with ROS", () => {
  it("stores ros_summary and adopts the visit's unlinked ROS rows", () => {
    const row = upsertRosResponse(brand<VisitId>("vis_bello"), {
      system: "respiratory",
      question_key: "respiratory.cough",
      kind: "symptom",
      question_text: "Cough?",
      answer_type: "boolean",
      answer_value: false,
      answer_label: "No",
    });
    expect(row.consultation_id).toBeNull();

    const consultation = addConsultation(brand<VisitId>("vis_bello"), {
      doctor_id: brand<StaffId>("staff_okafor"),
      assessment: "Resolving pneumonia.",
      ros_summary: "Respiratory: Denies cough.",
    });
    expect(consultation.ros_summary).toBe("Respiratory: Denies cough.");

    const linked = getRosResponsesForVisit(brand<VisitId>("vis_bello")).find(
      (r) => r.id === row.id,
    );
    expect(linked?.consultation_id).toBe(consultation.id);
  });

  it("leaves ros_summary null when not supplied", () => {
    const consultation = addConsultation(brand<VisitId>("vis_bello"), {
      doctor_id: brand<StaffId>("staff_okafor"),
      assessment: "Plain note.",
    });
    expect(consultation.ros_summary).toBeNull();
  });
});

describe("seeded demo ROS (Mensah's chest-pain encounter)", () => {
  it("ships a partial ROS whose narrative compiles in EN and FR", () => {
    const rows = getRosResponsesForVisit(brand<VisitId>("vis_mensah"));
    expect(rows.length).toBeGreaterThanOrEqual(8);

    const en = compileRosNarrative(rows, "en");
    expect(en).toContain("Cardiac: Reports chest pain");
    expect(en).toContain("character: Crushing");
    expect(en).toContain("Denies palpitations");
    expect(en).toContain("family history of premature coronary");
    expect(en).toContain("Respiratory: Denies");

    const fr = compileRosNarrative(rows, "fr");
    expect(fr).toContain("Cardiaque: Signale douleur thoracique");
    expect(fr).toContain("caractère: Écrasante");
    expect(fr).toContain("Nie palpitations");
    expect(fr).toContain("Respiratoire: Nie");
  });

  it("seeds Owusu's background for the drawer demo", () => {
    const history = getHistoryForPatient(brand<PatientId>("pat_owusu"));
    expect(history.length).toBeGreaterThanOrEqual(4);
    expect(history.some((h) => h.type === "past_medical" && /diabetes/i.test(h.description))).toBe(true);
    expect(history.some((h) => h.type === "family")).toBe(true);
  });
});
