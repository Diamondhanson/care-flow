import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VitalsForm } from "@/components/live-board/drawer/vitals-form";
import { addTreatmentLog } from "@/services/mockStorage";
import type { VisitId } from "@/types/healthcare";
import { renderWithProviders } from "@/test-utils";

// The form persists through the mockStorage barrel; mock ONLY the mutator it
// calls and keep every other export real (test-utils' AuthProvider and the
// barrel's re-exports still need them at module-evaluation time).
vi.mock("@/services/mockStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/mockStorage")>();
  return { ...actual, addTreatmentLog: vi.fn() };
});

const addTreatmentLogMock = vi.mocked(addTreatmentLog);

function renderForm(onSaved: () => void) {
  return renderWithProviders(
    <VitalsForm
      visitId={"visit_test_1" as VisitId}
      recorderId={null}
      resetKey="open:visit_test_1"
      onSaved={onSaved}
    />,
  );
}

describe("VitalsForm", () => {
  beforeEach(() => {
    addTreatmentLogMock.mockClear();
  });

  it("refuses an out-of-range SpO2 with an inline error and no save", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderForm(onSaved);

    await user.type(screen.getByLabelText("SpO₂ (%)"), "999");
    await user.click(screen.getByRole("button", { name: "Save log entry" }));

    expect(
      screen.getByText(/out of the plausible range \(0–100\)/),
    ).toBeInTheDocument();
    expect(addTreatmentLogMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves valid vitals and fires the onSaved callback", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderForm(onSaved);

    await user.type(screen.getByLabelText("SpO₂ (%)"), "97");
    await user.type(screen.getByLabelText("Pulse (bpm)"), "72");
    await user.click(screen.getByRole("button", { name: "Save log entry" }));

    expect(addTreatmentLogMock).toHaveBeenCalledTimes(1);
    const [visitId, entry] = addTreatmentLogMock.mock.calls[0];
    expect(visitId).toBe("visit_test_1");
    expect(entry).toMatchObject({ spo2: 97, pulse: 72, notes: null });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/out of the plausible range/),
    ).not.toBeInTheDocument();
  });
});
