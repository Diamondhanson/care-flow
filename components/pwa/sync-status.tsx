"use client";

import { useEffect, useState } from "react";
import { Check, CloudOff, RefreshCw, Wifi, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OUTBOX_EVENT, pendingCount } from "@/services/syncQueue";

/**
 * Navbar chip reflecting connectivity and the outbox backlog. Reads
 * `navigator.onLine` and the pending change count, and refreshes on the relevant
 * window events. Hydration-guarded per AGENTS.md: renders an inert placeholder on
 * the server and until mounted, then swaps in the live status — server/client
 * markup stays identical until then. Built entirely from semantic theme tokens so
 * it adapts to light and dark.
 */
export function SyncStatus() {
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    setPending(pendingCount());

    const syncOnline = () => setOnline(navigator.onLine);
    const syncPending = () => setPending(pendingCount());

    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    window.addEventListener(OUTBOX_EVENT, syncPending);

    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      window.removeEventListener(OUTBOX_EVENT, syncPending);
    };
  }, []);

  // Keep the server/first-paint markup stable to avoid a hydration mismatch.
  if (!mounted) {
    return (
      <span
        aria-hidden
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground"
      >
        <Wifi className="size-3.5" />
      </span>
    );
  }

  const hasPending = pending > 0;

  let Icon = Wifi;
  let label = "Online · all changes saved";
  let tone = "text-muted-foreground";

  if (!online) {
    Icon = hasPending ? CloudOff : WifiOff;
    tone = "text-status-warning";
    label = hasPending
      ? `Offline · ${pending} change${pending === 1 ? "" : "s"} saved on this device, will sync when back online`
      : "Offline · changes are saved on this device";
  } else if (hasPending) {
    Icon = RefreshCw;
    label = `${pending} change${pending === 1 ? "" : "s"} queued to sync`;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-xs font-medium tabular-nums transition-colors hover:bg-accent",
              tone
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {hasPending ? (
              <span className="font-mono">{pending}</span>
            ) : (
              online && <Check className="size-3 text-muted-foreground" aria-hidden />
            )}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
