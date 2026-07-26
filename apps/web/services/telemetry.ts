/**
 * Usage telemetry emitter (Phase 19.1) — the hospital app's write side of the
 * platform-owner telemetry pipeline.
 *
 * Design (locked decisions):
 *  - **Metadata, not PHI.** `UsageMetadata` is restricted to primitive values —
 *    counts, flags, a feature/record-kind name. NEVER patient content.
 *  - **Separate from the clinical sync outbox.** A small in-memory buffer that
 *    flushes fire-and-forget straight to `usage_events`. It never blocks, never
 *    throws into the caller, and never re-queues on failure (telemetry is
 *    best-effort and must never affect clinical UX or grow unbounded).
 *  - **Write-only.** RLS lets staff INSERT events for their own hospital and
 *    read nothing back; the owner console reads cross-tenant via the service role.
 *
 * Browser-only: guarded so importing it in node tests / RSC is a safe no-op.
 */

import type { UsageEventType } from "@careflow/shared";

import { getSupabaseClient } from "@/lib/supabase/client";

export type { UsageEventType };

/** Primitive-only payload — the telemetry-not-PHI guardrail at the type level. */
export type UsageMetadata = Record<string, string | number | boolean>;

interface TelemetryContext {
  hospitalId: string;
  staffId: string | null;
}

interface PendingEvent {
  event_type: UsageEventType;
  actor_staff_id: string | null;
  metadata: UsageMetadata;
}

let context: TelemetryContext | null = null;
let buffer: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

const FLUSH_DELAY_MS = 5000;
const MAX_BUFFER = 25;

/** Bind the active tenant + actor so emitted events carry hospital_id / staff.
 *  Called by the auth layer once a staff identity resolves. */
export function setTelemetryContext(hospitalId: string, staffId: string | null): void {
  context = { hospitalId, staffId };
  bindFlushListeners();
}

/** Drop the context (sign-out) and discard anything buffered for the old tenant. */
export function clearTelemetryContext(): void {
  context = null;
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Record a usage event (metadata-only, fire-and-forget). No-op when not signed
 * in or on the server. Never throws — telemetry must never affect clinical UX.
 */
export function emitUsage(
  eventType: UsageEventType,
  metadata: UsageMetadata = {},
): void {
  if (typeof window === "undefined" || !context) return;
  buffer.push({
    event_type: eventType,
    actor_staff_id: context.staffId,
    metadata,
  });
  if (buffer.length >= MAX_BUFFER) {
    void flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!context || buffer.length === 0) return;
  const hospitalId = context.hospitalId;
  const rows = buffer.map((e) => ({
    hospital_id: hospitalId,
    event_type: e.event_type,
    actor_staff_id: e.actor_staff_id,
    metadata: e.metadata,
  }));
  buffer = []; // drop on attempt — best-effort, never re-queue
  try {
    // Returns `{ error }` (does not throw) on RLS/validation; we ignore it. The
    // table may also not exist yet on a DB where the schema hasn't been applied.
    await getSupabaseClient().from("usage_events").insert(rows);
  } catch {
    /* swallow network errors — telemetry is best-effort */
  }
}

/** Flush on tab hide so short sessions still report. Bound once, lazily. */
function bindFlushListeners(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
