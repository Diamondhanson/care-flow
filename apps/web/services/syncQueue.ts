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
import { notify } from "@/lib/notify";

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
  // Stage 2 fix: these two carry `version` + bump trigger in schema.sql but
  // were missing here, so billing edits were silently last-write-wins.
  "billable_items",
  "charges",
  // Stage 5: follow-up tasks are updated (marked done) so they're versioned.
  "follow_up_tasks",
  // Phase 21: background record + ROS rows are edited in place, so versioned.
  "patient_history",
  "ros_responses",
]);

/**
 * Upsert conflict targets for tables whose true uniqueness is a business key,
 * not the row id. Two devices answering the same ROS question offline mint
 * different ids for the same (visit, question) — an id-keyed upsert would then
 * violate the unique constraint and wedge the queue. Landing on the business
 * key converges instead; the accepted trade-off is that the later writer's row
 * id supersedes the earlier one's.
 */
const UPSERT_ON_CONFLICT: Readonly<Record<string, string>> = {
  ros_responses: "visit_id,question_key",
};

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
  /** How many upload attempts have failed so far (drives retry backoff). */
  attempts: number;
  last_error: string | null;
  /** When the last failed attempt happened (drives the backoff window). */
  last_attempt_at?: string | null;
}

/**
 * Retry policy (Stage 2): failed changes retry with exponential backoff, and
 * after {@link MAX_ATTEMPTS} they stop retrying automatically — they move to the
 * "needs attention" group in the sync panel, where an admin can retry or
 * discard them. This keeps one poisoned change (e.g. a permissions rejection)
 * from clogging the queue forever.
 */
export const MAX_ATTEMPTS = 8;

/** Backoff delay before retry N+1: 5s, 10s, 20s … capped at 10 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 600_000);
}

/**
 * Is this change eligible for an upload attempt right now? Pure, so it is
 * unit-testable: dead-lettered changes (attempts >= MAX_ATTEMPTS) never are;
 * failed ones wait out their backoff window; fresh ones always are.
 */
export function isEligible(
  change: OutboxChange,
  nowMs: number = Date.now(),
): boolean {
  if (change.attempts >= MAX_ATTEMPTS) return false;
  if (change.attempts === 0 || !change.last_attempt_at) return true;
  const last = Date.parse(change.last_attempt_at);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= backoffMs(change.attempts);
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
  error: string,
  timestamp: string = nowISO()
): OutboxChange[] {
  return queue.map((c) =>
    c.id === id
      ? { ...c, attempts: c.attempts + 1, last_error: error, last_attempt_at: timestamp }
      : c
  );
}

/** Reset a change's failure bookkeeping so it retries immediately (panel action). */
export function resetAttempts(
  queue: OutboxChange[],
  id: string
): OutboxChange[] {
  return queue.map((c) =>
    c.id === id ? { ...c, attempts: 0, last_error: null, last_attempt_at: null } : c
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

/**
 * Record a conflict re-base on a queue entry: counts an attempt (toward the
 * MAX_CONFLICT_RETRIES cap) but deliberately leaves `last_attempt_at` unset so
 * {@link isEligible} lets the re-based change push again immediately — a
 * re-based retry is expected to succeed, not to wait out a failure backoff.
 */
export function markRebased(
  queue: OutboxChange[],
  id: string
): OutboxChange[] {
  return queue.map((c) =>
    c.id === id
      ? {
          ...c,
          attempts: c.attempts + 1,
          last_error: "version conflict — rebased, retrying",
          last_attempt_at: null,
        }
      : c
  );
}

/**
 * Reconcile the outbox after a drain that spanned `await`s.
 *
 * `drainOutbox` reads the queue once, then makes one network round-trip per
 * change. A mutation can enqueue NEW changes while those awaits are in flight.
 * Persisting the drain's pre-drain working set would overwrite the localStorage
 * outbox and silently drop those mid-drain enqueues — a real data-loss race
 * (observed: a consultation + lab order saved during a slow drain vanished on
 * the next hydrate). To close it, the drain re-reads the LIVE queue and
 * reconciles by stable entry id:
 *   - drop entries it resolved (uploaded, or conflict-dropped),
 *   - apply its per-entry updates (version rebases / attempt counters) to
 *     entries that still exist,
 *   - preserve any entry enqueued mid-drain (present in `live`, absent from the
 *     drain's `updated` set) untouched.
 * Pure — no storage access.
 */
export function reconcileOutboxAfterDrain(
  live: OutboxChange[],
  updated: OutboxChange[],
  resolvedIds: readonly string[]
): OutboxChange[] {
  const resolved = new Set(resolvedIds);
  const updatedById = new Map(updated.map((c) => [c.id, c]));
  return live
    .filter((c) => !resolved.has(c.id))
    .map((c) => updatedById.get(c.id) ?? c);
}

// ---------------------------------------------------------------------------
// Persisted outbox (browser only)
// ---------------------------------------------------------------------------

/** Where a corrupt outbox payload is preserved for inspection (Stage 2). */
const OUTBOX_BACKUP_KEY = "careflow_outbox_corrupt_backup";

/**
 * Read the persisted outbox. Returns `[]` on the server or if empty. A corrupt
 * payload used to be silently discarded — losing every pending offline change
 * with no trace. Now the raw payload is preserved under a backup key and the
 * user is warned before the queue resets.
 */
export function readOutbox(): OutboxChange[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxChange[]) : [];
  } catch {
    try {
      window.localStorage.setItem(OUTBOX_BACKUP_KEY, raw);
      window.localStorage.removeItem(OUTBOX_KEY);
    } catch {
      /* preserving the backup is best-effort */
    }
    notify(
      {
        kind: "error",
        titleKey: "notify.outboxCorruptTitle",
        bodyKey: "notify.outboxCorruptBody",
      },
      { dedupeKey: "outbox-corrupt" },
    );
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
  // Guarded write (Stage 1): losing an outbox write means queued changes may
  // never reach the server — that must never happen silently.
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch (err) {
    notify(
      {
        kind: "error",
        titleKey: "notify.outboxWriteFailedTitle",
        bodyKey: "notify.outboxWriteFailedBody",
      },
      { dedupeKey: "outbox-write-failed" },
    );
    throw err;
  }
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

/**
 * Does a row have a queued, not-yet-uploaded local edit? Used by the merge
 * paths (realtime / on-demand history) to avoid visually reverting the user's
 * own pending work with a server echo.
 */
export function hasPendingChange(table: string, rowId: string): boolean {
  return readOutbox().some((c) => c.table === table && c.row_id === rowId);
}

/** Empty the outbox (used on a full DB reset — there is nothing to sync). */
export function clearOutbox(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(OUTBOX_KEY);
  emitChanged();
}

/** Panel action: retry a stuck ("needs attention") change immediately. */
export function retryChange(id: string): void {
  if (!isBrowser()) return;
  writeOutbox(resetAttempts(readOutbox(), id));
}

/** Panel action: permanently discard a stuck change (admin decision). */
export function discardChange(id: string): void {
  if (!isBrowser()) return;
  writeOutbox(removeFromQueue(readOutbox(), [id]));
}

// ---------------------------------------------------------------------------
// Conflict record (Stage 2) — when a queued edit loses an optimistic-concurrency
// race, the losing payload is no longer silently thrown away. It is kept here so
// the user can review what didn't save and re-apply it in one tap from the sync
// panel. Persisted separately from the outbox (it is not pending upload).
// ---------------------------------------------------------------------------

const CONFLICTS_KEY = "careflow_conflicts_v1";

/** A queued edit that lost a version race; kept for review/re-apply. */
export interface ConflictRecord {
  id: string;
  table: string;
  row_id: string;
  /** The losing edit's full intended row (what the user tried to save). */
  payload: Record<string, unknown>;
  detected_at: string;
}

export function readConflicts(): ConflictRecord[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(CONFLICTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConflictRecord[]) : [];
  } catch {
    return [];
  }
}

function writeConflicts(records: ConflictRecord[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CONFLICTS_KEY, JSON.stringify(records));
  } catch {
    /* best-effort — the toast already warned the user about the conflict */
  }
  emitConflict();
}

function recordConflict(change: OutboxChange): void {
  const record: ConflictRecord = {
    id: generateId(),
    table: change.table,
    row_id: change.row_id,
    payload: change.payload,
    detected_at: nowISO(),
  };
  writeConflicts([...readConflicts(), record]);
  notify(
    {
      kind: "warning",
      titleKey: "notify.conflictTitle",
      bodyKey: "notify.conflictBody",
    },
    { dedupeKey: `conflict:${change.table}:${change.row_id}`, dedupeMs: 5_000 },
  );
}

/** Remove a reviewed conflict (after re-apply, or an explicit discard). */
export function discardConflict(id: string): void {
  writeConflicts(readConflicts().filter((c) => c.id !== id));
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
  // upsert by primary key (or the table's business key — see UPSERT_ON_CONFLICT).
  // On a versioned table, capture the resulting version so the cache + later
  // queued edits pick up a real base to guard on next time.
  const onConflict = UPSERT_ON_CONFLICT[change.table];
  const upsertOptions = onConflict ? { onConflict } : undefined;

  if (versioned) {
    const { data, error } = await client
      .from(change.table)
      .upsert(stripVersion(change.payload), upsertOptions)
      .select("version");
    if (error) throw error;
    const newVersion = data && data[0] ? (data[0] as { version?: number }).version : undefined;
    return { status: "ok", version: typeof newVersion === "number" ? newVersion : undefined };
  }

  const { error } = await client.from(change.table).upsert(change.payload, upsertOptions);
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

/** Max times a conflicting change is re-based + retried before we give up and
 *  converge on the server. A re-based change usually lands on the next push, so
 *  this only bites a row a genuine second device keeps moving. */
export const MAX_CONFLICT_RETRIES = 3;

export interface SyncHooks {
  /**
   * Called after a successful versioned write with the server's new version, so
   * the local cache row can be stamped (its next edit then guards on this base).
   * Also used to re-base the cache row after a conflict — it patches ONLY the
   * version, keeping the local field values, so a re-based retry re-sends the
   * user's edit rather than losing it.
   */
  onVersionApplied?: (table: string, rowId: string, version: number) => void;
  /**
   * Fetch the server row's current `version` (for re-basing a conflicting edit).
   * Returns null if the row is gone / has no version.
   */
  resolveServerVersion?: (
    table: string,
    rowId: string,
  ) => Promise<number | null>;
  /**
   * Called when a stale write is GIVEN UP ON (after the retry cap). Should
   * refetch the live row from the server and re-sync the cache to it — the last
   * resort where the server wins, and the losing edit is preserved as a
   * reviewable {@link ConflictRecord} rather than silently discarded.
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
/**
 * While true, {@link drainOutbox} is a no-op. Used by flows that must not race
 * the engine — e.g. the demo reset, which discards local edits and must prevent
 * a drain from pushing them to the server mid-reset.
 */
let drainSuspended = false;

export function setDrainSuspended(suspended: boolean): void {
  drainSuspended = suspended;
}

export async function drainOutbox(): Promise<DrainResult> {
  const queue = readOutbox();

  if (!isSyncConfigured() || drainSuspended) {
    return { skipped: true, uploaded: 0, failed: 0, conflicts: 0, remaining: queue.length };
  }

  let working = queue;
  const uploadedIds: string[] = [];
  const conflictedIds: string[] = [];
  let rebasedAny = false;
  let failed = 0;

  for (const change of queue) {
    // Retry policy: skip dead-lettered changes and ones still inside their
    // backoff window. They stay queued; the sync panel surfaces them.
    if (!isEligible(change)) continue;
    try {
      const outcome = await pushChangeToServer(change);
      if (outcome.status === "conflict") {
        // The row's version moved under us. Rather than immediately discarding
        // the user's edit (which reverts their change in the UI — e.g. an
        // emergency reconciliation snapping back to the anonymous record),
        // re-base it onto the server's CURRENT version and retry: the local
        // actor wins the common case. Capped at MAX_CONFLICT_RETRIES so a row a
        // second device keeps moving eventually converges on the server.
        const current = working.find((c) => c.id === change.id);
        let rebased = false;
        if ((current?.attempts ?? 0) < MAX_CONFLICT_RETRIES) {
          let serverVersion: number | null = null;
          try {
            serverVersion =
              (await syncHooks.resolveServerVersion?.(
                change.table,
                change.row_id,
              )) ?? null;
          } catch {
            /* fall through to give-up path */
          }
          if (typeof serverVersion === "number") {
            // Re-base the queued change + stamp the cache row's version (keeping
            // the local field values), then keep the change for another push.
            working = applyServerVersion(
              working,
              change.table,
              change.row_id,
              serverVersion,
            );
            working = markRebased(working, change.id);
            syncHooks.onVersionApplied?.(change.table, change.row_id, serverVersion);
            rebasedAny = true;
            rebased = true;
          }
        }
        if (!rebased) {
          // Give up after the retry cap: keep the losing edit as a reviewable
          // conflict record (Stage 2 — no silent loss), refetch the winning
          // state into the cache, then drop the stale change from the queue.
          conflictedIds.push(change.id);
          recordConflict(change);
          try {
            await syncHooks.onConflict?.(change.table, change.row_id);
          } catch {
            // Best-effort convergence; the stale change is dropped regardless.
          }
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
  // Re-read the LIVE queue and reconcile by id rather than overwriting with our
  // pre-drain snapshot: a mutation may have enqueued changes during the awaits
  // above, and clobbering them here is silent data loss (see
  // reconcileOutboxAfterDrain). Synchronous read→write, so nothing can slip in
  // between the reconcile and the persist.
  const reconciled = reconcileOutboxAfterDrain(readOutbox(), working, resolvedIds);
  // Fire the change event when the pending set shrank OR a change was re-based
  // (so the engine re-drains and the re-based retry actually pushes) OR a change
  // arrived mid-drain (so it gets a drain pass). A pass that only failed (e.g.
  // offline) with no new work must NOT wake the engine, or it would re-drain in
  // a tight loop while offline.
  const grewMidDrain = reconciled.length > working.length;
  writeOutbox(reconciled, {
    emit: resolvedIds.length > 0 || rebasedAny || grewMidDrain,
  });

  return {
    skipped: false,
    uploaded: uploadedIds.length,
    failed,
    conflicts: conflictedIds.length,
    remaining: reconciled.length,
  };
}
