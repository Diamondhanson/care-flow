import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormDialog } from "@/components/ui/form-dialog";
import { renderWithProviders } from "@/test-utils";

function dialogProps(onSubmit: () => void, error: string | null = null) {
  return {
    open: true,
    onOpenChange: () => {},
    title: "Edit ward",
    cancelLabel: "Cancel",
    submitLabel: "Save",
    onSubmit,
    error,
  };
}

/** A minimal labelled field so Enter-to-submit runs through a real input. */
function NameField() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="Ward name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

describe("FormDialog", () => {
  it("shows the inline error string when provided", () => {
    renderWithProviders(
      <FormDialog {...dialogProps(vi.fn(), "Name is already taken")}>
        <NameField />
      </FormDialog>,
    );

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Name is already taken");
  });

  it("calls onSubmit when the submit button is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <FormDialog {...dialogProps(onSubmit)}>
        <NameField />
      </FormDialog>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits when Enter is pressed in a field (real <form>)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <FormDialog {...dialogProps(onSubmit)}>
        <NameField />
      </FormDialog>,
    );

    await user.type(screen.getByLabelText("Ward name"), "Maternity B{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
