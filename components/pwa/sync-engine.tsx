"use client";

import { useEffect } from "react";

import { OUTBOX_EVENT, drainOutbox, setSyncHooks } from "@/services/syncQueue";
import {
  applyServerVersionToCache,
  upsertRowFromServer,
} from "@/services/mockStorage";
import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Headless engine that drains the outbox whenever there's a reason to: on mount,
 * when the network returns, and whenever a new change is enqueued (Phase 18b
 * wired the Supabase seam, so this now actively uploads). Renders nothing.
 *
 * An in-flight guard collapses overlapping triggers into a single run so a drain
 * never overlaps itself (e.g. an `online` event landing mid-drain). Combined with
 * {@link drainOutbox} staying silent on failure-only passes, this keeps a failing
 * drain from busy-looping while offline.
 *
 * It also registers the optimistic-concurrency write-back hooks (Phase 19): on a
 * successful versioned write the cache row is stamped with the server's new
 * version, and on a stale-version conflict the losing row is refetched and the
 * cache re-synced to the winning state. These live here (not in syncQueue) to
 * avoid a syncQueue ↔ mockStorage import cycle.
 */
export function SyncEngine() {
  useEffect(() => {
    let cancelled = false;
    let draining = false;

    setSyncHooks({
      onVersionApplied: (table, rowId, version) => {
        applyServerVersionToCache(table, rowId, version);
      },
      onConflict: async (table, rowId) => {
        // Refetch the winning row (RLS-scoped) and overwrite the local copy so
        // the losing device converges. A null result means the row was deleted
        // elsewhere; leave the cache as-is rather than resurrecting a tombstone.
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

    const drain = () => {
      if (draining) return;
      draining = true;
      void drainOutbox()
        .catch(() => {
          // Drain failures are recorded per-change in the outbox for retry;
          // there is nothing actionable to surface from the engine itself.
        })
        .finally(() => {
          draining = false;
        });
    };

    if (!cancelled) drain();

    window.addEventListener("online", drain);
    window.addEventListener(OUTBOX_EVENT, drain);

    return () => {
      cancelled = true;
      window.removeEventListener("online", drain);
      window.removeEventListener(OUTBOX_EVENT, drain);
    };
  }, []);

  return null;
}
