/**
 * CareFlow outbox / sync queue (pre-Supabase groundwork).
 *
 * Every data mutation in {@link ./mockStorage} is captured here as a durable,
 * restart-surviving **pending change** — an entry in an outbox that is ready to
 * be "drained" (uploaded) to the server. The full machinery exists now; it just
 * has nothing to upload to yet, because Supabase is not provisioned (Phase 13).
 *
 * The queue is persisted to `localStorage` under its own key (separate from the
 * mock DB) so it survives crashes, refreshes and offline use, and is unaffected
 * by a DB reset/heal. Pure reducers (no storage access) hold the queue logic so
 * they can be unit-tested in the node test environment.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  THE SYNC SEAM lives in this file — see `pushChangeToServer` /            │
 * │  `isSyncConfigured` near the bottom. Implementing that one function and   │
 * │  flipping the flag is the entire job of wiring Supabase later; the queue  │
 * │  then starts draining automatically via the SyncEngine.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const OUTBOX_KEY = "careflow_outbox_v1";

/** A window event fired whenever the outbox changes, so the UI chip can react. */
export const OUTBOX_EVENT = "careflow:outbox";

/** The kind of row change to replay against the server. */
export type ChangeOp = "insert" | "update" | "delete";

/**
 * One pending mutation, recorded at the granularity of a single table row so it
 * maps directly onto a Supabase write. `table` is the **Postgres** table name
 * (snake_case) so the future seam can do `supabase.from(change.table)…`.
 */
export interface OutboxChange {
  /** Stable id for this queue entry (not the row id). */
  id: string;
  /** Postgres table the row belongs to, e.g. "medication_administrations". */
  table: string;
  op: ChangeOp;
  /** Primary key of the affected row. */
  row_id: string;
  /**
   * For insert/update: the full row to upsert. For delete: `{ id }` only.
   */
  payload: Record<string, unknown>;
  enqueued_at: string;
  /** How many upload attempts have failed so far (drives retry/backoff later). */
  attempts: number;
  last_error: string | null;
}

/** A change as produced by the diff layer, before it becomes a queue entry. */
export type NewChange = Omit<
  OutboxChange,
  "id" | "enqueued_at" | "attempts" | "last_error"
>;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function nowISO(): string {
  return new Date().toISOString();
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function emitChanged(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(OUTBOX_EVENT));
  }
}

// ---------------------------------------------------------------------------
// Pure reducers (no storage access — unit-testable in node)
// ---------------------------------------------------------------------------

/** Append new changes to a queue, materializing them into full entries. */
export function appendToQueue(
  queue: OutboxChange[],
  changes: NewChange[],
  makeId: () => string = generateId,
  timestamp: string = nowISO()
): OutboxChange[] {
  const entries: OutboxChange[] = changes.map((c) => ({
    id: makeId(),
    table: c.table,
    op: c.op,
    row_id: c.row_id,
    payload: c.payload,
    enqueued_at: timestamp,
    attempts: 0,
    last_error: null,
  }));
  return [...queue, ...entries];
}

/** Drop the given queue-entry ids (successfully uploaded changes). */
export function removeFromQueue(
  queue: OutboxChange[],
  ids: readonly string[]
): OutboxChange[] {
  if (ids.length === 0) return queue;
  const drop = new Set(ids);
  return queue.filter((c) => !drop.has(c.id));
}

/** Record an upload failure on a queue entry (increments attempts). */
export function markFailed(
  queue: OutboxChange[],
  id: string,
  error: string
): OutboxChange[] {
  return queue.map((c) =>
    c.id === id ? { ...c, attempts: c.attempts + 1, last_error: error } : c
  );
}

// ---------------------------------------------------------------------------
// Persisted outbox (browser only)
// ---------------------------------------------------------------------------

/** Read the persisted outbox. Returns `[]` on the server or if empty/corrupt. */
export function readOutbox(): OutboxChange[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxChange[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(queue: OutboxChange[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  emitChanged();
}

/** Append captured changes to the persisted outbox. No-op on the server. */
export function enqueueChanges(changes: NewChange[]): void {
  if (!isBrowser() || changes.length === 0) return;
  writeOutbox(appendToQueue(readOutbox(), changes));
}

/** Number of changes still waiting to be uploaded. */
export function pendingCount(): number {
  return readOutbox().length;
}

/** Empty the outbox (used on a full DB reset — there is nothing to sync). */
export function clearOutbox(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(OUTBOX_KEY);
  emitChanged();
}

// ===========================================================================
// ⬇⬇⬇  THE SYNC SEAM — implement these two for the Supabase cutover (Phase 13) ⬇⬇⬇
// ===========================================================================

/**
 * Thrown by {@link pushChangeToServer} until the backend is wired. Lets the
 * drain loop detect "no server yet" without special-casing strings.
 */
export class SyncNotConfiguredError extends Error {
  constructor() {
    super("CareFlow sync is not configured yet — Supabase lands in Phase 13.");
    this.name = "SyncNotConfiguredError";
  }
}

/**
 * Is a real backend wired up? Returns `false` today, so {@link drainOutbox} is a
 * no-op and the queue simply accumulates. Flip this to `true` (e.g. once the
 * Supabase client + env vars exist) the day you implement
 * {@link pushChangeToServer}, and queued changes start draining automatically.
 */
export function isSyncConfigured(): boolean {
  return false;
}

/**
 * ⭐ THE one function to implement when Supabase is provisioned. ⭐
 *
 * Upload a single queued change to the server. Today it throws — there is no
 * server. The Phase-13 implementation is roughly:
 *
 * ```ts
 * import { supabase } from "@/services/supabaseClient";
 * export async function pushChangeToServer(change: OutboxChange): Promise<void> {
 *   const { error } =
 *     change.op === "delete"
 *       ? await supabase.from(change.table).delete().eq("id", change.row_id)
 *       : await supabase.from(change.table).upsert(change.payload);
 *   if (error) throw error;
 * }
 * ```
 *
 * Note: this is intentionally a single-row replay (last-write-wins). The
 * multi-device merge / conflict-resolution engine is deliberately NOT built here
 * — it genuinely needs the central server and stays in Phase 13.
 */
export async function pushChangeToServer(_change: OutboxChange): Promise<void> {
  void _change;
  throw new SyncNotConfiguredError();
}

// ===========================================================================
// ⬆⬆⬆  END OF THE SYNC SEAM  ⬆⬆⬆
// ===========================================================================

export interface DrainResult {
  /** True when there is no backend yet — the queue was left untouched. */
  skipped: boolean;
  /** Changes successfully uploaded and removed from the queue this run. */
  uploaded: number;
  /** Changes that failed to upload this run (kept for retry). */
  failed: number;
  /** Changes still in the queue after this run. */
  remaining: number;
}

/**
 * Attempt to drain the outbox: upload each pending change oldest-first, removing
 * successes and recording failures for retry. While {@link isSyncConfigured} is
 * `false` this is a safe no-op that leaves every change queued, so it can be
 * called freely on startup / when the network returns without side effects.
 */
export async function drainOutbox(): Promise<DrainResult> {
  const queue = readOutbox();

  if (!isSyncConfigured()) {
    return { skipped: true, uploaded: 0, failed: 0, remaining: queue.length };
  }

  let working = queue;
  const uploadedIds: string[] = [];
  let failed = 0;

  for (const change of queue) {
    try {
      await pushChangeToServer(change);
      uploadedIds.push(change.id);
    } catch (err) {
      failed += 1;
      working = markFailed(
        working,
        change.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  working = removeFromQueue(working, uploadedIds);
  writeOutbox(working);

  return {
    skipped: false,
    uploaded: uploadedIds.length,
    failed,
    remaining: working.length,
  };
}
