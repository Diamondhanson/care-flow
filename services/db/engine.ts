/**
 * The storage engine (Stage 3): in-memory authoritative copy + IndexedDB
 * mirror, cross-tab broadcast, cache events, the outbox integration point
 * (`persist`), the Supabase hydration / sync write-back entry points, and
 * store initialization. Domain modules read via {@link readDb} (through
 * tenancy's `loadScoped`) and write via {@link loadDatabase} + {@link persist}.
 *
 * NOTE: `engine` and `seed` form a deliberate, safe module cycle — `readDb`
 * falls back to `seedDatabaseObject()` and seed's `resetDatabase` calls
 * `persist`. Both references are only dereferenced at function-call time,
 * never during module evaluation, which ESM resolves correctly.
 */

import { enqueueChanges, hasPendingChange, type NewChange } from "@/services/syncQueue";
import * as localDb from "@/services/localDb";
import { notify } from "@/lib/notify";
import {
  COLLECTION_TO_TABLE,
  DB_COLLECTIONS,
  SUPABASE_TABLES,
  TABLE_TO_COLLECTION,
  isBrowser,
  normalizeDatabase,
  diffDatabases,
  type Database,
  type Identified,
} from "./shared";
import { seedDatabaseObject } from "./seed";

// The legacy pre-Stage-3 store: the whole database as ONE localStorage blob.
// Kept only so an existing device's data migrates into IndexedDB on first run
// (see initLocalStore), after which the blob is removed.
const LEGACY_STORAGE_KEY = "careflow_db_v8";

// ---------------------------------------------------------------------------
// Storage engine (Stage 3): in-memory authoritative copy + IndexedDB.
//
// The in-memory `Database` is the single source of truth for this tab. Reads
// filter it directly (no per-read JSON.parse of a giant blob any more), writes
// clone → mutate → swap it, and only the rows that actually changed are written
// to IndexedDB asynchronously — replacing the old localStorage blob whose
// 5–10MB quota and whole-DB rewrite-per-save were the app's hard scaling
// ceiling. Cross-tab coherence flows over a BroadcastChannel, and every change
// emits CACHE_EVENT so screens can re-render live (see lib/use-cache.ts).
// ---------------------------------------------------------------------------

let memoryDb: Database | null = null;

/** Window event fired after every cache change (local write, sync, other tab). */
export const CACHE_EVENT = "careflow:cache";

const DB_BROADCAST_CHANNEL = "careflow-db";
let channel: BroadcastChannel | null = null;

type BroadcastMessage =
  | {
      type: "rows";
      changes: { table: string; op: ChangeOpLite; row_id: string; payload: Record<string, unknown> }[];
    }
  | { type: "replace" };

type ChangeOpLite = "insert" | "update" | "delete";

function emitCacheChanged(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(CACHE_EVENT));
  }
}

/** Subscribe to cache changes (returns an unsubscribe). SSR-safe no-op. */
export function subscribeCache(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  window.addEventListener(CACHE_EVENT, listener);
  return () => window.removeEventListener(CACHE_EVENT, listener);
}

/** Parse the legacy single-blob store, if this device still has one. */
function readLegacyBlob(): Database | null {
  if (!isBrowser()) return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeDatabase(JSON.parse(raw) as Partial<Database>);
  } catch {
    notify(
      {
        kind: "warning",
        titleKey: "notify.cacheResetTitle",
        bodyKey: "notify.cacheResetBody",
      },
      { dedupeKey: "db-cache-reset" },
    );
    return null;
  }
}

function removeLegacyBlob(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * The current database (shared reference — read-only by convention). Callers
 * that mutate must go through {@link loadDatabase} + {@link persist}. On the
 * server a fresh seed is returned so SSR renders consistent data.
 */
export function readDb(): Database {
  if (!isBrowser()) {
    return seedDatabaseObject();
  }
  if (!memoryDb) {
    // Synchronous access before initLocalStore resolves (or when IndexedDB is
    // unavailable, e.g. unit tests): adopt the legacy blob or a fresh seed.
    memoryDb = readLegacyBlob() ?? seedDatabaseObject();
  }
  return memoryDb;
}

/**
 * A mutable snapshot of the database for mutators: clone → mutate → persist.
 * (structuredClone is native and far cheaper than the old parse-of-blob.)
 */
export function loadDatabase(): Database {
  if (!isBrowser()) {
    return seedDatabaseObject();
  }
  return structuredClone(readDb());
}

/**
 * Commit a mutated snapshot as the new authoritative database. The single
 * integration point for the outbox and the on-device store:
 *
 *  1. Diff the snapshot against the current in-memory state (row-level).
 *  2. Tracked persists (the default — every user mutation) enqueue one outbox
 *     change per affected row; seeding/hydration/sync write-backs pass
 *     `{ track: false }`.
 *  3. Swap the snapshot in as the new in-memory database.
 *  4. Write only the CHANGED rows to IndexedDB (async — off the render path),
 *     broadcast them to other open tabs, and emit {@link CACHE_EVENT} so
 *     screens re-render.
 *
 * On the server this is a no-op, leaving the node test path untouched.
 */
export function persist(db: Database, opts: { track?: boolean } = {}): void {
  if (!isBrowser()) return;

  const track = opts.track ?? true;
  const baseline = memoryDb;
  const changes = baseline ? diffDatabases(baseline, db) : [];

  if (track && changes.length > 0) enqueueChanges(changes);

  memoryDb = db;

  if (baseline === null || changes.length > 0) {
    if (baseline === null) {
      // First write of this tab's lifetime with no baseline to diff against —
      // mirror the whole snapshot to disk.
      void writeAllToDisk(db);
    } else {
      void writeChangesToDisk(changes);
    }
    broadcastChanges(changes);
  }
  emitCacheChanged();
}

/** Mirror row-level changes into IndexedDB (async; failures surfaced once). */
async function writeChangesToDisk(changes: readonly NewChange[]): Promise<void> {
  if (typeof indexedDB === "undefined" || changes.length === 0) return;
  const byTable = new Map<string, { put: { id: string }[]; remove: string[] }>();
  for (const change of changes) {
    const entry = byTable.get(change.table) ?? { put: [], remove: [] };
    if (change.op === "delete") entry.remove.push(change.row_id);
    else entry.put.push(change.payload as { id: string });
    byTable.set(change.table, entry);
  }
  try {
    await localDb.writeRows(
      [...byTable.entries()].map(([table, ops]) => ({
        table,
        put: ops.put,
        remove: ops.remove,
      })),
    );
  } catch {
    notifyDiskWriteFailed();
  }
}

/** Mirror the entire database into IndexedDB (first run / hydration). */
async function writeAllToDisk(db: Database): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await localDb.initStores(SUPABASE_TABLES);
    await Promise.all(
      DB_COLLECTIONS.map((collection) =>
        localDb.replaceTable(
          COLLECTION_TO_TABLE[collection],
          db[collection] as unknown as { id: string }[],
        ),
      ),
    );
  } catch {
    notifyDiskWriteFailed();
  }
}

function notifyDiskWriteFailed(): void {
  notify(
    {
      kind: "error",
      titleKey: "notify.storageWriteFailedTitle",
      bodyKey: "notify.storageWriteFailedBody",
    },
    { dedupeKey: "db-write-failed" },
  );
}

/** Push row changes to other open tabs so their in-memory copies converge. */
function broadcastChanges(changes: readonly NewChange[]): void {
  if (typeof BroadcastChannel === "undefined" || changes.length === 0) return;
  try {
    channel ??= new BroadcastChannel(DB_BROADCAST_CHANNEL);
    const message: BroadcastMessage = {
      type: "rows",
      changes: changes.map((c) => ({
        table: c.table,
        op: c.op,
        row_id: c.row_id,
        payload: c.payload,
      })),
    };
    channel.postMessage(message);
  } catch {
    /* cross-tab convergence is best-effort; IndexedDB reload covers restarts */
  }
}

/** Apply row changes announced by another tab (no re-broadcast, no disk write). */
function applyBroadcast(message: BroadcastMessage): void {
  if (!memoryDb) return;
  if (message.type === "replace") {
    void reloadFromDisk();
    return;
  }
  const db = memoryDb;
  for (const change of message.changes) {
    const collection = TABLE_TO_COLLECTION[change.table];
    if (!collection) continue;
    const rows = db[collection] as unknown as Identified[];
    if (change.op === "delete") {
      (db[collection] as unknown as Identified[]) = rows.filter(
        (r) => r.id !== change.row_id,
      );
    } else {
      const idx = rows.findIndex((r) => r.id === change.row_id);
      const row = { ...change.payload, id: change.row_id } as Identified;
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    }
  }
  emitCacheChanged();
}

/** Re-read the whole database from IndexedDB into memory (cross-tab replace). */
async function reloadFromDisk(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = normalizeDatabase({});
    await Promise.all(
      DB_COLLECTIONS.map(async (collection) => {
        const rows = await localDb.getAllRows(COLLECTION_TO_TABLE[collection]);
        (db[collection] as unknown[]) = rows;
      }),
    );
    memoryDb = db;
    emitCacheChanged();
  } catch {
    /* keep the current in-memory copy */
  }
}

/**
 * Replace the entire local cache with rows fetched from Supabase (Phase 18b
 * hydration). Each Postgres table is mapped back onto its in-memory collection;
 * unknown/missing tables default to `[]`. Untracked, so hydration never floods
 * the outbox; other tabs are told to reload from disk once the mirror lands.
 */
export function replaceDatabaseFromTables(
  byTable: Partial<Record<string, unknown[]>>,
): void {
  const db = normalizeDatabase({});
  for (const collection of DB_COLLECTIONS) {
    const rows = byTable[COLLECTION_TO_TABLE[collection]];
    if (Array.isArray(rows)) {
      (db[collection] as unknown[]) = rows;
    }
  }
  if (!isBrowser()) return;
  memoryDb = db;
  void writeAllToDisk(db).then(() => {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      channel ??= new BroadcastChannel(DB_BROADCAST_CHANNEL);
      channel.postMessage({ type: "replace" } satisfies BroadcastMessage);
    } catch {
      /* best-effort */
    }
  });
  emitCacheChanged();
}

/**
 * Stamp the server-authoritative `version` onto a single cached row after a
 * successful sync (Phase 19 optimistic concurrency). The local row already holds
 * the new field values — only its version was unknown until the server bumped it
 * — so we patch just `version` and leave everything else intact. Untracked: a
 * version write-back must never re-enqueue the row it just confirmed. Returns
 * true when a matching row was found and updated.
 */
export function applyServerVersionToCache(
  table: string,
  id: string,
  version: number,
): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as (Identified & { version?: number })[];
  const row = rows.find((r) => r.id === id);
  if (!row || row.version === version) return false;
  row.version = version;
  persist(db, { track: false });
  return true;
}

/**
 * Replace (or insert) a single cached row with the server's authoritative copy
 * (Phase 19 conflict resolution). When a write is rejected because it targeted a
 * stale version, the sync layer refetches the live row and calls this to re-sync
 * the cache to the winning state. Untracked so the refresh never re-enqueues.
 * Returns true when the row landed in a known collection.
 */
export function upsertRowFromServer(table: string, row: Identified): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as Identified[];
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    rows[idx] = row;
  } else {
    rows.push(row);
  }
  persist(db, { track: false });
  return true;
}

/**
 * Re-apply still-pending outbox changes on top of the cache (Stage 2 fix).
 * Hydration replaces the cache with the server snapshot — but changes made
 * offline that haven't drained yet are NOT in that snapshot, so without this
 * step the screen would visually revert the user's own recent edits (they were
 * still queued and would re-sync later, but the user would see them vanish).
 * Untracked: these changes are already queued; re-applying must not re-enqueue.
 */
export function applyPendingChangesToCache(
  changes: readonly {
    table: string;
    op: "insert" | "update" | "delete";
    row_id: string;
    payload: Record<string, unknown>;
  }[],
): void {
  if (!isBrowser() || changes.length === 0) return;
  const db = loadDatabase();
  let touched = false;
  for (const change of changes) {
    const collection = TABLE_TO_COLLECTION[change.table];
    if (!collection) continue;
    const rows = db[collection] as unknown as Identified[];
    if (change.op === "delete") {
      const next = rows.filter((r) => r.id !== change.row_id);
      if (next.length !== rows.length) {
        (db[collection] as unknown as Identified[]) = next;
        touched = true;
      }
      continue;
    }
    const idx = rows.findIndex((r) => r.id === change.row_id);
    const row = { ...change.payload, id: change.row_id } as Identified;
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
    touched = true;
  }
  if (touched) persist(db, { track: false });
}

/**
 * Re-apply a conflict-losing edit on top of the current (server-winning) row —
 * the "re-apply my change" action in the sync panel (Stage 2). Merges the
 * losing payload's fields over the live row, except `version`, so the tracked
 * persist enqueues a fresh update guarded on the *current* base version.
 */
export function applyConflictPayload(
  table: string,
  rowId: string,
  payload: Record<string, unknown>,
): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as (Identified & { version?: number })[];
  const idx = rows.findIndex((r) => r.id === rowId);
  const { version: _ignored, ...fields } = payload;
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...fields, id: rowId };
  } else {
    // The winning state was a delete; re-applying recreates the row.
    rows.push({ ...fields, id: rowId } as Identified);
  }
  persist(db);
  return true;
}

/**
 * Merge server rows into the cache without replacing it (Stage 4 on-demand
 * history / realtime). Upserts every row by id — EXCEPT rows that currently
 * have a pending (unsynced) local edit in the outbox, which are left untouched
 * so a server echo can't visually revert the user's own recent work; the
 * version guard reconciles those on the next drain. Untracked.
 */
export function mergeRowsFromServer(
  byTable: Partial<Record<string, unknown[]>>,
): void {
  if (!isBrowser()) return;
  const db = loadDatabase();
  let touched = false;
  for (const [table, rows] of Object.entries(byTable)) {
    const collection = TABLE_TO_COLLECTION[table];
    if (!collection || !Array.isArray(rows)) continue;
    const existing = db[collection] as unknown as Identified[];
    for (const raw of rows) {
      const row = raw as Identified;
      if (!row || typeof row.id !== "string") continue;
      if (hasPendingChange(table, row.id)) continue;
      const idx = existing.findIndex((r) => r.id === row.id);
      if (idx >= 0) existing[idx] = row;
      else existing.push(row);
      touched = true;
    }
  }
  if (touched) persist(db, { track: false });
}

/**
 * Remove a single cached row because the server deleted it (Stage 4 realtime).
 * Skipped when the row has a pending local edit — the next drain resolves the
 * disagreement through the normal conflict machinery. Untracked.
 */
export function removeRowFromServer(table: string, id: string): boolean {
  const collection = TABLE_TO_COLLECTION[table];
  if (!collection || hasPendingChange(table, id)) return false;
  const db = loadDatabase();
  const rows = db[collection] as unknown as Identified[];
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  (db[collection] as unknown as Identified[]) = next;
  persist(db, { track: false });
  return true;
}

/**
 * Drop the local cache so the next reader starts clean (Phase 18b sign-out;
 * Stage 3 privacy wipe). Clears the in-memory copy, the legacy blob, AND the
 * IndexedDB mirror — patient data must not linger on a shared workstation.
 * Leaves the outbox alone — the sign-out flow decides what to do with pending
 * changes (see auth-provider). The next login re-hydrates from Supabase.
 */
export function clearLocalCache(): void {
  if (!isBrowser()) return;
  memoryDb = null;
  removeLegacyBlob();
  if (typeof indexedDB !== "undefined") {
    void localDb.clearAllTables().catch(() => {
      /* best-effort wipe; the next hydrate overwrites regardless */
    });
  }
  emitCacheChanged();
}

// ---------------------------------------------------------------------------
// Store initialization (Stage 3) — load the IndexedDB mirror into memory once
// per tab, migrating the legacy localStorage blob (and running any pending
// field-level cache migrations) on the way. The AuthProvider awaits this before
// resolving a session, so screens never read a half-initialized store.
// ---------------------------------------------------------------------------

/**
 * Bump when cached row shapes change between app versions, and add a matching
 * entry to {@link CACHE_MIGRATIONS}. Old behavior was wipe-and-reseed; with the
 * app now offline-first, on-device data is upgraded in place instead.
 */
const CACHE_SCHEMA_VERSION = 1;

interface CacheMigration {
  /** The version this migration upgrades the cache TO. */
  to: number;
  run: (db: Database) => Database;
}

/** Ordered, append-only list of cache upgrades. (None needed yet at v1.) */
const CACHE_MIGRATIONS: CacheMigration[] = [];

let initPromise: Promise<void> | null = null;

/**
 * Initialize the on-device store: open IndexedDB, run pending migrations, and
 * load everything into memory. Idempotent — concurrent callers share one run.
 * Where IndexedDB is unavailable (server, unit tests) it resolves immediately
 * and the engine stays memory-only (seed or legacy blob).
 */
export function initLocalStore(): Promise<void> {
  if (!isBrowser() || typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await localDb.initStores(SUPABASE_TABLES);

    // Load the disk mirror.
    const db = normalizeDatabase({});
    let hasAny = false;
    await Promise.all(
      DB_COLLECTIONS.map(async (collection) => {
        const rows = await localDb.getAllRows(COLLECTION_TO_TABLE[collection]);
        if (rows.length > 0) {
          (db[collection] as unknown[]) = rows;
          hasAny = true;
        }
      }),
    );

    if (hasAny) {
      // Run any pending field-level migrations on the loaded data.
      const stored = ((await localDb.getMeta("schemaVersion")) as number) || 1;
      let migrated = db;
      let version = stored;
      for (const migration of CACHE_MIGRATIONS) {
        if (migration.to > version) {
          migrated = migration.run(migrated);
          version = migration.to;
        }
      }
      memoryDb = migrated;
      if (version !== stored) {
        await writeAllToDisk(migrated);
        await localDb.setMeta("schemaVersion", version);
      }
    } else {
      // First run on this device: adopt the legacy localStorage blob if one
      // exists (pre-Stage-3 install), else whatever pre-init access seeded,
      // else a fresh seed — then mirror it to disk.
      memoryDb = readLegacyBlob() ?? memoryDb ?? seedDatabaseObject();
      await writeAllToDisk(memoryDb);
      await localDb.setMeta("schemaVersion", CACHE_SCHEMA_VERSION);
    }
    removeLegacyBlob();

    // Cross-tab convergence: apply row changes other tabs broadcast.
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel ??= new BroadcastChannel(DB_BROADCAST_CHANNEL);
        channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
          if (event.data && typeof event.data === "object") {
            applyBroadcast(event.data);
          }
        };
      } catch {
        /* cross-tab sync is best-effort */
      }
    }
    emitCacheChanged();
  })();
  return initPromise;
}
