"use client";

/**
 * One tap-first answer control, switched on the question's `answer_type`
 * (Phase 21). Built entirely from existing atoms — no new design-system
 * dependencies. `onChange(undefined)` clears the answer (absence = "not
 * asked"): tapping the active side of a toggle, deselecting the last chip, or
 * clearing the field all un-ask the question.
 */

import { Minus, Plus } from "lucide-react";

import type { RosAnswerValue, RosQuestion } from "@careflow/shared";
import type { Locale } from "@/i18n";
import { unitLabel } from "@/lib/ros/state";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DURATION_UNITS = ["minutes", "hours", "days", "weeks", "months", "years"];

function optionLabel(
  q: RosQuestion,
  value: string,
  locale: Locale,
): string {
  const opt = (q.options ?? []).find((o) => o.value === value);
  if (!opt) return value;
  return locale === "fr" ? opt.label_fr : opt.label_en;
}

/** A small pressed/unpressed pill used for boolean sides and option chips. */
function Chip({
  pressed,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50 ${
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function RosAnswerControl({
  question,
  value,
  locale,
  disabled,
  onChange,
}: {
  question: RosQuestion;
  value: RosAnswerValue | undefined;
  locale: Locale;
  disabled?: boolean;
  onChange: (value: RosAnswerValue | undefined) => void;
}) {
  const { t } = useT();

  switch (question.type) {
    case "boolean":
      return (
        <div className="inline-flex gap-1">
          <Chip
            pressed={value === true}
            disabled={disabled}
            onClick={() => onChange(value === true ? undefined : true)}
          >
            {t("ros.yes")}
          </Chip>
          <Chip
            pressed={value === false}
            disabled={disabled}
            onClick={() => onChange(value === false ? undefined : false)}
          >
            {t("ros.no")}
          </Chip>
        </div>
      );

    case "single_select":
    case "scale":
      return (
        <div className="flex flex-wrap gap-1">
          {(question.options ?? []).map((o) => (
            <Chip
              key={o.value}
              pressed={value === o.value}
              disabled={disabled}
              onClick={() => onChange(value === o.value ? undefined : o.value)}
            >
              {locale === "fr" ? o.label_fr : o.label_en}
            </Chip>
          ))}
        </div>
      );

    case "multi_select": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1">
          {(question.options ?? []).map((o) => {
            const isOn = selected.includes(o.value);
            return (
              <Chip
                key={o.value}
                pressed={isOn}
                disabled={disabled}
                onClick={() => {
                  const next = isOn
                    ? selected.filter((v) => v !== o.value)
                    : [...selected, o.value];
                  onChange(next.length > 0 ? next : undefined);
                }}
              >
                {locale === "fr" ? o.label_fr : o.label_en}
              </Chip>
            );
          })}
        </div>
      );
    }

    case "duration":
    case "numeric": {
      const current =
        typeof value === "object" && value !== null && "value" in value
          ? value
          : null;
      const unit =
        current?.unit ?? (question.type === "duration" ? "days" : undefined);
      const setNumber = (n: number) => {
        if (Number.isNaN(n) || n < 0) return;
        onChange({ value: n, ...(unit ? { unit } : {}) });
      };
      return (
        <div className="inline-flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !current}
            className="size-7 p-0"
            aria-label="−"
            onClick={() => {
              if (!current) return;
              if (current.value <= 0) return;
              if (current.value === 1) {
                onChange(undefined);
                return;
              }
              setNumber(current.value - 1);
            }}
          >
            <Minus className="size-3" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            disabled={disabled}
            value={current ? String(current.value) : ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange(undefined);
                return;
              }
              setNumber(Number(raw));
            }}
            className="h-7 w-16 text-center font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="size-7 p-0"
            aria-label="+"
            onClick={() => setNumber((current?.value ?? 0) + 1)}
          >
            <Plus className="size-3" />
          </Button>
          {question.type === "duration" ? (
            <Select
              items={Object.fromEntries(
                DURATION_UNITS.map((u) => [u, unitLabel(u, locale)]),
              )}
              value={unit ?? "days"}
              onValueChange={(u) => {
                if (current) onChange({ value: current.value, unit: u as string });
              }}
            >
              <SelectTrigger
                className="h-7 w-fit gap-1 text-xs"
                disabled={disabled}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {unitLabel(u, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      );
    }

    case "date":
      return (
        <Input
          type="date"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="h-7 w-fit text-xs"
        />
      );

    case "text":
    default:
      return (
        <Input
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : ""}
          placeholder={t("ros.textPlaceholder")}
          onBlur={(e) => {
            const v = e.target.value.trim();
            onChange(v || undefined);
          }}
          className="h-7 text-xs"
        />
      );
  }
}

export { optionLabel };
