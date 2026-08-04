"use client";

/**
 * Ask CareFlow (Phase 22, spec §11) — a READ-ONLY research assistant.
 *
 * "This patient" mode: the question travels with the on-device context
 * bundle (freshest record, identifiers stripped). "Across patients" mode
 * (doctor/admin only): the server plans a whitelisted structured query, runs
 * it through the caller's RLS-bound client, and summarises the rows — the
 * table + a plain description of what was searched are always shown, so the
 * clinician can verify the answer against the data.
 */

import { useState } from "react";
import { Search, Send } from "lucide-react";

import type { Patient } from "@careflow/shared";

import { CareFlowMark } from "@/components/brand/careflow-logo";
import { useT, useLocale } from "@/components/locale-provider";
import { useRole } from "@/components/role-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AiApiError,
  askCareFlow,
  isAiEnabledClient,
  useOnline,
  type AskResponse,
} from "@/lib/ai/api-client";
import { buildPatientContext } from "@/lib/ai/client-context";
import { PatientName } from "@/lib/patient-name";
import { getLatestVisitForPatient, searchPatients } from "@/services/mockStorage";

type AskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: string }
  | { status: "done"; response: AskResponse };

export default function AskCareFlowPage() {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const { actingRole } = useRole();
  const online = useOnline();

  const [mode, setMode] = useState<"patient" | "cohort">("patient");
  const [search, setSearch] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });

  const activeLocale = mounted ? locale : "en";
  const canCohort = actingRole === "doctor" || actingRole === "admin";
  const matches = search.trim().length >= 2 ? searchPatients(search.trim()) : [];

  if (!isAiEnabledClient()) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("ai.ask.title")}</h1>
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("ai.unavailable")}
        </p>
      </div>
    );
  }

  async function ask() {
    const q = question.trim();
    if (!q || state.status === "loading") return;

    setState({ status: "loading" });
    try {
      if (mode === "patient") {
        if (!patient) return;
        const visit = getLatestVisitForPatient(patient.id);
        const ctx = visit ? buildPatientContext(visit.id) : null;
        if (!ctx) {
          setState({ status: "error", code: "no_visit" });
          return;
        }
        const response = await askCareFlow({
          mode: "patient",
          question: q,
          patientId: patient.id,
          locale: activeLocale,
          context: ctx,
        });
        setState({ status: "done", response });
      } else {
        const response = await askCareFlow({
          mode: "cohort",
          question: q,
          locale: activeLocale,
        });
        setState({ status: "done", response });
      }
    } catch (err) {
      setState({
        status: "error",
        code: err instanceof AiApiError ? err.code : "ai_unavailable",
      });
    }
  }

  const errorText = (code: string) =>
    code === "rate_limited"
      ? t("ai.rateLimited")
      : code === "no_visit"
        ? t("ai.ask.noPatient")
        : code === "network"
          ? t("ai.offline")
          : t("ai.unavailable");

  const tabButton = (value: "patient" | "cohort", label: string, enabled: boolean) => (
    <button
      type="button"
      aria-pressed={mode === value}
      disabled={!enabled}
      onClick={() => {
        setMode(value);
        setState({ status: "idle" });
      }}
      className={
        mode === value
          ? "rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium"
          : "rounded-md border border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      }
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CareFlowMark className="size-6" />
          {t("ai.ask.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("ai.ask.subtitle")}</p>
        <p className="text-xs text-muted-foreground/80">{t("ai.ask.readOnlyNote")}</p>
      </header>

      {!online ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("ai.offline")}
        </p>
      ) : null}

      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1 w-fit">
        {tabButton("patient", t("ai.ask.patientTab"), true)}
        {tabButton("cohort", t("ai.ask.cohortTab"), canCohort)}
      </div>
      {!canCohort ? (
        <p className="-mt-4 text-xs text-muted-foreground/70">{t("ai.ask.cohortNote")}</p>
      ) : null}

      {mode === "patient" ? (
        <section className="flex flex-col gap-2">
          <label className="flex items-center gap-2 rounded-md border border-border bg-card px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={patient ? "" : search}
              onChange={(e) => {
                setPatient(null);
                setSearch(e.target.value);
              }}
              placeholder={
                patient
                  ? (patient.is_emergency_anonymous
                      ? (patient.anonymous_identifier ?? "")
                      : patient.full_name)
                  : t("ai.ask.selectPatient")
              }
              className="border-0 shadow-none focus-visible:ring-0"
            />
            {patient?.mrn ? (
              <span className="font-mono text-xs text-muted-foreground">{patient.mrn}</span>
            ) : null}
          </label>
          {!patient && matches.length > 0 ? (
            <ul className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(p);
                      setSearch("");
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <PatientName
                      name={
                        p.is_emergency_anonymous
                          ? (p.anonymous_identifier ?? "—")
                          : p.full_name
                      }
                      format={!p.is_emergency_anonymous}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.mrn ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!patient ? (
            <p className="text-xs text-muted-foreground">{t("ai.ask.noPatient")}</p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("ai.ask.placeholder")}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
          }}
        />
        <div className="flex items-center gap-3">
          <Button
            className="w-fit gap-2"
            disabled={
              !online ||
              state.status === "loading" ||
              !question.trim() ||
              (mode === "patient" && !patient)
            }
            onClick={() => void ask()}
          >
            <Send className="size-3.5" />
            {state.status === "loading" ? t("ai.generating") : t("ai.ask.askButton")}
          </Button>
        </div>
      </section>

      {state.status === "loading" ? (
        <div className="h-24 animate-pulse rounded-md border border-border bg-card" aria-hidden />
      ) : null}

      {state.status === "error" ? (
        <p className="text-sm" style={{ color: "var(--status-warning)" }}>
          {errorText(state.code)}
        </p>
      ) : null}

      {state.status === "done" ? (
        <AskAnswerView
          response={state.response}
          onFollowUp={(next) => {
            setQuestion(next);
            setState({ status: "idle" });
          }}
        />
      ) : null}

      <p className="border-t border-border pt-3 text-[11px] text-muted-foreground/80">
        {t("ai.disclaimer")}
      </p>
    </div>
  );
}

function AskAnswerView({
  response,
  onFollowUp,
}: {
  response: AskResponse;
  onFollowUp: (question: string) => void;
}) {
  const { t } = useT();
  const table = response.table;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {response.answer.answer}
        </p>
        {response.answer.usedSources.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("ai.sources")}
            </span>
            {response.answer.usedSources.slice(0, 10).map((s) => (
              <span
                key={s}
                className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {response.queryPreview ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t("ai.ask.queryPreview")}
          </span>
          <p className="font-mono text-xs text-muted-foreground">{response.queryPreview}</p>
          {typeof response.totalCount === "number" ? (
            <p className="text-xs text-muted-foreground">
              {t("ai.ask.count", { count: response.totalCount })}
            </p>
          ) : null}
        </div>
      ) : null}

      {table && table.columns.length > 0 ? (
        table.rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            {t("ai.ask.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t("ai.ask.rows")}</caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {table.columns.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {table.columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 font-mono">
                        {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {response.answer.followUps && response.answer.followUps.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t("ai.ask.followUps")}
          </span>
          <div className="flex flex-wrap gap-2">
            {response.answer.followUps.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFollowUp(f)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
