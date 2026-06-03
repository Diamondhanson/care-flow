import { describe, expect, it } from "vitest";

import { buildVisitSummary, buildPatientHistory } from "./visit-summary";

// Exercised against the deterministic seed (each read re-seeds in the node test
// env). vis_idris is a seeded inpatient surgical visit with an admission.

describe("buildVisitSummary", () => {
  it("returns null for an unknown visit", () => {
    expect(buildVisitSummary("vis_nope")).toBeNull();
  });

  it("assembles the full record for a seeded inpatient visit", () => {
    const summary = buildVisitSummary("vis_idris");
    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.patient.full_name).toBe("Samuel Idris");
    expect(summary.visit.id).toBe("vis_idris");
    expect(summary.visit.visit_type).toBe("inpatient");
    // Inpatient → has an admission and a computed length of stay.
    expect(summary.admission).not.toBeNull();
    expect(summary.lengthOfStayDays).not.toBeNull();
    expect(summary.lengthOfStayDays).toBeGreaterThanOrEqual(0);
  });

  it("resolves staff / ward / bed names and joins orders to results", () => {
    const summary = buildVisitSummary("vis_idris");
    if (!summary) throw new Error("expected summary");

    // The attending doctor id resolves to a display name.
    expect(summary.staffName(summary.visit.attending_doctor_id)).toBeTruthy();
    expect(summary.staffName(null)).toBeNull();

    // Each order carries its (possibly empty) results array.
    for (const entry of summary.orders) {
      expect(entry).toHaveProperty("order");
      expect(Array.isArray(entry.results)).toBe(true);
    }
    // Each prescription carries its administrations array.
    for (const entry of summary.prescriptions) {
      expect(Array.isArray(entry.administrations)).toBe(true);
    }
  });

  it("sorts diagnoses primary-first and vitals chronologically", () => {
    const summary = buildVisitSummary("vis_idris");
    if (!summary) throw new Error("expected summary");

    if (summary.diagnoses.length > 1) {
      const firstPrimary = summary.diagnoses[0].is_primary;
      const laterPrimary = summary.diagnoses.slice(1).some((d) => d.is_primary);
      // Once we hit a non-primary, no primary should follow.
      if (!firstPrimary) expect(laterPrimary).toBe(false);
    }
    for (let i = 1; i < summary.vitals.length; i += 1) {
      expect(
        summary.vitals[i].recorded_at >= summary.vitals[i - 1].recorded_at,
      ).toBe(true);
    }
  });
});

describe("buildPatientHistory", () => {
  it("returns null for an unknown patient", () => {
    expect(buildPatientHistory("pat_nope")).toBeNull();
  });

  it("assembles every visit for a patient, oldest → newest", () => {
    const history = buildPatientHistory("pat_idris");
    expect(history).not.toBeNull();
    if (!history) return;

    expect(history.patient.full_name).toBe("Samuel Idris");
    expect(history.totalVisits).toBe(history.visits.length);
    expect(history.totalVisits).toBeGreaterThanOrEqual(1);

    // The inpatient visit must appear in the patient's own history.
    expect(history.visits.some((s) => s.visit.id === "vis_idris")).toBe(true);

    // Each entry is a full per-visit summary for this same patient.
    for (const s of history.visits) {
      expect(s.patient.id).toBe(history.patient.id);
    }

    // Chronological order (oldest → newest) by arrival.
    for (let i = 1; i < history.visits.length; i += 1) {
      expect(
        history.visits[i].visit.arrived_at >=
          history.visits[i - 1].visit.arrived_at,
      ).toBe(true);
    }

    // Bookends reflect the first / last arrival timestamps.
    if (history.visits.length > 0) {
      expect(history.firstArrivedAt).toBe(history.visits[0].visit.arrived_at);
      expect(history.lastArrivedAt).toBe(
        history.visits[history.visits.length - 1].visit.arrived_at,
      );
    }
  });
});
