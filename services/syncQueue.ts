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

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";

const OUTBOX_KEY = "careflow_outbox_v1";

/** A window event fired whenever the outbox changes, so the UI chip can react. */
export const OUTBOX_EVENT = "careflow:outbox";

/**
 * A window event fired when a queued write was rejected because it targeted a
 * stale version (Phase 19 optimistic concurrency). The SyncEngine refetches the
 * losing row before this fires; the UI may use it to surface a "refreshed from
 * server" cue or simply to re-render.
 */
export const CONFLICT_EVENT = "careflow:conflict";

/**
 * Tables that carry an optimistic-concurrency `version` column (mirrors the
 * `bump_version` trigger set in supabase/schema.sql). Updates to these are
 * guarded on the base version; everything else (append-only clinical tables)
 * stays a plain last-write-wins upsert.
 */
const VERSIONED_TABLES: ReadonlySet<string> = new Set([
  "hospitals",
  "departments",
  "wards",
  "beds",
  "staff",
  "patients",
  "visits",
  "consultations",
  "orders",
  "prescriptions",
  "admissions",
  "allergies",
  "care_plan_items",
]);

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

function emitConflict(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(CONFLICT_EVENT));
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

/**
 * Propagate a server-confirmed `version` onto every still-pending insert/update
 * for the same row, so a later queued edit guards on the fresh base instead of
 * the stale one it was captured with. Without this, two edits to one row made
 * back-to-back offline would have the second carry the pre-sync version and be
 * rejected as a (self-)conflict once the first lands. Pure — no storage access.
 */
export function applyServerVersion(
  queue: OutboxChange[],
  table: string,
  rowId: string,
  version: number
): OutboxChange[] {
  return queue.map((c) =>
    c.table === table && c.row_id === rowId && c.op !== "delete"
      ? { ...c, payload: { ...c.payload, version } }
      : c
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

/**
 * Persist the outbox. By default this fires {@link OUTBOX_EVENT} so the UI chip
 * and the {@link SyncEngine} react. Pass `{ emit: false }` to persist silently —
 * used when a drain only records failure bookkeeping (attempts/last_error) with
 * no change to the pending set, so it must NOT re-trigger the engine (otherwise
 * a perpetually-failing drain, e.g. while offline, would busy-loop).
 */
function writeOutbox(queue: OutboxChange[], opts: { emit?: boolean } = {}): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  if (opts.emit ?? true) emitChanged();
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
 * Is a real backend wired up? True in the browser once the Supabase env vars
 * exist (Phase 18b). False on the server / in node tests (no `window`), so
 * {@link drainOutbox} stays a safe no-op there and importing the module never
 * needs the env.
 */
export function isSyncConfigured(): boolean {
  return (
    typeof window !== "undefined" &&
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * The result of replaying one change against the server.
 *  - `ok`: the write landed. For versioned tables `version` carries the server's
 *    new authoritative version, to write back to the cache and forward onto any
 *    later queued edit of the same row.
 *  - `conflict`: a versioned update targeted a stale version (someone else moved
 *    the row first). The change is dropped and the row refetched, not retried.
 */
export type PushOutcome =
  | { status: "ok"; version?: number }
  | { status: "conflict" };

/** Drop the optimistic `version` from a payload — the DB trigger owns it. */
function stripVersion(payload: Record<string, unknown>): Record<string, unknown> {
  if (!("version" in payload)) return payload;
  const rest = { ...payload };
  delete rest.version;
  return rest;
}

/**
 * Upload a single queued change to Supabase (Phase 18b + Phase 19 optimistic
 * concurrency). Deletes remove by id; inserts upsert by primary key. Updates to
 * a {@link VERSIONED_TABLES versioned} table are guarded: the conditional
 * `.eq("version", base)` only matches while the row still sits at the version
 * the client read, so a write racing another device matches zero rows and is
 * surfaced as a `conflict` rather than silently clobbering. Non-versioned
 * (append-only) tables keep the simple last-write-wins upsert.
 *
 * The drain runs as the signed-in user, so Row-Level-Security authorizes each
 * write. `client` is injectable so integration tests can drive a specific
 * authenticated session.
 */
export async function pushChangeToServer(
  change: OutboxChange,
  client: SupabaseClient = getSupabaseClient()
): Promise<PushOutcome> {
  if (change.op === "delete") {
    const { error } = await client.from(change.table).delete().eq("id", change.row_id);
    if (error) throw error;
    return { status: "ok" };
  }

  const versioned = VERSIONED_TABLES.has(change.table);
  const base = change.payload.version;

  // Guarded update: only succeeds while the server row still sits at `base`.
  if (versioned && change.op === "update" && typeof base === "number") {
    const { data, error } = await client
      .from(change.table)
      .update(stripVersion(change.payload))
      .eq("id", change.row_id)
      .eq("version", base)
      .select("version");
    if (error) throw error;
    if (!data || data.length === 0) return { status: "conflict" };
    const newVersion = (data[0] as { version?: number }).version;
    return { status: "ok", version: typeof newVersion === "number" ? newVersion : undefined };
  }

  // Insert, or an update on a row not yet server-synced (no base to guard on):
  // upsert by primary key. On a versioned table, capture the resulting version
  // so the cache + later queued edits pick up a real base to guard on next time.
  if (versioned) {
    const { data, error } = await client
      .from(change.table)
      .upsert(stripVersion(change.payload))
      .select("version");
    if (error) throw error;
    const newVersion = data && data[0] ? (data[0] as { version?: number }).version : undefined;
    return { status: "ok", version: typeof newVersion === "number" ? newVersion : undefined };
  }

  const { error } = await client.from(change.table).upsert(change.payload);
  if (error) throw error;
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Sync hooks — the bridge back into the local cache.
//
// drainOutbox lives in the sync layer but must write server-authoritative state
// (a bumped version, or a refetched row after a conflict) back into mockStorage.
// Importing mockStorage here would create a cycle (mockStorage → syncQueue →
// mockStorage), so instead the SyncEngine registers these callbacks at runtime.
// ---------------------------------------------------------------------------

export interface SyncHooks {
  /**
   * Called after a successful versioned write with the server's new version, so
   * the local cache row can be stamped (its next edit then guards on this base).
   */
  onVersionApplied?: (table: string, rowId: string, version: number) => void;
  /**
   * Called when a write was rejected as stale. Should refetch the live row from
   * the server and re-sync the cache to it. The stale change is dropped either
   * way; this is how the losing edit's device converges on the winning state.
   */
  onConflict?: (table: string, rowId: string) => void | Promise<void>;
}

let syncHooks: SyncHooks = {};

/** Register the cache write-back callbacks (called once by the SyncEngine). */
export function setSyncHooks(hooks: SyncHooks): void {
  syncHooks = hooks;
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
  /** Stale-version changes dropped + refetched this run (not retried). */
  conflicts: number;
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
    return { skipped: true, uploaded: 0, failed: 0, conflicts: 0, remaining: queue.length };
  }

  let working = queue;
  const uploadedIds: string[] = [];
  const conflictedIds: string[] = [];
  let failed = 0;

  for (const change of queue) {
    try {
      const outcome = await pushChangeToServer(change);
      if (outcome.status === "conflict") {
        // The row moved under us. Refetch the winning state into the cache, then
        // drop the stale change — retrying it would just conflict again.
        conflictedIds.push(change.id);
        try {
          await syncHooks.onConflict?.(change.table, change.row_id);
        } catch {
          // Best-effort convergence; the stale change is dropped regardless.
        }
      } else {
        uploadedIds.push(change.id);
        if (typeof outcome.version === "number") {
          // Carry the new base forward to later queued edits of the same row…
          working = applyServerVersion(
            working,
            change.table,
            change.row_id,
            outcome.version
          );
          // …and stamp it onto the local cache row.
          syncHooks.onVersionApplied?.(change.table, change.row_id, outcome.version);
        }
      }
    } catch (err) {
      failed += 1;
      working = markFailed(
        working,
        change.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const resolvedIds = [...uploadedIds, ...conflictedIds];
  working = removeFromQueue(working, resolvedIds);
  // Only fire the change event when the pending set actually shrank. A pass that
  // only failed (e.g. offline) changes nothing the UI tracks and must not wake
  // the engine again, or it would re-drain in a tight loop. Real retries come
  // from the next `online` event, mount, or a fresh enqueue.
  writeOutbox(working, { emit: resolvedIds.length > 0 });
  if (conflictedIds.length > 0) emitConflict();

  return {
    skipped: false,
    uploaded: uploadedIds.length,
    failed,
    conflicts: conflictedIds.length,
    remaining: working.length,
  };
}
