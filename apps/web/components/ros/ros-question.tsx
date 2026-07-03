"use client";

/**
 * One ROS question row (Phase 21): localized prompt + tap-first answer
 * control, with follow-ups revealed only while the parent's answer matches
 * their `show_if` (a "No" costs one tap and reveals nothing), and an optional
 * free-text note on answered parents.
 */

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

import type { RosAnswerValue, RosQuestion, RosResponse } from "@careflow/shared";
import type { Locale } from "@/i18n";
import { visibleFollowups } from "@/lib/ros/state";
import { useT } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";

import { RosAnswerControl } from "./ros-answer-control";

export function RosQuestionRow({
  question,
  responses,
  locale,
  disabled,
  onAnswer,
  onNote,
}: {
  question: RosQuestion;
  responses: ReadonlyMap<string, RosResponse>;
  locale: Locale;
  disabled?: boolean;
  /** `parent` is set when `q` is a follow-up (it inherits system/kind). */
  onAnswer: (
    q: RosQuestion,
    value: RosAnswerValue | undefined,
    parent?: RosQuestion,
  ) => void;
  onNote: (q: RosQuestion, note: string) => void;
}) {
  const { t } = useT();
  const [noteOpen, setNoteOpen] = useState(false);

  const response = responses.get(question.key);
  const value = response?.answer_value;
  const prompt = locale === "fr" ? question.prompt_fr : question.prompt_en;
  const followups = visibleFollowups(question, value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs">{prompt}</span>
        <div className="flex items-center gap-1.5">
          <RosAnswerControl
            question={question}
            value={value}
            locale={locale}
            disabled={disabled}
            onChange={(v) => onAnswer(question, v)}
          />
          {response && !disabled ? (
            <button
              type="button"
              aria-label={t("ros.addNote")}
              onClick={() => setNoteOpen((v) => !v)}
              className={`shrink-0 ${
                response.note || noteOpen
                  ? "text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
              }`}
            >
              <MessageSquarePlus className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {response && (noteOpen || response.note) ? (
        <Input
          defaultValue={response.note ?? ""}
          placeholder={t("ros.notePlaceholder")}
          disabled={disabled}
          onBlur={(e) => {
            onNote(question, e.target.value);
            if (!e.target.value.trim()) setNoteOpen(false);
          }}
          className="h-7 text-xs"
        />
      ) : null}

      {followups.length > 0 ? (
        <div className="ml-3 flex flex-col gap-1.5 border-l border-border pl-3 pt-1">
          {followups.map((f) => {
            const fPrompt = locale === "fr" ? f.prompt_fr : f.prompt_en;
            return (
              <div
                key={f.key}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <span className="text-xs text-muted-foreground">{fPrompt}</span>
                <RosAnswerControl
                  question={f}
                  value={responses.get(f.key)?.answer_value}
                  locale={locale}
                  disabled={disabled}
                  onChange={(v) => onAnswer(f, v, question)}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
