import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/ui/status-badge";
import { renderWithProviders } from "@/test-utils";

describe("StatusBadge", () => {
  it("soft variant tints with the tone var and a color-mix background", () => {
    renderWithProviders(<StatusBadge tone="treatment">In treatment</StatusBadge>);

    const badge = screen.getByText("In treatment");
    // Read the raw inline style attribute: jsdom's CSSOM may normalize or drop
    // values it can't parse (color-mix), but React writes them all inline.
    const style = badge.getAttribute("style") ?? "";
    expect(style).toContain("color: var(--status-treatment)");
    expect(style).toContain(
      "color-mix(in oklab, var(--status-treatment) 16%, transparent)",
    );
  });

  it("solid variant fills with the tone var and its foreground var", () => {
    renderWithProviders(
      <StatusBadge tone="discharge" variant="solid">
        Discharged
      </StatusBadge>,
    );

    const badge = screen.getByText("Discharged");
    const style = badge.getAttribute("style") ?? "";
    expect(style).toContain("background-color: var(--status-discharge)");
    expect(style).toContain("color: var(--status-discharge-foreground)");
  });

  it("renders its children", () => {
    renderWithProviders(
      <StatusBadge tone="warning" size="md">
        <span>Overdue meds</span>
      </StatusBadge>,
    );

    expect(screen.getByText("Overdue meds")).toBeInTheDocument();
  });
});
