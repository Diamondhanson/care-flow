import { describe, expect, it } from "vitest";

import { ROLE_LABEL, staffInitials } from "@/components/role-provider";
import { translate } from "@/i18n";

describe("staffInitials", () => {
  it("uses first and last name initials", () => {
    expect(staffInitials("Grace Mensah")).toBe("GM");
    expect(staffInitials("Samuel Idris")).toBe("SI");
  });

  it("strips honorifics and role prefixes", () => {
    expect(staffInitials("Dr. A. Okafor")).toBe("AO");
    expect(staffInitials("Nurse J. Patel")).toBe("JP");
  });

  it("handles a single token name", () => {
    expect(staffInitials("Boateng")).toBe("B");
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(staffInitials("")).toBe("?");
    expect(staffInitials("Dr.")).toBe("?");
  });
});

describe("ROLE_LABEL", () => {
  it("provides a human label for every staff role", () => {
    expect(translate("en", ROLE_LABEL.doctor)).toBe("Doctor");
    expect(translate("en", ROLE_LABEL.lab_tech)).toBe("Lab Technician");
    expect(translate("en", ROLE_LABEL.receptionist)).toBe("Receptionist");
  });
});
