"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/components/locale-provider";
import {
  NOTIFY_EVENT,
  type AppNotification,
  type NotifyKind,
} from "@/lib/notify";

/**
 * Renders app-wide notifications fired through {@link notify} (lib/notify.ts).
 * Mounted once in the root layout. Notifications carry i18n keys and are
 * translated here in the active locale, so a toast fired before a locale switch
 * still reads correctly. Errors persist longer than confirmations. Built from
 * semantic theme tokens only (AGENTS.md) so it adapts to light/dark.
 */

const MAX_VISIBLE = 4;

const DEFAULT_DURATION: Record<NotifyKind, number> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  error: 10_000,
};

const KIND_ICON: Record<NotifyKind, typeof Info> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

const KIND_TONE: Record<NotifyKind, string> = {
  success: "text-success",
  info: "text-muted-foreground",
  warning: "text-status-warning",
  error: "text-destructive",
};

export function Toaster() {
  const { t } = useT();
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<AppNotification>).detail;
      if (!detail || !detail.titleKey) return;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), detail]);
      const duration = detail.duration ?? DEFAULT_DURATION[detail.kind];
      timers.current.set(
        detail.id,
        setTimeout(() => dismiss(detail.id), duration),
      );
    };
    window.addEventListener(NOTIFY_EVENT, onNotify);
    const pending = timers.current;
    return () => {
      window.removeEventListener(NOTIFY_EVENT, onNotify);
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:pr-6"
      aria-label={t("notify.regionLabel")}
    >
      {toasts.map((toast) => {
        const Icon = KIND_ICON[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-lg"
          >
            <Icon
              className={cn("mt-0.5 size-4 shrink-0", KIND_TONE[toast.kind])}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {t(toast.titleKey, toast.params)}
              </p>
              {toast.bodyKey ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t(toast.bodyKey, toast.params)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t("notify.dismiss")}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
