"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, BellRing } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT, type TFunction } from "@/components/locale-provider";
import { useAuth } from "@/components/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/mockStorage";
import {
  enablePush,
  getNotificationsVersion,
  isPushSupported,
  pushPermission,
  readNotifications,
  readUnreadCount,
  subscribeNotifications,
} from "@/services/notifications-client";
import { openVisitDrawer } from "@/services/visit-drawer";
import type { Notification } from "@careflow/shared";

/**
 * Navbar notification bell + dropdown feed. Reads this device's notifications
 * for the signed-in staff member, streams live updates via the notifications
 * store, and deep-links each item to where it happened (the patient drawer for
 * visit-scoped events, else the linked page). Hidden until a staff identity is
 * resolved so it never renders for logged-out / onboarding states.
 */
export function NotificationBell() {
  const { t, locale, mounted } = useT();
  const { currentStaff, currentHospital } = useAuth();
  const router = useRouter();
  const staffId = currentStaff?.id ?? null;

  // OS push permission — read client-side only (guards hydration).
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported" | null
  >(null);
  useEffect(() => {
    setPermission(isPushSupported() ? pushPermission() : "unsupported");
  }, []);

  async function onEnablePush() {
    if (!staffId || !currentHospital) return;
    const result = await enablePush({
      staffId,
      hospitalId: currentHospital.id,
    });
    setPermission(result);
  }

  // Reactive: re-read whenever a notification is created / received / read.
  const version = useSyncExternalStore(
    subscribeNotifications,
    getNotificationsVersion,
    () => 0,
  );

  const notifications = useMemo(
    () => (staffId ? readNotifications(staffId) : []),
    // version drives recomputation as the store changes
    [staffId, version],
  );
  const unread = useMemo(
    () => (staffId ? readUnreadCount(staffId) : 0),
    [staffId, version],
  );

  if (!currentStaff) return null;

  // Guard the count against SSR/first-paint hydration mismatch.
  const showBadge = mounted && unread > 0;

  function onOpenItem(n: Notification) {
    markNotificationRead(n.id);
    if (n.entity_type === "visit" && n.entity_id) {
      openVisitDrawer(n.entity_id);
    } else if (n.link) {
      router.push(n.link);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("notifications.ariaLabel")}
            className="relative"
          />
        }
      >
        {showBadge ? (
          <BellRing className="size-5" />
        ) : (
          <Bell className="size-5" />
        )}
        {showBadge ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground tabular-nums"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,22rem)] p-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {t("notifications.title")}
            </span>
            {unread > 0 ? (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground tabular-nums">
                {t("notifications.unreadCount", { count: unread })}
              </span>
            ) : null}
          </div>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => staffId && markAllNotificationsRead(staffId)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Check className="size-3.5" />
              {t("notifications.markAllRead")}
            </button>
          ) : null}
        </div>

        {/* Feed */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
            <Bell className="size-6 text-muted-foreground/50" />
            <p className="text-sm font-medium">{t("notifications.empty")}</p>
            <p className="text-xs text-muted-foreground">
              {t("notifications.emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpenItem(n)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    n.read_at === null && "bg-accent/40",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read_at === null ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {n.title}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {relativeTime(n.created_at, t, mounted ? locale : "en")}
                      </span>
                    </span>
                    {n.body ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {n.body}
                      </span>
                    ) : null}
                    {n.actor_name ? (
                      <span className="truncate text-[11px] text-muted-foreground/80">
                        {n.actor_name}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Push footer — the permission "ask". Shown only while undecided. */}
        {permission === "default" ? (
          <div className="border-t border-border px-3 py-2.5">
            <p className="mb-1.5 text-xs text-muted-foreground">
              {t("notifications.pushPrompt")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={onEnablePush}
            >
              <BellRing className="size-3.5" />
              {t("notifications.enablePush")}
            </Button>
          </div>
        ) : permission === "granted" ? (
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <Check className="size-3.5 text-primary" />
            {t("notifications.pushEnabled")}
          </div>
        ) : permission === "denied" ? (
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            {t("notifications.pushBlocked")}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact relative timestamp: "just now" · "5m ago" · "3h ago" · "2d ago". */
function relativeTime(
  iso: string,
  t: TFunction,
  locale: string,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return t("notifications.justNow");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("notifications.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("notifications.hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t("notifications.daysAgo", { count: diffDay });
  return new Date(then).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}
