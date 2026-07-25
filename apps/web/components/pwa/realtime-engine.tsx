"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  mergeRowsFromServer,
  removeRowFromServer,
  SUPABASE_TABLES,
} from "@/services/mockStorage";
import { hydrateFromSupabase } from "@/services/supabaseData";

/**
 * RealtimeEngine (Stage 4) — live collaboration between colleagues.
 *
 * Subscribes to Postgres change events for every mirrored table, filtered to
 * the signed-in hospital. When a colleague saves a consultation, moves a
 * patient, or frees a bed, the row streams into this device's cache within
 * seconds and every open screen re-renders (CACHE_EVENT via the storage
 * engine). Before this, another user's changes were invisible until re-login.
 *
 * Safeguards:
 *  - Rows with pending local (unsynced) edits are never overwritten by an
 *    incoming event — the version-guarded drain reconciles them instead.
 *  - After a dropped connection resubscribes, one windowed re-hydration runs to
 *    backfill whatever events were missed while offline.
 *
 * Renders nothing. Mounted inside the authenticated app layout.
 */
export function RealtimeEngine() {
  const { currentHospital } = useAuth();
  const hospitalId = currentHospital?.id ?? null;
  const hadDropRef = useRef(false);

  useEffect(() => {
    if (!hospitalId || !isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();
    let channel = supabase.channel(`db-changes-${hospitalId}`);

    for (const table of SUPABASE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (typeof old?.id === "string") removeRowFromServer(table, old.id);
            return;
          }
          const row = payload.new as { id?: string };
          if (typeof row?.id === "string") {
            // Pending-local-edit guard lives inside mergeRowsFromServer.
            mergeRowsFromServer({ [table]: [row] });
          }
        },
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && hadDropRef.current) {
        // Backfill whatever changed while the stream was down.
        hadDropRef.current = false;
        void hydrateFromSupabase().catch(() => {
          /* still offline or transient — the next resubscribe retries */
        });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        hadDropRef.current = true;
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId]);

  return null;
}
