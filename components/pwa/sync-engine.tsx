"use client";

import { useEffect } from "react";

import { OUTBOX_EVENT, drainOutbox } from "@/services/syncQueue";

/**
 * Headless engine that drains the outbox whenever there's a reason to: on mount,
 * when the network returns, and whenever a new change is enqueued. Today
 * {@link drainOutbox} is a safe no-op (the sync seam is unconfigured), so this
 * simply exists so that the queue starts uploading automatically the day the
 * Supabase seam is implemented — no further wiring required. Renders nothing.
 */
export function SyncEngine() {
  useEffect(() => {
    let cancelled = false;

    const drain = () => {
      void drainOutbox().catch(() => {
        // Drain failures are recorded per-change in the outbox for retry; there
        // is nothing actionable to surface from the engine itself.
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
