"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  MonitorSmartphone,
  Phone,
  PhoneCall,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  cancelFollowUpTask,
  completeFollowUpTask,
  getFollowUpTasks,
  getPatientById,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { useRole } from "@/components/role-provider";
import { useCacheVersion } from "@/lib/use-cache";
import { notify } from "@/lib/notify";
import { formatDate } from "@/i18n/format";
import type { FollowUpKind, FollowUpTask } from "@/types/healthcare";
import type { MessageKey } from "@/i18n";

/** i18n label key + icon per follow-up kind. */
const KIND_META: Record<FollowUpKind, { labelKey: MessageKey; icon: LucideIcon }> = {
  call: { labelKey: "followUp.kindCall", icon: PhoneCall },
  tele_checkin: { labelKey: "followUp.kindTeleCheckin", icon: MonitorSmartphone },
  summary_delivery: { labelKey: "followUp.kindSummaryDelivery", icon: FileText },
};

interface FollowUpRow {
  task: FollowUpTask;
  phone: string | null;
}

interface FollowUpData {
  /** Pending and already due — most overdue first. */
  due: FollowUpRow[];
  /** Pending with a future due date — soonest first. */
  upcoming: FollowUpRow[];
  /** Completed tasks, most recent first (capped at 20). */
  done: FollowUpRow[];
}

export default function FollowUpsPage() {
  const { t, locale } = useT();
  const { actingStaff } = useRole();
  const cacheVersion = useCacheVersion();
  const [data, setData] = useState<FollowUpData | null>(null);

  function load() {
    const now = Date.now();
    const rows: FollowUpRow[] = getFollowUpTasks().map((task) => ({
      task,
      phone: getPatientById(task.patient_id)?.phone ?? null,
    }));
    const pending = rows.filter((r) => r.task.status === "pending");
    setData({
      due: pending.filter((r) => new Date(r.task.due_at).getTime() <= now),
      upcoming: pending.filter((r) => new Date(r.task.due_at).getTime() > now),
      done: rows
        .filter((r) => r.task.status === "done")
        .sort((a, b) =>
          (b.task.completed_at ?? "").localeCompare(a.task.completed_at ?? ""),
        )
        .slice(0, 20),
    });
  }

  useEffect(() => {
    load();
  }, [cacheVersion]);

  function handleComplete(task: FollowUpTask) {
    try {
      completeFollowUpTask(task.id, actingStaff?.id ?? null);
      load();
    } catch {
      notify({
        kind: "error",
        titleKey: "followUp.actionFailedTitle",
        bodyKey: "followUp.actionFailedBody",
      });
    }
  }

  function handleCancel(task: FollowUpTask) {
    try {
      cancelFollowUpTask(task.id);
      load();
    } catch {
      notify({
        kind: "error",
        titleKey: "followUp.actionFailedTitle",
        bodyKey: "followUp.actionFailedBody",
      });
    }
  }

  const pendingCount = data ? data.due.length + data.upcoming.length : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("followUp.title")}
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {pendingCount ?? "—"} {t("followUp.pendingCount")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t("followUp.subtitle")}</p>
      </header>

      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("followUp.loading")}</p>
      ) : (
        <>
          {pendingCount === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor:
                      "color-mix(in oklab, var(--status-clearance) 16%, transparent)",
                    color: "var(--status-clearance)",
                  }}
                >
                  <ClipboardCheck className="size-5" />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{t("followUp.allClear")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("followUp.allClearHint")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <TaskSection
                heading={t("followUp.dueSection")}
                count={data.due.length}
                rows={data.due}
                overdue
                onComplete={handleComplete}
                onCancel={handleCancel}
              />
              <TaskSection
                heading={t("followUp.upcomingSection")}
                count={data.upcoming.length}
                rows={data.upcoming}
                emptyMessage={t("followUp.noneUpcoming")}
                onComplete={handleComplete}
                onCancel={handleCancel}
              />
            </>
          )}

          {/* Recently completed — simple collapsed list. */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("followUp.doneSection")}
            </h2>
            {data.done.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("followUp.noneDone")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.done.map(({ task }) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <CheckCircle2
                      className="size-4 shrink-0"
                      style={{ color: "var(--status-clearance)" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.completed_at ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {t("followUp.completedOn", {
                          date: formatDate(task.completed_at, locale),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TaskSection({
  heading,
  count,
  rows,
  overdue = false,
  emptyMessage,
  onComplete,
  onCancel,
}: {
  heading: string;
  count: number;
  rows: FollowUpRow[];
  /** Style due dates in this section as overdue. */
  overdue?: boolean;
  /** When set, render this instead of hiding an empty section. */
  emptyMessage?: string;
  onComplete: (task: FollowUpTask) => void;
  onCancel: (task: FollowUpTask) => void;
}) {
  const { t, locale } = useT();

  if (rows.length === 0 && !emptyMessage) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {heading}
        <span className="font-mono text-xs font-medium tabular-nums">
          {count}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        rows.map(({ task, phone }) => {
          const meta = KIND_META[task.kind];
          const KindIcon = meta.icon;
          return (
            <Card key={task.id}>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {task.title}
                    </span>
                    <Badge variant="secondary">
                      <KindIcon aria-hidden />
                      {t(meta.labelKey)}
                    </Badge>
                    {overdue ? (
                      <Badge variant="destructive">{t("followUp.overdue")}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {t("followUp.dueOn", {
                        date: formatDate(task.due_at, locale),
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" />
                      {phone ? (
                        <span className="font-mono">{phone}</span>
                      ) : (
                        t("followUp.noPhone")
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => onComplete(task)}>
                    <CheckCircle2 className="size-4" />
                    {t("followUp.markDone")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => onCancel(task)}
                  >
                    {t("followUp.cancelTask")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </section>
  );
}
