"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import {
  CONFLICT_EVENT,
  MAX_ATTEMPTS,
  OUTBOX_EVENT,
  discardChange,
  discardConflict,
  drainOutbox,
  readConflicts,
  readOutbox,
  retryChange,
  type ConflictRecord,
  type OutboxChange,
} from "@/services/syncQueue";
import { applyConflictPayload } from "@/services/mockStorage";
import { msgKey } from "@/i18n";

/**
 * Navbar chip + sync health panel (Stage 1 visibility work).
 *
 * The chip reflects connectivity and the outbox backlog, as before. Clicking it
 * now opens a panel that separates "waiting to send" from "retrying" from
 * "keeps failing — needs attention", with each stuck change's recorded error, so
 * a permanently-failing change is no longer indistinguishable from a healthy
 * queue. Hydration-guarded per AGENTS.md; theme tokens only.
 */
export function SyncStatus() {
  const { t, locale } = useT();
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  const [entries, setEntries] = useState<OutboxChange[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    setEntries(readOutbox());
    setConflicts(readConflicts());

    const syncOnline = () => setOnline(navigator.onLine);
    const syncPending = () => setEntries(readOutbox());
    const syncConflicts = () => setConflicts(readConflicts());

    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    window.addEventListener(OUTBOX_EVENT, syncPending);
    window.addEventListener(CONFLICT_EVENT, syncConflicts);

    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      window.removeEventListener(OUTBOX_EVENT, syncPending);
      window.removeEventListener(CONFLICT_EVENT, syncConflicts);
    };
  }, []);

  // Re-read when the panel opens so it never shows a stale snapshot.
  useEffect(() => {
    if (open) {
      setEntries(readOutbox());
      setConflicts(readConflicts());
    }
  }, [open]);

  const syncNow = useCallback(() => {
    setSyncing(true);
    void drainOutbox()
      .catch(() => {
        /* per-change failures are recorded in the outbox and shown below */
      })
      .finally(() => {
        setEntries(readOutbox());
        setSyncing(false);
      });
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

  const pending = entries.length;
  const hasPending = pending > 0;
  const hasConflicts = conflicts.length > 0;
  const attention = entries.filter((e) => e.attempts >= MAX_ATTEMPTS);
  const retrying = entries.filter(
    (e) => e.attempts > 0 && e.attempts < MAX_ATTEMPTS,
  );
  const waiting = entries.filter((e) => e.attempts === 0);

  let Icon = Wifi;
  let label = t("sync.online");
  let tone = "text-muted-foreground";

  if (!online) {
    Icon = hasPending ? CloudOff : WifiOff;
    tone = "text-status-warning";
    label = hasPending
      ? t(pending === 1 ? "sync.offlinePendingOne" : "sync.offlinePendingMany", {
          count: pending,
        })
      : t("sync.offlineSaved");
  } else if (attention.length > 0) {
    Icon = AlertTriangle;
    tone = "text-destructive";
    label = t("sync.groupAttention");
  } else if (hasConflicts) {
    Icon = AlertTriangle;
    tone = "text-status-warning";
    label = t("sync.groupConflicts");
  } else if (hasPending) {
    Icon = RefreshCw;
    label = t(pending === 1 ? "sync.queuedOne" : "sync.queuedMany", {
      count: pending,
    });
  }

  const groups: {
    key: string;
    title: string;
    hint?: string;
    items: OutboxChange[];
    toneClass: string;
  }[] = [
    {
      key: "attention",
      title: t("sync.groupAttention"),
      hint: t("sync.groupAttentionHint"),
      items: attention,
      toneClass: "text-destructive",
    },
    {
      key: "retrying",
      title: t("sync.groupRetrying"),
      items: retrying,
      toneClass: "text-status-warning",
    },
    {
      key: "waiting",
      title: t("sync.groupWaiting"),
      items: waiting,
      toneClass: "text-muted-foreground",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2 text-xs font-medium tabular-nums transition-colors hover:bg-accent",
              tone,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sync.panelTitle")}</DialogTitle>
          <DialogDescription>{t("sync.panelIntro")}</DialogDescription>
        </DialogHeader>

        {!online ? (
          <p className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-status-warning">
            <WifiOff className="size-3.5 shrink-0" aria-hidden />
            {t("sync.offlineHint")}
          </p>
        ) : null}

        {pending === 0 && !hasConflicts ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Check className="size-4 text-success" aria-hidden />
            {t("sync.allSynced")}
          </p>
        ) : (
          <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
            {hasConflicts ? (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-status-warning">
                  {t("sync.groupConflicts")}
                  <span className="ml-1.5 font-mono">{conflicts.length}</span>
                </h3>
                <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                  {t("sync.groupConflictsHint")}
                </p>
                <ul className="space-y-1.5">
                  {conflicts.map((conflict) => (
                    <li
                      key={conflict.id}
                      className="rounded-md border border-border bg-card px-3 py-2"
                    >
                      <p className="text-sm text-foreground">
                        {/* `table` arrives from the sync wire as a plain string; translate() falls
                            back to the raw key if a new table has no label yet. */}
                        {t(msgKey(`tableNames.${conflict.table}`))}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("sync.conflictDetectedAt", {
                          time: formatDateTime(conflict.detected_at, locale),
                        })}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            applyConflictPayload(
                              conflict.table,
                              conflict.row_id,
                              conflict.payload,
                            );
                            discardConflict(conflict.id);
                            setConflicts(readConflicts());
                          }}
                        >
                          {t("sync.reapply")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            discardConflict(conflict.id);
                            setConflicts(readConflicts());
                          }}
                        >
                          {t("sync.discard")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                <section key={group.key}>
                  <h3
                    className={cn(
                      "mb-1.5 text-xs font-semibold uppercase tracking-wide",
                      group.toneClass,
                    )}
                  >
                    {group.title}
                    <span className="ml-1.5 font-mono">{group.items.length}</span>
                  </h3>
                  {group.hint ? (
                    <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                      {group.hint}
                    </p>
                  ) : null}
                  <ul className="space-y-1.5">
                    {group.items.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border bg-card px-3 py-2"
                      >
                        <p className="text-sm text-foreground">
                          {t(`sync.op${entry.op === "insert" ? "Insert" : entry.op === "update" ? "Update" : "Delete"}`)}
                          {" — "}
                          {t(msgKey(`tableNames.${entry.table}`))}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("sync.entryQueuedAt", {
                            time: formatDateTime(entry.enqueued_at, locale),
                          })}
                          {entry.attempts > 0 ? (
                            <>
                              {" · "}
                              {t("sync.entryAttempts", { count: entry.attempts })}
                            </>
                          ) : null}
                        </p>
                        {entry.last_error ? (
                          <p className="mt-1 break-words font-mono text-[11px] leading-snug text-muted-foreground">
                            {entry.last_error}
                          </p>
                        ) : null}
                        {group.key === "attention" ? (
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                retryChange(entry.id);
                                setEntries(readOutbox());
                              }}
                            >
                              {t("sync.retry")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                discardChange(entry.id);
                                setEntries(readOutbox());
                              }}
                            >
                              {t("sync.discard")}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}

        {hasPending && online ? (
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={syncNow} disabled={syncing}>
              <RefreshCw
                className={cn("size-3.5", syncing && "animate-spin")}
                aria-hidden
              />
              {syncing ? t("sync.syncing") : t("sync.syncNow")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
