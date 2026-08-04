/**
 * Hospital-wide per-event notification toggles (admin-set on /settings).
 *
 * `hospital_settings.notification_prefs` is a jsonb map of client event type →
 * `false` to silence it; a missing key means enabled. The gate lives at the
 * PRODUCER (`queueNotifications`): a silenced type writes no row, so the bell,
 * Realtime and Web Push all go quiet together for every recipient.
 *
 * `queueNotifications` is synchronous, so the map is held in a module cache:
 * refreshed from Supabase whenever a staff identity mounts (see
 * NotificationsRealtime) and after the admin saves settings, and persisted to
 * localStorage so offline sessions keep the last-known rules. Unknown state
 * fails OPEN (everything enabled) — losing a mute beats losing an alert.
 */

import { getSupabaseClient } from "@/lib/supabase/client";

export type NotificationPrefs = Record<string, boolean>;

const STORAGE_KEY = "careflow.notification-prefs";

let cache: NotificationPrefs | null = null;

function readStorage(): NotificationPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as NotificationPrefs) : {};
  } catch {
    return {};
  }
}

function writeStorage(prefs: NotificationPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full/blocked — the module cache still applies for this session.
  }
}

/** Whether a client event type should generate notifications right now. */
export function isNotificationTypeEnabled(type: string): boolean {
  if (cache === null) cache = readStorage();
  return cache[type] !== false;
}

/** Overwrite the cache (used by the settings screen after a save). */
export function setNotificationPrefs(prefs: NotificationPrefs): void {
  cache = prefs;
  writeStorage(prefs);
}

/**
 * Pull the hospital's current prefs from Supabase into the cache. Best-effort:
 * offline or failing, the last-known (or all-enabled) rules stay in force.
 */
export async function refreshNotificationPrefs(): Promise<void> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("hospital_settings")
      .select("notification_prefs")
      .maybeSingle();
    if (error) return;
    setNotificationPrefs(
      (data?.notification_prefs ?? {}) as NotificationPrefs,
    );
  } catch {
    // Keep whatever we had.
  }
}
