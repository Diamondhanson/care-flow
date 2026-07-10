/**
 * Client-side notifications plumbing: the bell's reactive store, the Supabase
 * Realtime subscription that streams new notifications to an open tab, and Web
 * Push subscription management (PWA + browser).
 *
 * Producers live in {@link ./mockStorage} (queueNotifications) — the acting
 * client writes rows for other staff into the outbox, they sync to Supabase, and
 * Realtime delivers them here to the recipient. Browser-only; importing is
 * side-effect-free (no client is created until a function runs).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  NOTIFICATIONS_EVENT,
  getNotificationsForStaff,
  getUnreadNotificationCount,
  upsertRowFromServer,
} from "@/services/mockStorage";
import { OUTBOX_EVENT } from "@/services/syncQueue";
import type { Notification, StaffId } from "@careflow/shared";

// ---------------------------------------------------------------------------
// Reactive store (for useSyncExternalStore)
// ---------------------------------------------------------------------------

let version = 0;

/**
 * Subscribe to anything that can change this device's notifications: a local
 * mutation (OUTBOX_EVENT), a Realtime insert / read-state change
 * (NOTIFICATIONS_EVENT), and cross-tab writes (storage). Bumps a version
 * counter so getNotificationsVersion() returns a new value React can diff.
 */
export function subscribeNotifications(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    version += 1;
    onChange();
  };
  window.addEventListener(NOTIFICATIONS_EVENT, handler);
  window.addEventListener(OUTBOX_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(NOTIFICATIONS_EVENT, handler);
    window.removeEventListener(OUTBOX_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Monotonic version for useSyncExternalStore's getSnapshot. */
export function getNotificationsVersion(): number {
  return version;
}

// ---------------------------------------------------------------------------
// Realtime — stream inserts to the recipient's open tab
// ---------------------------------------------------------------------------

/**
 * Subscribe to this staff member's notification inserts. On each row: drop it
 * into the local cache (untracked, so it never re-enqueues) and fire
 * NOTIFICATIONS_EVENT so the bell re-reads. Returns an unsubscribe function.
 * No-op (returns a noop) when sync isn't configured.
 */
export function subscribeToRealtimeNotifications(staffId: StaffId): () => void {
  if (typeof window === "undefined") return () => {};
  let channel: RealtimeChannel;
  try {
    channel = getSupabaseClient()
      .channel(`notifications:${staffId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_staff_id=eq.${staffId}`,
        },
        (payload) => {
          const row = payload.new as Notification | undefined;
          if (!row || typeof row.id !== "string") return;
          upsertRowFromServer("notifications", row);
          window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
          // Foreground nicety: if the tab is hidden and OS push permission is
          // granted, surface it immediately via the SW rather than waiting on
          // the server-sent Web Push (which may lag or be undelivered locally).
          if (document.visibilityState === "hidden") {
            void showLocalNotification(row);
          }
        },
      )
      .subscribe();
  } catch {
    // Sync not configured (no Supabase env) — the bell still works locally.
    return () => {};
  }
  return () => {
    void getSupabaseClient().removeChannel(channel);
  };
}

/** Show a notification through the active service worker (best-effort). */
async function showLocalNotification(row: Notification): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") {
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(row.title, {
      body: row.body ?? undefined,
      tag: row.id,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: row.link, entity_type: row.entity_type, entity_id: row.entity_id },
    });
  } catch {
    /* notifications are best-effort */
  }
}

// ---------------------------------------------------------------------------
// Convenience reads (re-exported so the bell imports from one module)
// ---------------------------------------------------------------------------

export function readNotifications(staffId: StaffId): Notification[] {
  return getNotificationsForStaff(staffId);
}

export function readUnreadCount(staffId: StaffId): number {
  return getUnreadNotificationCount(staffId);
}

// ---------------------------------------------------------------------------
// Web Push subscription management
// ---------------------------------------------------------------------------

/** Whether this browser can do Web Push at all (SW + Push API + Notification). */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current OS notification permission, or "unsupported". */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** Base64url VAPID public key → Uint8Array for PushManager.subscribe. Backed by
 *  a concrete ArrayBuffer so it satisfies the BufferSource key type. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

interface EnablePushArgs {
  staffId: StaffId;
  hospitalId: string;
}

/**
 * Ask for OS permission (if not already decided), subscribe this device to Web
 * Push, and persist the subscription to Supabase so the send-push Edge Function
 * can reach it. Returns the granted permission. Requires
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY at build time.
 */
export async function enablePush(
  args: EnablePushArgs,
): Promise<NotificationPermission | "unsupported"> {
  if (!isPushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn("enablePush: NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — skipping.");
    return permission;
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) return permission;

  // Upsert on the unique endpoint so re-enabling never accumulates stale rows.
  const { error } = await getSupabaseClient()
    .from("push_subscriptions")
    .upsert(
      {
        hospital_id: args.hospitalId,
        staff_id: args.staffId,
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" },
    );
  if (error) console.warn("enablePush: failed to store subscription", error.message);
  return permission;
}

/** Unsubscribe this device from Web Push and drop its row. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  try {
    await getSupabaseClient()
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);
  } catch {
    /* best-effort cleanup */
  }
}
