import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SyncStatus } from "@/components/pwa/sync-status";
import {
  MAX_ATTEMPTS,
  readOutbox,
  type ConflictRecord,
  type OutboxChange,
} from "@/services/syncQueue";
import { renderWithProviders } from "@/test-utils";

const OUTBOX_KEY = "careflow_outbox_v1";
const CONFLICTS_KEY = "careflow_conflicts_v1";

function outboxEntry(
  id: string,
  attempts: number,
  overrides: Partial<OutboxChange> = {},
): OutboxChange {
  return {
    id,
    table: "patients",
    op: "update",
    row_id: `row_${id}`,
    payload: { id: `row_${id}` },
    enqueued_at: "2026-07-20T10:00:00.000Z",
    attempts,
    last_error: attempts > 0 ? "boom: server said no" : null,
    last_attempt_at: attempts > 0 ? "2026-07-20T10:05:00.000Z" : null,
    ...overrides,
  };
}

const conflict: ConflictRecord = {
  id: "conflict_1",
  table: "patients",
  row_id: "row_conflicted",
  payload: { id: "row_conflicted", full_name: "Mine" },
  detected_at: "2026-07-20T11:00:00.000Z",
};

/** Seed one waiting (0), one retrying (2) and one dead-lettered (8) change. */
function seedQueue() {
  window.localStorage.setItem(
    OUTBOX_KEY,
    JSON.stringify([
      outboxEntry("waiting", 0),
      outboxEntry("retrying", 2),
      outboxEntry("dead", MAX_ATTEMPTS),
    ]),
  );
  window.localStorage.setItem(CONFLICTS_KEY, JSON.stringify([conflict]));
}

/** The <section> containing the given group heading, for scoped queries. */
function sectionOf(headingText: RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name: headingText });
  const section = heading.closest("section");
  if (!section) throw new Error(`No <section> around heading ${headingText}`);
  return section;
}

describe("SyncStatus", () => {
  beforeEach(() => {
    seedQueue();
  });

  it("opens the panel and renders the three outbox groups plus conflicts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SyncStatus />);

    // Dead-lettered changes put the chip in the "needs attention" state.
    await user.click(screen.getByRole("button", { name: "Needs attention" }));

    expect(screen.getByText("Sync health")).toBeInTheDocument();

    // The three outbox groups.
    const attention = sectionOf(/Needs attention/);
    const retrying = sectionOf(/Retrying/);
    const waiting = sectionOf(/Waiting to send/);
    expect(
      within(attention).getByText("boom: server said no"),
    ).toBeInTheDocument();
    expect(within(retrying).getByText("2 failed attempts", { exact: false })).toBeInTheDocument();
    expect(within(waiting).getByText(/queued/)).toBeInTheDocument();

    // The conflict section with its re-apply affordance.
    const conflicts = sectionOf(/Didn't save — someone else changed it first/);
    expect(
      within(conflicts).getByRole("button", { name: "Re-apply my change" }),
    ).toBeInTheDocument();

    // Dead-lettered entries offer Retry / Discard.
    expect(
      within(attention).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(
      within(attention).getByRole("button", { name: "Discard" }),
    ).toBeInTheDocument();
  });

  it("discarding a dead-lettered entry shrinks the persisted queue", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SyncStatus />);

    expect(readOutbox()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Needs attention" }));
    const attention = sectionOf(/Needs attention/);
    await user.click(within(attention).getByRole("button", { name: "Discard" }));

    const remaining = readOutbox();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((e) => e.attempts < MAX_ATTEMPTS)).toBe(true);
  });
});
