"use client";

import { useEffect } from "react";

import { useAuth } from "@/components/auth-provider";
import { subscribeToRealtimeNotifications } from "@/services/notifications-client";
import { openVisitDrawer } from "@/services/visit-drawer";

/**
 * Headless: while a staff member is signed in, subscribe to their Supabase
 * Realtime notification stream so inserts from OTHER users' actions land in this
 * tab's cache live (and fire the bell). Re-subscribes when the identity changes;
 * tears the channel down on sign-out. Renders nothing.
 */
export function NotificationsRealtime() {
  const { currentStaff } = useAuth();
  const staffId = currentStaff?.id ?? null;

  useEffect(() => {
    if (!staffId) return;
    const unsubscribe = subscribeToRealtimeNotifications(staffId);
    return unsubscribe;
  }, [staffId]);

  // Route clicks on OS push notifications (delivered by the service worker as a
  // postMessage when a tab is already open) to the right place.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.type !== "careflow:notification-click") return;
      const data = msg.data ?? {};
      if (data.entity_type === "visit" && data.entity_id) {
        openVisitDrawer(data.entity_id);
      } else if (data.link) {
        window.location.assign(data.link);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
