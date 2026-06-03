import { describe, expect, it } from "vitest";

import {
  COMMON_DRUGS,
  DOSE_STATE_ORDER,
  FREQUENCY_OPTIONS,
  MAR_STATUS_LABEL,
  MAR_STATUS_TOKEN,
  OVERDUE_GRACE_MS,
  PRESCRIPTION_STATUS_LABEL,
  PRESCRIPTION_STATUS_TOKEN,
  computeDoseStatus,
  isPrescriptionActive,
  parseFrequencyHours,
} from "@/components/medications/prescriptions";
import { translate } from "@/i18n";
import type {
  MedicationAdministration,
  Prescription,
} from "@/types/healthcare";

function rx(partial: Partial<Prescription>): Prescription {
  return {
    id: "rx_x",
    visit_id: "vis_x",
    prescribed_by_id: null,
    drug_name: "Paracetamol",
    dose: "1 g",
    route: "oral",
    frequency: "every 8 hours",
    duration: "5 days",
    instructions: null,
    status: "active",
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
    ...partial,
  };
}

function mar(
  partial: Partial<MedicationAdministration>,
): MedicationAdministration {
  return {
    id: "mar_x",
    prescription_id: "rx_x",
    administered_by_id: null,
    scheduled_for: null,
    administered_at: null,
    status: "given",
    notes: null,
    created_at: "2026-05-31T00:00:00.000Z",
    ...partial,
  };
}

describe("status label + token maps", () => {
  it("labels every prescription status", () => {
    expect(translate("en", PRESCRIPTION_STATUS_LABEL.active)).toBe("Active");
    expect(translate("en", PRESCRIPTION_STATUS_LABEL.completed)).toBe("Completed");
    expect(translate("en", PRESCRIPTION_STATUS_LABEL.discontinued)).toBe("Discontinued");
  });

  it("maps every prescription status to a token", () => {
    expect(PRESCRIPTION_STATUS_TOKEN.active).toBe("diagnostics");
    expect(PRESCRIPTION_STATUS_TOKEN.completed).toBe("discharge");
    expect(PRESCRIPTION_STATUS_TOKEN.discontinued).toBe("muted");
  });

  it("labels and tokenizes every MAR status", () => {
    expect(translate("en", MAR_STATUS_LABEL.given)).toBe("Given");
    expect(translate("en", MAR_STATUS_LABEL.held)).toBe("Held");
    expect(translate("en", MAR_STATUS_LABEL.refused)).toBe("Refused");
    expect(translate("en", MAR_STATUS_LABEL.missed)).toBe("Missed");
    expect(MAR_STATUS_TOKEN.given).toBe("clearance");
    expect(MAR_STATUS_TOKEN.refused).toBe("treatment");
  });

  it("offers schedulable frequency quick-picks and common drugs", () => {
    expect(FREQUENCY_OPTIONS.length).toBeGreaterThan(0);
    expect(COMMON_DRUGS.length).toBeGreaterThan(0);
    // Every non-PRN quick-pick must yield a usable interval.
    for (const f of FREQUENCY_OPTIONS) {
      if (f === "as required") {
        expect(parseFrequencyHours(f)).toBeNull();
      } else {
        expect(parseFrequencyHours(f)).toBeGreaterThan(0);
      }
    }
  });
});

describe("isPrescriptionActive", () => {
  it("is true only for active", () => {
    expect(isPrescriptionActive("active")).toBe(true);
    expect(isPrescriptionActive("completed")).toBe(false);
    expect(isPrescriptionActive("discontinued")).toBe(false);
  });
});

describe("parseFrequencyHours", () => {
  it("parses 'every N hours'", () => {
    expect(parseFrequencyHours("every 8 hours")).toBe(8);
    expect(parseFrequencyHours("every 6 hours")).toBe(6);
    expect(parseFrequencyHours("every 12 hours")).toBe(12);
  });

  it("parses 'N times daily' phrasing", () => {
    expect(parseFrequencyHours("once daily")).toBe(24);
    expect(parseFrequencyHours("twice daily")).toBe(12);
    expect(parseFrequencyHours("three times daily")).toBe(8);
    expect(parseFrequencyHours("four times daily")).toBe(6);
    expect(parseFrequencyHours("2 times a day")).toBe(12);
  });

  it("parses Latin shorthand", () => {
    expect(parseFrequencyHours("BD")).toBe(12);
    expect(parseFrequencyHours("tds")).toBe(8);
    expect(parseFrequencyHours("QDS")).toBe(6);
    expect(parseFrequencyHours("OD")).toBe(24);
  });

  it("treats 'at night' / 'nocte' / bare daily as once daily", () => {
    expect(parseFrequencyHours("at night")).toBe(24);
    expect(parseFrequencyHours("nocte")).toBe(24);
    expect(parseFrequencyHours("daily")).toBe(24);
  });

  it("returns null for PRN / unparseable / empty", () => {
    expect(parseFrequencyHours("as required")).toBeNull();
    expect(parseFrequencyHours("PRN")).toBeNull();
    expect(parseFrequencyHours("as needed")).toBeNull();
    expect(parseFrequencyHours(null)).toBeNull();
    expect(parseFrequencyHours("")).toBeNull();
    expect(parseFrequencyHours("whenever")).toBeNull();
  });
});

describe("computeDoseStatus", () => {
  const created = "2026-05-31T00:00:00.000Z";
  const createdMs = new Date(created).getTime();

  it("is inactive for a non-active prescription", () => {
    const s = computeDoseStatus(
      rx({ status: "discontinued" }),
      [mar({ status: "given", administered_at: created })],
      createdMs,
    );
    expect(s.state).toBe("inactive");
    expect(s.nextDueAt).toBeNull();
  });

  it("is prn when the frequency has no fixed schedule", () => {
    const s = computeDoseStatus(
      rx({ frequency: "as required" }),
      [],
      createdMs,
    );
    expect(s.state).toBe("prn");
    expect(s.nextDueAt).toBeNull();
  });

  it("schedules the first dose from created_at when none given yet", () => {
    // 8-hourly, prescribed at midnight → first dose due at 08:00.
    const dueMs = createdMs + 8 * 3600_000;
    // Before due → upcoming.
    expect(computeDoseStatus(rx({}), [], createdMs + 3600_000).state).toBe(
      "upcoming",
    );
    // Exactly at due → due.
    expect(computeDoseStatus(rx({}), [], dueMs).state).toBe("due");
    // Within grace → still due.
    expect(
      computeDoseStatus(rx({}), [], dueMs + OVERDUE_GRACE_MS - 1).state,
    ).toBe("due");
    // Past grace → overdue.
    expect(
      computeDoseStatus(rx({}), [], dueMs + OVERDUE_GRACE_MS + 1).state,
    ).toBe("overdue");
  });

  it("schedules the next dose from the last given administration", () => {
    const lastGiven = "2026-05-31T06:00:00.000Z";
    const lastGivenMs = new Date(lastGiven).getTime();
    const admins = [
      mar({ status: "given", administered_at: lastGiven }),
      mar({ status: "given", administered_at: created }),
    ];
    const s = computeDoseStatus(
      rx({ frequency: "every 8 hours" }),
      admins,
      lastGivenMs + 3600_000, // 1h after last dose
    );
    expect(s.lastGivenAt).toBe(lastGiven);
    expect(s.state).toBe("upcoming"); // next due at 14:00, only 07:00 now
    expect(s.nextDueAt).toBe(
      new Date(lastGivenMs + 8 * 3600_000).toISOString(),
    );
  });

  it("ignores held/refused doses when finding the last given dose", () => {
    const s = computeDoseStatus(
      rx({ frequency: "every 8 hours" }),
      [mar({ status: "refused", administered_at: "2026-05-31T06:00:00.000Z" })],
      createdMs,
    );
    // No *given* dose → anchors on created_at, not the refusal.
    expect(s.lastGivenAt).toBeNull();
  });

  it("orders states overdue → due → upcoming → prn → inactive", () => {
    expect(DOSE_STATE_ORDER.overdue).toBeLessThan(DOSE_STATE_ORDER.due);
    expect(DOSE_STATE_ORDER.due).toBeLessThan(DOSE_STATE_ORDER.upcoming);
    expect(DOSE_STATE_ORDER.upcoming).toBeLessThan(DOSE_STATE_ORDER.prn);
    expect(DOSE_STATE_ORDER.prn).toBeLessThan(DOSE_STATE_ORDER.inactive);
  });
});
