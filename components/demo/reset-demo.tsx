"use client";

/**
 * Demo mode (Phase 16, re-pointed at the real backend in Phase 18b) — a
 * one-click reset to a known-good state so a presenter can rerun the same
 * walkthrough. It discards *local* edits and the sync outbox only:
 *
 *  - With a real backend wired (Phase 18b), it re-pulls the signed-in user's
 *    hospital from Supabase into the local cache. Server data is never touched.
 *  - With no backend (dev/tests, no env), it falls back to re-seeding the mock
 *    store, as before.
 *
 * The reset is destructive to local state, so it's gated behind an explicit
 * confirm step that states the outcome. Mount-guarded per AGENTS.md so server
 * and first-paint markup stay identical.
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resetDatabase } from "@/services/mockStorage";
import { hydrateFromSupabase } from "@/services/supabaseData";
import { clearOutbox, isSyncConfigured } from "@/services/syncQueue";
import { useT } from "@/components/locale-provider";

export function ResetDemo() {
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      if (isSyncConfigured()) {
        // Re-pull server truth into the cache, then drop any local pending
        // edits. hydrateFromSupabase replaces the cache atomically, so a fetch
        // failure leaves the existing cache intact rather than emptying it.
        await hydrateFromSupabase();
        clearOutbox();
      } else {
        resetDatabase();
      }
      // Hard reload so every screen re-reads the refreshed store.
      window.location.assign("/");
    } catch {
      // Likely offline — keep the current cache and let the user retry.
      setResetting(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--status-treatment) 16%, transparent)",
              color: "var(--status-treatment)",
            }}
          >
            <RotateCcw className="size-4" />
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("demo.resetTitle")}</span>
            <p className="text-xs text-muted-foreground">{t("demo.resetBody")}</p>
          </div>
        </div>

        {confirming ? (
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={resetting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReset}
              disabled={resetting}
            >
              <RotateCcw className="size-4" />
              {t("demo.resetConfirm")}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 self-end sm:self-auto"
            onClick={() => setConfirming(true)}
          >
            <RotateCcw className="size-4" />
            {t("demo.resetButton")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
