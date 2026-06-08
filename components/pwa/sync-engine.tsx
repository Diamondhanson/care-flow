"use client";

import { useEffect } from "react";

import { OUTBOX_EVENT, drainOutbox } from "@/services/syncQueue";

/**
 * Headless engine that drains the outbox whenever there's a reason to: on mount,
 * when the network returns, and whenever a new change is enqueued (Phase 18b
 * wired the Supabase seam, so this now actively uploads). Renders nothing.
 *
 * An in-flight guard collapses overlapping triggers into a single run so a drain
 * never overlaps itself (e.g. an `online` event landing mid-drain). Combined with
 * {@link drainOutbox} staying silent on failure-only passes, this keeps a failing
 * drain from busy-looping while offline.
 */
export function SyncEngine() {
  useEffect(() => {
    let cancelled = false;
    let draining = false;

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
