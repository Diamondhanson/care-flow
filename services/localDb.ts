/**
 * localDb — the on-device database (Stage 3 storage engine).
 *
 * A minimal promise wrapper around IndexedDB. Replaces the old single
 * localStorage blob (5–10MB hard quota, whole-DB rewrite on every save) with
 * per-row object stores: gigabyte-scale capacity, async writes off the main
 * thread's critical path, and saves that touch only the rows that changed.
 *
 * One object store per Postgres table name, keyed by row `id`, plus a `meta`
 * store for the schema version and other bookkeeping. Browser-only; every
 * function is a safe no-op / empty result on the server.
 */

const DB_NAME = "careflow";

/**
 * Bump when object stores are added/removed. Store creation happens in
 * `onupgradeneeded`; field-level data migrations run separately in
 * `services/mockStorage` (see CACHE_SCHEMA_VERSION there).
 */
const DB_VERSION = 1;

/** Postgres-named stores are created lazily from this list at open time. */
let expectedStores: readonly string[] = [];

const META_STORE = "meta";

/** Files captured offline, waiting to upload to Supabase Storage (Stage 4). */
export const PENDING_UPLOADS_STORE = "pending_uploads";

/** Stores that always exist regardless of the declared table list. */
const BUILTIN_STORES = [META_STORE, PENDING_UPLOADS_STORE];

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [...expectedStores, ...BUILTIN_STORES]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: store === META_STORE ? "key" : "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
  return dbPromise;
}

/**
 * Declare the set of table stores and open the database. Must be called once
 * (with the full table list) before any read/write. If a store is missing from
 * an already-open database (a new table shipped), the connection is reopened at
 * a bumped version so `onupgradeneeded` can create it.
 */
export async function initStores(tables: readonly string[]): Promise<void> {
  if (!isBrowser()) return;
  expectedStores = tables;
  let db = await openDb();
  const missing = [...tables, ...BUILTIN_STORES].filter(
    (t) => !db.objectStoreNames.contains(t),
  );
  if (missing.length > 0) {
    const nextVersion = db.version + 1;
    db.close();
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, nextVersion);
      request.onupgradeneeded = () => {
        const upgraded = request.result;
        for (const store of [...tables, ...BUILTIN_STORES]) {
          if (!upgraded.objectStoreNames.contains(store)) {
            upgraded.createObjectStore(store, {
              keyPath: store === META_STORE ? "key" : "id",
            });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("indexedDB upgrade failed"));
    });
    db = await dbPromise;
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB tx aborted"));
  });
}

/** All rows of one table store. */
export async function getAllRows(table: string): Promise<unknown[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const tx = db.transaction(table, "readonly");
  const store = tx.objectStore(table);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error ?? new Error("getAll failed"));
  });
}

/** Batched row writes/deletes across tables, in one transaction per call. */
export interface RowWrite {
  table: string;
  put?: readonly { id: string }[];
  remove?: readonly string[];
}

export async function writeRows(writes: readonly RowWrite[]): Promise<void> {
  if (!isBrowser() || writes.length === 0) return;
  const tables = [...new Set(writes.map((w) => w.table))];
  const db = await openDb();
  const tx = db.transaction(tables, "readwrite");
  for (const write of writes) {
    const store = tx.objectStore(write.table);
    for (const row of write.put ?? []) store.put(row);
    for (const id of write.remove ?? []) store.delete(id);
  }
  await txDone(tx);
}

/** Replace one table's contents wholesale (hydration). */
export async function replaceTable(
  table: string,
  rows: readonly { id: string }[],
): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(table, "readwrite");
  const store = tx.objectStore(table);
  store.clear();
  for (const row of rows) store.put(row);
  await txDone(tx);
}

/** Read a meta value (schema version, flags). */
export async function getMeta(key: string): Promise<unknown> {
  if (!isBrowser()) return undefined;
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const request = tx.objectStore(META_STORE).get(key);
    request.onsuccess = () =>
      resolve((request.result as { value?: unknown } | undefined)?.value);
    request.onerror = () => reject(request.error ?? new Error("meta get failed"));
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put({ key, value });
  await txDone(tx);
}

/** Empty every table store (sign-out wipe). Meta survives. */
export async function clearAllTables(): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const stores = [...db.objectStoreNames].filter((s) => s !== META_STORE);
  if (stores.length === 0) return;
  const tx = db.transaction(stores, "readwrite");
  for (const store of stores) tx.objectStore(store).clear();
  await txDone(tx);
}
