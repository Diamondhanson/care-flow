"use client";

/**
 * The Review of Systems block (Phase 21) — the doctor's complaint-driven,
 * tap-first structured interview. Store-backed and self-contained: every tap
 * upserts a `ros_responses` row (offline-safe; answers survive closing the
 * drawer), so the drawer only mounts this component and reads the store again
 * at save time.
 *
 * Layout: the chief complaint's primary system auto-expands with its key
 * questions; secondary systems fold as "(suggested)"; everything else sits
 * behind "Review other systems" / "+ Add system". "Mark remaining as No"
 * charts a negative review without dozens of taps. A live compiled-report
 * disclosure re-renders the narrative on every answer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, ListChecks, Plus } from "lucide-react";

import type {
  BodySystem,
  RosAnswerValue,
  RosQuestion,
  RosResponse,
  Sex,
} from "@careflow/shared";
import { getAllSystems, getSystemModule } from "@/lib/ros";
import { systemsForComplaint } from "@/lib/ros/routing";
import { compileRosNarrative, SYSTEM_LABELS } from "@/lib/ros/compile";
import {
  answerLabelFor,
  questionApplies,
  responsesByKey,
  unansweredKeyQuestions,
  visibleFollowups,
} from "@/lib/ros/state";
import {
  clearRosResponse,
  getRosResponsesForVisit,
  upsertRosResponse,
} from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { RosQuestionRow } from "./ros-question";

export function RosReview({
  visitId,
  chiefComplaint,
  patientSex,
  recorderId,
  readOnly = false,
}: {
  visitId: string;
  chiefComplaint: string | null;
  patientSex: Sex;
  recorderId: string | null;
  readOnly?: boolean;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [responses, setResponses] = useState<ReadonlyMap<string, RosResponse>>(
    new Map(),
  );
  const routing = useMemo(
    () => systemsForComplaint(chiefComplaint ?? ""),
    [chiefComplaint],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<BodySystem>>(
    () => new Set(routing.primary ? [routing.primary] : []),
  );
  const [added, setAdded] = useState<ReadonlySet<BodySystem>>(new Set());
  const [showOther, setShowOther] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const refresh = useCallback(() => {
    setResponses(responsesByKey(getRosResponsesForVisit(visitId)));
  }, [visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const answeredKeys = useMemo(
    () => new Set(responses.keys()),
    [responses],
  );

  /** Persist one answer; `undefined` clears. Clearing or changing a parent also
   *  clears follow-up rows that are no longer revealed, so hidden answers never
   *  leak into the compiled narrative as orphans. */
  const handleAnswer = useCallback(
    (q: RosQuestion, value: RosAnswerValue | undefined, parent?: RosQuestion) => {
      const system = (q.system ?? parent?.system) as BodySystem;
      const kind = q.kind ?? parent?.kind ?? "symptom";
      if (value === undefined) {
        clearRosResponse(visitId, q.key);
      } else {
        upsertRosResponse(visitId, {
          system,
          question_key: q.key,
          kind,
          question_text:
            activeLocale === "fr" ? q.prompt_fr : q.prompt_en,
          answer_type: q.type,
          answer_value: value,
          answer_label: answerLabelFor(q, value, activeLocale),
          recorded_by_id: recorderId,
        });
      }
      // Sweep follow-ups the new parent answer no longer reveals.
      if (q.followups?.length) {
        const stillVisible = new Set(
          (value === undefined ? [] : visibleFollowups(q, value)).map(
            (f) => f.key,
          ),
        );
        for (const f of q.followups) {
          if (!stillVisible.has(f.key) && responses.has(f.key)) {
            clearRosResponse(visitId, f.key);
          }
        }
      }
      refresh();
    },
    [visitId, activeLocale, recorderId, responses, refresh],
  );

  const handleNote = useCallback(
    (q: RosQuestion, note: string) => {
      const existing = responses.get(q.key);
      if (!existing) return;
      upsertRosResponse(visitId, {
        system: existing.system,
        question_key: existing.question_key,
        kind: existing.kind,
        question_text: existing.question_text,
        answer_type: existing.answer_type,
        answer_value: existing.answer_value,
        answer_label: existing.answer_label,
        note: note.trim() || null,
        recorded_by_id: recorderId,
      });
      refresh();
    },
    [visitId, recorderId, responses, refresh],
  );

  const markRemainingNo = useCallback(
    (system: BodySystem) => {
      for (const q of unansweredKeyQuestions(
        getSystemModule(system),
        answeredKeys,
        patientSex,
      )) {
        upsertRosResponse(visitId, {
          system,
          question_key: q.key,
          kind: q.kind,
          question_text:
            activeLocale === "fr" ? q.prompt_fr : q.prompt_en,
          answer_type: "boolean",
          answer_value: false,
          answer_label: answerLabelFor(q, false, activeLocale),
          recorded_by_id: recorderId,
        });
      }
      refresh();
    },
    [visitId, activeLocale, recorderId, answeredKeys, patientSex, refresh],
  );

  const toggleExpanded = (system: BodySystem) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(system)) next.delete(system);
      else next.add(system);
      return next;
    });
  };

  const answeredCountFor = (system: BodySystem) => {
    let n = 0;
    for (const r of responses.values()) if (r.system === system) n += 1;
    return n;
  };

  // Sex-gated modules (obstetric/gynae) disappear entirely when no question
  // applies to this patient — an empty card helps no one.
  const applicableSystems = getAllSystems().filter((s) =>
    getSystemModule(s).some((q) => questionApplies(q, patientSex)),
  );
  // A system earns a visible card when routed to, manually added, or already
  // carrying answers (e.g. reopening a drawer after answering).
  const visibleSystems = applicableSystems.filter(
    (s) =>
      s === routing.primary ||
      routing.secondary.includes(s) ||
      added.has(s) ||
      answeredCountFor(s) > 0,
  );
  const otherSystems = applicableSystems.filter(
    (s) => !visibleSystems.includes(s),
  );

  const allResponses = [...responses.values()];
  const narrative = compileRosNarrative(allResponses, activeLocale);

  const systemCard = (system: BodySystem, suggested: boolean) => {
    const moduleQuestions = getSystemModule(system).filter((q) =>
      questionApplies(q, patientSex),
    );
    const symptoms = moduleQuestions.filter((q) => q.kind === "symptom");
    const keyQuestions = symptoms.filter((q) => q.key_question === true);
    const background = moduleQuestions.filter((q) => q.kind !== "symptom");
    const isOpen = expanded.has(system);
    const count = answeredCountFor(system);
    const remainingNo = unansweredKeyQuestions(
      moduleQuestions,
      answeredKeys,
      patientSex,
    ).length;

    return (
      <div
        key={system}
        className="flex flex-col rounded-md border border-border bg-background"
      >
        <button
          type="button"
          onClick={() => toggleExpanded(system)}
          aria-expanded={isOpen}
          className="flex items-center gap-2 p-2.5 text-left"
        >
          {isOpen ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide">
            {SYSTEM_LABELS[system][activeLocale]}
          </span>
          {suggested ? (
            <span className="text-[10px] text-muted-foreground">
              {t("ros.suggested")}
            </span>
          ) : null}
          {count > 0 ? (
            <Badge variant="outline" className="ml-auto font-mono text-[10px]">
              {t("ros.answeredCount", { count: String(count) })}
            </Badge>
          ) : null}
        </button>

        {isOpen ? (
          <div className="flex flex-col gap-2.5 border-t border-border p-2.5">
            {/* Two columns on the wide drawer — questions are independent, so
                halving the scroll depth beats one long list. */}
            <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-x-8">
              {keyQuestions.map((q) => (
                <RosQuestionRow
                  key={q.key}
                  question={q}
                  responses={responses}
                  locale={activeLocale}
                  disabled={readOnly}
                  onAnswer={handleAnswer}
                  onNote={handleNote}
                />
              ))}
            </div>

            <MoreQuestions
              questions={symptoms.filter((q) => q.key_question !== true)}
              responses={responses}
              locale={activeLocale}
              disabled={readOnly}
              onAnswer={handleAnswer}
              onNote={handleNote}
            />

            {background.length > 0 ? (
              <>
                <div className="flex items-center gap-2 pt-1">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("ros.historyGenetics")}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-x-8">
                  {background.map((q) => (
                    <RosQuestionRow
                      key={q.key}
                      question={q}
                      responses={responses}
                      locale={activeLocale}
                      disabled={readOnly}
                      onAnswer={handleAnswer}
                      onNote={handleNote}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {!readOnly && remainingNo > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 self-start text-xs"
                onClick={() => markRemainingNo(system)}
              >
                <ListChecks className="size-3.5" />
                {t("ros.markRemainingNo", { count: String(remainingNo) })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t("ros.title")}</span>
        {allResponses.length > 0 ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {t("ros.answeredCount", { count: String(allResponses.length) })}
          </Badge>
        ) : null}
      </div>

      {narrative ? (
        <div className="flex flex-col rounded-md border border-border bg-muted/40">
          <button
            type="button"
            onClick={() => setReportOpen((v) => !v)}
            aria-expanded={reportOpen}
            className="flex items-center gap-2 p-2 text-left"
          >
            <FileText className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{t("ros.compiledReport")}</span>
            {reportOpen ? (
              <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </button>
          {reportOpen ? (
            <p className="whitespace-pre-line border-t border-border p-2.5 text-xs leading-relaxed">
              {narrative}
            </p>
          ) : null}
        </div>
      ) : null}

      {visibleSystems.map((s) =>
        systemCard(s, s !== routing.primary && routing.secondary.includes(s)),
      )}

      {otherSystems.length > 0 ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            aria-expanded={showOther}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showOther
              ? t("ros.hideOtherSystems")
              : t("ros.reviewOtherSystems", {
                  count: String(otherSystems.length),
                })}
          </button>
          {!readOnly ? (
            <Select
              items={Object.fromEntries(
                otherSystems.map((s) => [s, SYSTEM_LABELS[s][activeLocale]]),
              )}
              value=""
              onValueChange={(v) => {
                const system = v as BodySystem;
                setAdded((prev) => new Set(prev).add(system));
                setExpanded((prev) => new Set(prev).add(system));
                setShowOther(false);
              }}
            >
              <SelectTrigger className="ml-auto h-7 w-fit gap-1 text-xs">
                <Plus className="size-3" />
                <SelectValue placeholder={t("ros.addSystem")} />
              </SelectTrigger>
              <SelectContent>
                {otherSystems.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SYSTEM_LABELS[s][activeLocale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}

      {showOther
        ? otherSystems.map((s) => systemCard(s, false))
        : null}
    </div>
  );
}

function MoreQuestions({
  questions,
  responses,
  locale,
  disabled,
  onAnswer,
  onNote,
}: {
  questions: RosQuestion[];
  responses: ReadonlyMap<string, RosResponse>;
  locale: Parameters<typeof RosQuestionRow>[0]["locale"];
  disabled?: boolean;
  onAnswer: Parameters<typeof RosQuestionRow>[0]["onAnswer"];
  onNote: Parameters<typeof RosQuestionRow>[0]["onNote"];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (questions.length === 0) return null;
  // Answered non-key questions stay visible even when the fold is closed.
  const pinned = questions.filter((q) => responses.has(q.key));
  const shown = open ? questions : pinned;
  return (
    <>
      {shown.length > 0 ? (
        <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-x-8">
          {shown.map((q) => (
            <RosQuestionRow
              key={q.key}
              question={q}
              responses={responses}
              locale={locale}
              disabled={disabled}
              onAnswer={onAnswer}
              onNote={onNote}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {open
          ? t("ros.fewerQuestions")
          : t("ros.moreQuestions", {
              count: String(questions.length - pinned.length),
            })}
      </button>
    </>
  );
}
