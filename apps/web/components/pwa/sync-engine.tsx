"use client";

import { useEffect } from "react";

import { OUTBOX_EVENT, drainOutbox, pendingCount, setSyncHooks } from "@/services/syncQueue";
import {
  applyServerVersionToCache,
  upsertRowFromServer,
} from "@/services/mockStorage";
import { getSupabaseClient } from "@/lib/supabase/client";
import { drainPendingUploads } from "@/lib/supabase/upload-queue";
import { emitUsage } from "@/services/telemetry";

/**
 * How often the engine re-checks the queue while online (Stage 2). Failed
 * changes wait out their own exponential backoff (see syncQueue.isEligible);
 * this timer just guarantees a drain *happens* — previously a failure while
 * online would sit until the next enqueue or reload.
 */
const RETRY_INTERVAL_MS = 45_000;

/** Cross-tab mutex name — only one tab drains the shared outbox at a time. */
const DRAIN_LOCK = "careflow-outbox-drain";

/**
 * Headless engine that drains the outbox whenever there's a reason to: on
 * mount, when the network returns, when a change is enqueued, and on a periodic
 * retry timer (Stage 2). Renders nothing.
 *
 * Multi-tab (Stage 2): the drain runs under a Web Lock so two open tabs never
 * upload the same queue concurrently, and a `storage` listener lets this tab
 * react when another tab enqueues or drains changes. The in-flight guard also
 * collapses overlapping triggers within this tab.
 *
 * It also registers the optimistic-concurrency write-back hooks (Phase 19): on
 * a successful versioned write the cache row is stamped with the server's new
 * version, and on a stale-version conflict the losing row is refetched and the
 * cache re-synced to the winning state (the losing edit itself is preserved as
 * a reviewable conflict record — see syncQueue.recordConflict).
 */
export function SyncEngine() {
  useEffect(() => {
    let cancelled = false;
    let draining = false;

    setSyncHooks({
      onVersionApplied: (table, rowId, version) => {
        applyServerVersionToCache(table, rowId, version);
      },
      resolveServerVersion: async (table, rowId) => {
        // Read the server row's current version so a conflicting local edit can
        // be re-based onto it and retried (the local edit is preserved).
        const { data } = await getSupabaseClient()
          .from(table)
          .select("version")
          .eq("id", rowId)
          .maybeSingle();
        const v = (data as { version?: unknown } | null)?.version;
        return typeof v === "number" ? v : null;
      },
      onConflict: async (table, rowId) => {
        // Last resort (retry cap reached): refetch the winning row (RLS-scoped)
        // and overwrite the local copy so the losing device converges. A null
        // result means the row was deleted elsewhere; leave the cache as-is
        // rather than resurrecting a tombstone.
        const { data } = await getSupabaseClient()
          .from(table)
          .select("*")
          .eq("id", rowId)
          .maybeSingle();
        if (data && typeof (data as { id?: unknown }).id === "string") {
          upsertRowFromServer(table, data as { id: string });
        }
      },
    });

    const runDrain = () =>
      drainOutbox()
        .then((result) => {
          // Telemetry: a failed push is a strong connectivity/bug signal for the
          // owner console's "sync health" view. (Counts only — no row content.)
          if (result.failed > 0) {
            emitUsage("sync_failed", {
              failed: result.failed,
              remaining: result.remaining,
            });
          }
          return drainPendingUploads();
        })
        .catch(() => {
          // Drain failures are recorded per-change in the outbox and surfaced
          // in the sync health panel; nothing further to do here.
        });

    const drain = () => {
      if (draining || cancelled) return;
      draining = true;
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const run = locks
        ? // Cross-tab exclusive drain. `ifAvailable` skips when another tab is
          // already draining — that tab is uploading the same shared queue.
          locks.request(DRAIN_LOCK, { ifAvailable: true }, async (lock) => {
            if (lock) await runDrain();
          })
        : runDrain();
      void Promise.resolve(run).finally(() => {
        draining = false;
      });
    };

    if (!cancelled) drain();

    // Another tab touched the shared outbox: refresh this tab's chip/panel.
    // (Storage events only fire for writes made by OTHER tabs.)
    const onStorage = (event: StorageEvent) => {
      if (event.key === "careflow_outbox_v1") {
        window.dispatchEvent(new Event(OUTBOX_EVENT));
      }
    };

    // Periodic retry while online (backoff windows are enforced per-change).
    const timer = window.setInterval(() => {
      if (navigator.onLine && pendingCount() > 0) drain();
    }, RETRY_INTERVAL_MS);

    window.addEventListener("online", drain);
    window.addEventListener(OUTBOX_EVENT, drain);
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", drain);
      window.removeEventListener(OUTBOX_EVENT, drain);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
