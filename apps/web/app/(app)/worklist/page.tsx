"use client";

/**
 * Cross-department worklist (Phase 20) — one screen that answers, across EVERY
 * ward at once:
 *   - for a nurse: "what do I owe right now?" (due meds + monitoring + open
 *     doctor instructions), overdue-first;
 *   - for a doctor: "who needs me?" (open nurse→doctor flags + concerning vitals).
 *
 * It reads tenant-scoped inpatient data from the service layer and derives the
 * lists with the shared, unit-tested collaboration helpers. Admins see both.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Activity,
  BellRing,
  Check,
  ClipboardCheck,
  ListChecks,
  MapPin,
  Pill,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildPatientWorklist,
  openDoctorFlags,
  vitalsConcern,
  type WorklistEntry,
} from "@/components/care-plans/collaboration";
import { useLocale, useT } from "@/components/locale-provider";
import { useRole } from "@/components/role-provider";
import { formatDateTime } from "@/i18n/format";
import {
  acknowledgeCarePlanEntry,
  getActiveInpatientCollabData,
  resolveCarePlanItem,
  type InpatientCollabData,
} from "@/services/mockStorage";
import { OUTBOX_EVENT } from "@/services/syncQueue";

const TEAL = "var(--status-diagnostics)";
const AMBER = "var(--status-treatment)";

type Derived = InpatientCollabData & {
  worklist: WorklistEntry[];
  flags: ReturnType<typeof openDoctorFlags>;
  vitalsAlert: boolean;
  overdue: number;
};

function kindIcon(kind: WorklistEntry["kind"]) {
  if (kind === "medication") return Pill;
  if (kind === "monitoring") return Activity;
  return Stethoscope;
}

function PatientHeader({
  name,
  mrn,
  location,
  department,
}: {
  name: string;
  mrn: string;
  location: string | null;
  department: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="text-sm font-medium">{name}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{mrn}</span>
      <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        {location ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <MapPin className="size-3" />
            {location}
          </span>
        ) : null}
        {department ? <span>{department}</span> : null}
      </span>
    </div>
  );
}

export default function WorklistPage() {
  const { t } = useT();
  const { mounted: localeMounted, locale } = useLocale();
  const activeLocale = localeMounted ? locale : "en";
  const { mounted: roleMounted, actingRole, actingStaffId } = useRole();

  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<InpatientCollabData[] | null>(null);

  useEffect(() => {
    setRows(getActiveInpatientCollabData());
  }, [tick]);

  const refresh = () => setTick((x) => x + 1);

  // Keep the board current on its own, so it never goes stale while open:
  //  - every minute, so a dose ticking from "due" to "overdue" as time passes
  //    surfaces without reopening the page;
  //  - the instant anything is written — a mutation in this tab (OUTBOX_EVENT,
  //    fired on every save) or a write from another tab ("storage").
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    const interval = window.setInterval(bump, 60_000);
    window.addEventListener(OUTBOX_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(OUTBOX_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  const computed: Derived[] = useMemo(() => {
    return (rows ?? []).map((r) => {
      const worklist = buildPatientWorklist({
        prescriptions: r.prescriptions,
        administrationsByRx: r.administrationsByRx,
        items: r.items,
        entries: r.entries,
        lastVitalsAt: r.records[0]?.recorded_at ?? null,
      });
      return {
        ...r,
        worklist,
        flags: openDoctorFlags(r.entries),
        vitalsAlert: r.records[0] ? vitalsConcern(r.records[0]) : false,
        overdue: worklist.filter((w) => w.state === "overdue").length,
      };
    });
  }, [rows]);

  const ready = roleMounted && rows !== null;
  const isDoctor = actingRole === "doctor";
  const isAdmin = actingRole === "admin";
  const showDoctor = isDoctor || isAdmin;
  const showNurse = !isDoctor || isAdmin;

  const needsYou = useMemo(
    () =>
      computed
        .filter((c) => c.flags.length > 0 || c.vitalsAlert)
        .sort(
          (a, b) =>
            b.flags.length + (b.vitalsAlert ? 1 : 0) -
            (a.flags.length + (a.vitalsAlert ? 1 : 0)),
        ),
    [computed],
  );
  const due = useMemo(
    () =>
      computed
        .filter((c) => c.worklist.length > 0)
        .sort((a, b) => b.overdue - a.overdue || b.worklist.length - a.worklist.length),
    [computed],
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("worklist.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("worklist.subtitle")}</p>
      </header>

      {!ready ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("worklist.loading")}
        </p>
      ) : (
        <>
          {/* Doctor: who needs me */}
          {showDoctor ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <BellRing className="size-4" style={{ color: AMBER }} />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("worklist.needsYouHeading")}
                </h2>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {needsYou.length}
                </span>
              </div>
              {needsYou.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                  {t("worklist.noneNeedYou")}
                </p>
              ) : (
                needsYou.map((c) => (
                  <div
                    key={c.admissionId}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <PatientHeader
                      name={c.patientName}
                      mrn={c.mrn}
                      location={c.location}
                      department={c.departmentName}
                    />
                    {c.vitalsAlert ? (
                      <span
                        className="inline-flex w-fit items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          color: AMBER,
                          background: "color-mix(in oklab, var(--status-treatment) 12%, transparent)",
                        }}
                      >
                        <Activity className="size-3" />
                        {t("worklist.vitalsConcern")}
                      </span>
                    ) : null}
                    {c.flags.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-start gap-2 rounded-md border border-l-[3px] border-border p-2.5 text-xs"
                        style={{ borderLeftColor: AMBER }}
                      >
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: AMBER }} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span>{f.note}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatDateTime(f.recorded_at, activeLocale)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                          onClick={() => {
                            acknowledgeCarePlanEntry(f.id, actingStaffId);
                            refresh();
                          }}
                        >
                          <Check className="size-3" />
                          {t("carePlan.acknowledge")}
                        </Button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </section>
          ) : null}

          {/* Nurse: what's due */}
          {showNurse ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ListChecks className="size-4" style={{ color: TEAL }} />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("worklist.dueHeading")}
                </h2>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {due.length}
                </span>
              </div>
              {due.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                  {t("worklist.nothingDue")}
                </p>
              ) : (
                due.map((c) => (
                  <div
                    key={c.admissionId}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <PatientHeader
                      name={c.patientName}
                      mrn={c.mrn}
                      location={c.location}
                      department={c.departmentName}
                    />
                    {c.worklist.map((w) => {
                      const Icon = kindIcon(w.kind);
                      return (
                        <div
                          key={`${w.kind}-${w.refId}`}
                          className="flex items-center gap-2 rounded-md border border-border p-2.5 text-xs"
                        >
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate">{w.label}</span>
                            {w.detail ? (
                              <span className="text-[11px] text-muted-foreground">{w.detail}</span>
                            ) : null}
                          </div>
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                            style={{
                              color: w.state === "overdue" ? AMBER : "var(--muted-foreground)",
                              background:
                                w.state === "overdue"
                                  ? "color-mix(in oklab, var(--status-treatment) 14%, transparent)"
                                  : "var(--muted)",
                            }}
                          >
                            {w.kind === "instruction"
                              ? t("carePlan.kindInstruction")
                              : t(`doseState.${w.state}`)}
                          </span>
                          {w.kind === "instruction" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                              onClick={() => {
                                resolveCarePlanItem(w.refId);
                                refresh();
                              }}
                            >
                              <ClipboardCheck className="size-3" />
                              {t("carePlan.markDone")}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
