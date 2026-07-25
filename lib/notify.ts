/**
 * App-wide notification bus (Stage 1 visibility work).
 *
 * Non-React modules (the storage layer, the sync queue) need a way to tell the
 * user something went right or wrong. They call {@link notify} with **i18n keys**
 * — never prebuilt strings — and the `<Toaster />` in the root layout translates
 * at render time in the active locale. Kept free of React and of any service
 * imports so `mockStorage`/`syncQueue` can depend on it without cycles.
 */

import type { MessageKey } from "@/i18n";
export type NotifyKind = "success" | "error" | "warning" | "info";

export interface AppNotification {
  id: string;
  kind: NotifyKind;
  /** i18n key for the headline, e.g. "notify.storageFullTitle". */
  titleKey: MessageKey;
  /** Optional i18n key for the supporting line. */
  bodyKey?: MessageKey;
  /** Interpolation params passed through to `t()`. */
  params?: Record<string, string | number>;
  /** Auto-dismiss delay in ms; defaults per kind in the Toaster. */
  duration?: number;
}

export const NOTIFY_EVENT = "careflow:notify";

/**
 * Repeat-suppression: a failing storage layer can hit the same error on every
 * read/write in a render pass. When `dedupeKey` is given, further notifications
 * with the same key are dropped for `dedupeMs` (default 30s).
 */
const recentByKey = new Map<string, number>();

export interface NotifyOptions {
  dedupeKey?: string;
  dedupeMs?: number;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fire a notification. Safe to call anywhere — a no-op outside the browser. */
export function notify(
  input: Omit<AppNotification, "id">,
  opts: NotifyOptions = {},
): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  if (opts.dedupeKey) {
    const last = recentByKey.get(opts.dedupeKey) ?? 0;
    const windowMs = opts.dedupeMs ?? 30_000;
    if (Date.now() - last < windowMs) return;
    recentByKey.set(opts.dedupeKey, Date.now());
  }
  const detail: AppNotification = { id: generateId(), ...input };
  window.dispatchEvent(new CustomEvent<AppNotification>(NOTIFY_EVENT, { detail }));
}
