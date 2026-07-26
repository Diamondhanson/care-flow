import { describe, expect, it } from "vitest";

import {
  appendToQueue,
  applyServerVersion,
  backoffMs,
  drainOutbox,
  isEligible,
  isSyncConfigured,
  markFailed,
  markRebased,
  MAX_ATTEMPTS,
  pushChangeToServer,
  reconcileOutboxAfterDrain,
  removeFromQueue,
  resetAttempts,
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
// applyServerVersion — carry a server-confirmed version onto pending same-row
// edits so the next queued write guards on a fresh base (Phase 19).
// ---------------------------------------------------------------------------

describe("applyServerVersion", () => {
  it("stamps the version onto pending insert/update entries for the same row", () => {
    const queue = [
      entry({ id: "a", table: "orders", row_id: "o1", op: "update", payload: { id: "o1" } }),
      entry({ id: "b", table: "orders", row_id: "o1", op: "update", payload: { id: "o1" } }),
    ];
    const next = applyServerVersion(queue, "orders", "o1", 5);
    expect(next[0].payload.version).toBe(5);
    expect(next[1].payload.version).toBe(5);
  });

  it("only touches entries matching both table and row id", () => {
    const queue = [
      entry({ id: "a", table: "orders", row_id: "o1", payload: { id: "o1" } }),
      entry({ id: "b", table: "orders", row_id: "o2", payload: { id: "o2" } }),
      entry({ id: "c", table: "visits", row_id: "o1", payload: { id: "o1" } }),
    ];
    const next = applyServerVersion(queue, "orders", "o1", 3);
    expect(next[0].payload.version).toBe(3);
    expect(next[1].payload.version).toBeUndefined();
    expect(next[2].payload.version).toBeUndefined();
  });

  it("never rewrites a delete (its payload is just { id })", () => {
    const queue = [
      entry({ id: "a", table: "orders", row_id: "o1", op: "delete", payload: { id: "o1" } }),
    ];
    const next = applyServerVersion(queue, "orders", "o1", 9);
    expect(next[0].payload.version).toBeUndefined();
  });

  it("does not mutate the input queue (pure)", () => {
    const queue = [entry({ id: "a", table: "orders", row_id: "o1", payload: { id: "o1" } })];
    applyServerVersion(queue, "orders", "o1", 2);
    expect(queue[0].payload.version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reconcileOutboxAfterDrain — closes the mid-drain lost-update data-loss race.
// ---------------------------------------------------------------------------

describe("reconcileOutboxAfterDrain", () => {
  it("preserves a change enqueued during the drain (the data-loss race)", () => {
    // Drain started with [a], uploaded it. Meanwhile a mutation enqueued [b].
    const preDrain = [entry({ id: "a" })];
    const uploaded = ["a"];
    const live = [entry({ id: "a" }), entry({ id: "b", row_id: "p2", payload: { id: "p2" } })];
    const result = reconcileOutboxAfterDrain(live, preDrain, uploaded);
    // `a` uploaded → gone; `b` enqueued mid-drain → MUST survive.
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("drops every resolved id and keeps the rest", () => {
    const live = [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })];
    const result = reconcileOutboxAfterDrain(live, live, ["a", "c"]);
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("applies the drain's per-entry updates (version rebase / attempts) to survivors", () => {
    const live = [entry({ id: "a", attempts: 0 })];
    const updated = [entry({ id: "a", attempts: 1, last_error: "rebased" })];
    const result = reconcileOutboxAfterDrain(live, updated, []);
    expect(result[0].attempts).toBe(1);
    expect(result[0].last_error).toBe("rebased");
  });

  it("keeps a mid-drain entry even when a same-row entry was just resolved", () => {
    // A row re-edited during the drain: old edit (id a) uploaded, new edit (id b)
    // for the same row_id enqueued mid-drain — the new edit must not be lost.
    const preDrain = [entry({ id: "a", row_id: "r1" })];
    const live = [entry({ id: "a", row_id: "r1" }), entry({ id: "b", row_id: "r1" })];
    const result = reconcileOutboxAfterDrain(live, preDrain, ["a"]);
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("is pure — does not mutate its inputs", () => {
    const live = [entry({ id: "a" })];
    const snapshot = JSON.stringify(live);
    reconcileOutboxAfterDrain(live, live, ["a"]);
    expect(JSON.stringify(live)).toBe(snapshot);
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

// ---------------------------------------------------------------------------
// Upsert conflict targets (Phase 21) — ros_responses rows are unique on the
// business key (visit_id, question_key), not the row id. Two devices answering
// the same question offline mint different ids; landing the upsert on the
// business key converges instead of wedging the queue on the unique constraint.
// ---------------------------------------------------------------------------

interface CapturedUpsert {
  table: string;
  payload: Record<string, unknown>;
  options: { onConflict?: string } | undefined;
}

/** A minimal Supabase-client stub that records upsert calls. */
function stubClient(captured: CapturedUpsert[]) {
  return {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, options?: { onConflict?: string }) => {
        captured.push({ table, payload, options });
        return {
          select: () => Promise.resolve({ data: [{ version: 1 }], error: null }),
          then: (resolve: (v: { error: null }) => void) =>
            resolve({ error: null }),
        };
      },
    }),
  } as unknown as Parameters<typeof pushChangeToServer>[1];
}

describe("pushChangeToServer upsert conflict targets", () => {
  it("lands ros_responses inserts on (visit_id, question_key)", async () => {
    const captured: CapturedUpsert[] = [];
    await pushChangeToServer(
      entry({
        table: "ros_responses",
        op: "insert",
        row_id: "ros_1",
        payload: { id: "ros_1", visit_id: "v1", question_key: "cardiac.chest_pain" },
      }),
      stubClient(captured),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].options).toEqual({ onConflict: "visit_id,question_key" });
  });

  it("leaves id-keyed tables on the default primary-key upsert", async () => {
    const captured: CapturedUpsert[] = [];
    await pushChangeToServer(
      entry({
        table: "patient_history",
        op: "insert",
        row_id: "ph_1",
        payload: { id: "ph_1", patient_id: "p1" },
      }),
      stubClient(captured),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].options).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Retry policy (Stage 2) — exponential backoff, dead-letter, panel reset.
// ---------------------------------------------------------------------------

describe("retry policy", () => {
  const T0 = Date.parse("2026-05-01T00:00:00.000Z");

  it("fresh changes are always eligible", () => {
    expect(isEligible(entry(), T0)).toBe(true);
  });

  it("a failed change waits out its exponential backoff window", () => {
    const failed = entry({
      attempts: 1,
      last_attempt_at: "2026-05-01T00:00:00.000Z",
    });
    expect(isEligible(failed, T0 + 1_000)).toBe(false);
    expect(isEligible(failed, T0 + backoffMs(1))).toBe(true);
  });

  it("backoff doubles per attempt and caps at 10 minutes", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(20)).toBe(600_000);
  });

  it("a change at MAX_ATTEMPTS is dead-lettered (never auto-retried)", () => {
    const stuck = entry({
      attempts: MAX_ATTEMPTS,
      last_attempt_at: "2026-05-01T00:00:00.000Z",
    });
    expect(isEligible(stuck, T0 + 86_400_000)).toBe(false);
  });

  it("resetAttempts clears the failure bookkeeping so it retries immediately", () => {
    const queue = [
      entry({
        id: "a",
        attempts: MAX_ATTEMPTS,
        last_error: "boom",
        last_attempt_at: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const next = resetAttempts(queue, "a");
    expect(next[0]).toMatchObject({ attempts: 0, last_error: null, last_attempt_at: null });
    expect(isEligible(next[0], T0)).toBe(true);
  });

  it("markFailed stamps the attempt time that drives the backoff", () => {
    const next = markFailed([entry({ id: "a" })], "a", "boom", "2026-05-01T00:01:00.000Z");
    expect(next[0]).toMatchObject({
      attempts: 1,
      last_error: "boom",
      last_attempt_at: "2026-05-01T00:01:00.000Z",
    });
  });

  it("markRebased counts a conflict retry but stays immediately eligible", () => {
    // The local-wins re-base path must not sit out a failure backoff — the
    // re-based change is expected to land on the very next push.
    const next = markRebased([entry({ id: "a" })], "a");
    expect(next[0].attempts).toBe(1);
    expect(next[0].last_attempt_at).toBeNull();
    expect(isEligible(next[0], T0)).toBe(true);
  });
});
