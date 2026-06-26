"use client";

/**
 * Segmented OTP input — one cell per digit, with auto-advance, backspace,
 * arrow-key navigation and paste-to-fill. Numeric only. Themed with the same
 * semantic tokens as the base Input so it adapts to light/dark.
 *
 * `length` must match the Supabase project's Email OTP Length (currently 6).
 */

import { useRef } from "react";

import { cn } from "@/lib/utils";

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  invalid = false,
  autoFocus = false,
  onComplete,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Fired once the last cell is filled (full code entered). */
  onComplete?: (value: string) => void;
  ariaLabel?: string;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const focusCell = (index: number) => {
    const el = inputs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const setValue = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1); // last typed digit
    if (!digit) return;
    const arr = digits.slice();
    arr[index] = digit;
    const next = setValue(arr.join("").slice(0, length));
    if (index < length - 1) focusCell(index + 1);
    else if (next.length === length) inputs.current[index]?.blur();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = digits.slice();
      if (arr[index]) {
        arr[index] = "";
        setValue(arr.join(""));
      } else if (index > 0) {
        arr[index - 1] = "";
        setValue(arr.join(""));
        focusCell(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCell(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const next = setValue(pasted);
    focusCell(Math.min(next.length, length - 1));
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-2"
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-12 w-10 rounded-lg border border-input bg-transparent text-center font-mono text-lg font-semibold tabular-nums transition-colors outline-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30",
            invalid &&
              "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
            "sm:w-11",
          )}
        />
      ))}
    </div>
  );
}
