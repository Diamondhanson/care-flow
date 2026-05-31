import { describe, expect, it } from "vitest";

import {
  appendToQueue,
  drainOutbox,
  isSyncConfigured,
  markFailed,
  removeFromQueue,
  type NewChange,
  type OutboxChange,
} from "@/services/syncQueue";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function newChange(overrides: Partial<NewChange> = {}): NewChange {
  return {
    table: "patients",
    op: "insert",
    row_id: "p1",
    payload: { id: "p1" },
    ...overrides,
  };
}

function entry(overrides: Partial<OutboxChange> = {}): OutboxChange {
  return {
    id: "chg_1",
    table: "patients",
    op: "insert",
    row_id: "p1",
    payload: { id: "p1" },
    enqueued_at: "2026-05-01T00:00:00.000Z",
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// appendToQueue — pure, deterministic id/timestamp injection for testability.
// ---------------------------------------------------------------------------

describe("appendToQueue", () => {
  it("materializes new changes into full entries with id, timestamp and counters", () => {
    let n = 0;
    const queue = appendToQueue(
      [],
      [newChange({ row_id: "p1" }), newChange({ row_id: "p2" })],
      () => `id_${++n}`,
      "2026-05-01T00:00:00.000Z",
    );
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      id: "id_1",
      row_id: "p1",
      enqueued_at: "2026-05-01T00:00:00.000Z",
      attempts: 0,
      last_error: null,
    });
    expect(queue[1].id).toBe("id_2");
  });

  it("appends without mutating the existing queue", () => {
    const existing = [entry({ id: "old" })];
    const next = appendToQueue(existing, [newChange()], () => "new");
    expect(existing).toHaveLength(1);
    expect(next.map((c) => c.id)).toEqual(["old", "new"]);
  });
});

// ---------------------------------------------------------------------------
// removeFromQueue — drops successfully-uploaded entries.
// ---------------------------------------------------------------------------

describe("removeFromQueue", () => {
  it("removes the given ids and keeps the rest", () => {
    const queue = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
    expect(removeFromQueue(queue, ["a", "c"]).map((c) => c.id)).toEqual(["b"]);
  });

  it("returns the same queue when no ids are given", () => {
    const queue = [entry({ id: "a" })];
    expect(removeFromQueue(queue, [])).toBe(queue);
  });
});

// ---------------------------------------------------------------------------
// markFailed — records an upload failure for retry/backoff.
// ---------------------------------------------------------------------------

describe("markFailed", () => {
  it("increments attempts and records the error on the matching entry only", () => {
    const queue = [entry({ id: "a" }), entry({ id: "b" })];
    const next = markFailed(queue, "a", "network down");
    expect(next[0]).toMatchObject({ attempts: 1, last_error: "network down" });
    expect(next[1]).toMatchObject({ attempts: 0, last_error: null });
  });

  it("accumulates attempts across repeated failures", () => {
    let queue = [entry({ id: "a" })];
    queue = markFailed(queue, "a", "first");
    queue = markFailed(queue, "a", "second");
    expect(queue[0]).toMatchObject({ attempts: 2, last_error: "second" });
  });
});

// ---------------------------------------------------------------------------
// The sync seam — unconfigured until Supabase lands (Phase 13).
// ---------------------------------------------------------------------------

describe("the sync seam", () => {
  it("reports sync as not configured", () => {
    expect(isSyncConfigured()).toBe(false);
  });

  it("drainOutbox is a no-op that leaves the queue intact while unconfigured", async () => {
    const result = await drainOutbox();
    expect(result).toMatchObject({ skipped: true, uploaded: 0, failed: 0 });
  });
});
