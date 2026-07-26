"use client";

/**
 * useCacheVersion — re-render on any local-store change (Stage 3).
 *
 * The storage engine emits CACHE_EVENT after every change: a local mutation, a
 * background sync write-back, a realtime/peer update, or another tab's edit.
 * This hook subscribes via useSyncExternalStore and returns a monotonically
 * increasing number; put it in a data-loading effect's dependency list (or read
 * store data keyed on it) and the screen stays live instead of stale:
 *
 *   const cacheVersion = useCacheVersion();
 *   useEffect(() => { setRows(getActiveVisits()); }, [cacheVersion]);
 *
 * The server snapshot is always 0 — the value is only meaningful as a change
 * signal, never as rendered content.
 */

import { useSyncExternalStore } from "react";

import { subscribeCache } from "@/services/mockStorage";

let version = 0;
const subscribers = new Set<() => void>();
let engineSubscribed = false;

function ensureEngineSubscription(): void {
  if (engineSubscribed) return;
  engineSubscribed = true;
  subscribeCache(() => {
    version += 1;
    for (const notifySubscriber of subscribers) notifySubscriber();
  });
}

function subscribe(onStoreChange: () => void): () => void {
  ensureEngineSubscription();
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

export function useCacheVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}
