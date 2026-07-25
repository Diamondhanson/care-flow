import { act } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { notify } from "@/lib/notify";
import { renderWithProviders } from "@/test-utils";

/** Fire a notification inside act() so the resulting state update is flushed. */
function fireNotify(input: Parameters<typeof notify>[0]) {
  act(() => {
    notify(input);
  });
}

describe("Toaster", () => {
  it("shows a toast with the translated title when notify() fires", () => {
    renderWithProviders(<Toaster />);

    fireNotify({ kind: "success", titleKey: "notify.storageFullTitle" });

    // titleKey is an i18n key — the Toaster translates it at render time.
    expect(
      screen.getByText("This device's storage is full"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it('gives error notifications role="alert"', () => {
    renderWithProviders(<Toaster />);

    fireNotify({
      kind: "error",
      titleKey: "notify.outboxWriteFailedTitle",
      bodyKey: "notify.outboxWriteFailedBody",
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not queue your change for sync");
  });

  it("removes the toast when its dismiss button is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Toaster />);

    fireNotify({ kind: "info", titleKey: "notify.cacheResetTitle" });
    expect(screen.getByText("Local data was reset")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Local data was reset")).not.toBeInTheDocument();
  });

  it("renders inside AuthProvider's unconfigured (no Supabase env) path", () => {
    // vitest.dom.setup.ts deletes the NEXT_PUBLIC_SUPABASE_* vars, so this
    // exercises the backendConfigured=false branch of the real AuthProvider.
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();

    renderWithProviders(<Toaster />, { withAuth: true });
    fireNotify({ kind: "warning", titleKey: "notify.uploadRetryTitle" });

    expect(
      screen.getByText("A file is waiting to upload"),
    ).toBeInTheDocument();
  });
});
