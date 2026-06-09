"use client";

/**
 * Clinical-term autocomplete (Phase 16.10).
 *
 * Two surfaces share one combobox engine:
 *
 *  - `TermAutocomplete` — a controlled single-line combobox. The parent owns the
 *    text (`value`/`onChange`); picking a suggestion additionally fires
 *    `onSelectTerm(term)` so callers can autofill sibling fields (drug → dose /
 *    route / frequency, investigation → order type, diagnosis → ICD-10 code).
 *
 *  - `TermChips` — a multi-add field built on the engine: each pick (or typed
 *    free-text + Enter) becomes a removable chip. The chip set is serialized to a
 *    newline-joined string so it drops straight into the existing free-text SOAP
 *    fields with no data-model change.
 *
 * Matching/ranking and the learned store live in `lib/clinical-terms`; this file
 * is purely the UI (dropdown, keyboard nav, debounce, theming). All colours come
 * from semantic tokens so light/dark both work.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/components/locale-provider";
import {
  addCustomTerm,
  recordTermUse,
  searchTerms,
} from "@/lib/clinical-terms";
import { displayTerm } from "@/lib/clinical-terms/search";
import type { ClinicalTerm, ClinicalTermCategory } from "@/types/healthcare";

/** A short secondary line for a suggestion (ICD-10, dose·route, order type, system). */
function termMeta(term: ClinicalTerm): string | null {
  if (term.icd10) return term.icd10;
  if (term.dose || term.route) {
    return [term.dose, term.route].filter(Boolean).join(" · ") || null;
  }
  if (term.order_type) return term.order_type;
  if (term.system) return term.system;
  return null;
}

// ---------------------------------------------------------------------------
// Core combobox
// ---------------------------------------------------------------------------

export interface TermAutocompleteProps {
  category: ClinicalTermCategory;
  /** Controlled input text. */
  value: string;
  onChange: (value: string) => void;
  /** Fired when a suggestion is picked (in addition to `onChange`). */
  onSelectTerm?: (term: ClinicalTerm) => void;
  /** Fired when Enter is pressed on free text with no highlighted suggestion. */
  onCommit?: (label: string) => void;
  placeholder?: string;
  id?: string;
  inputClassName?: string;
  /** Max suggestions to show. */
  limit?: number;
  /** Clear the input after a pick/commit (used by the chip field). */
  clearOnSelect?: boolean;
}

export function TermAutocomplete({
  category,
  value,
  onChange,
  onSelectTerm,
  onCommit,
  placeholder,
  id,
  inputClassName,
  limit = 8,
  clearOnSelect = false,
}: TermAutocompleteProps) {
  const { locale } = useT();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // ~100ms debounce so each keystroke doesn't re-rank the whole list.
  const [query, setQuery] = useState(value);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  useEffect(() => {
    const handle = setTimeout(() => setQuery(value), 100);
    return () => clearTimeout(handle);
  }, [value]);

  const results = useMemo(
    () => searchTerms(category, query, locale, { limit }),
    [category, query, locale, limit],
  );

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  function pick(term: ClinicalTerm) {
    recordTermUse(category, term);
    onChange(clearOnSelect ? "" : displayTerm(term, locale));
    onSelectTerm?.(term);
    setOpen(false);
    setHighlight(-1);
  }

  function commitFreeText() {
    const label = value.trim();
    if (!label) return;
    onCommit?.(label);
    if (clearOnSelect) onChange("");
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && results[highlight]) {
        e.preventDefault();
        pick(results[highlight]);
      } else if (onCommit) {
        e.preventDefault();
        commitFreeText();
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setHighlight(-1);
      }
    }
  }

  const showDropdown = open && results.length > 0;

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a suggestion lands before we close.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
      />
      {showDropdown ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {results.map((term, i) => {
            const label = displayTerm(term, locale);
            const meta = termMeta(term);
            return (
              <li key={`${term.category}:${term.term_en}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so it fires before the input blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(term);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                    i === highlight ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  <span className="truncate">{label}</span>
                  {meta ? (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {meta}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-add chip field (SOAP)
// ---------------------------------------------------------------------------

export interface TermChipsProps {
  category: ClinicalTermCategory;
  /** Serialized chips: one entry per line. */
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  id?: string;
  placeholder?: string;
}

/** Split/join the newline-serialized chip string. */
function splitChips(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function TermChips({
  category,
  value,
  onValueChange,
  label,
  id,
  placeholder,
}: TermChipsProps) {
  const { locale } = useT();
  const [text, setText] = useState("");
  const chips = useMemo(() => splitChips(value), [value]);

  function addChip(chipLabel: string, term?: ClinicalTerm) {
    const trimmed = chipLabel.trim();
    if (!trimmed) return;
    // De-dupe case-insensitively against what's already there.
    if (chips.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setText("");
      return;
    }
    if (term) recordTermUse(category, term);
    else addCustomTerm(category, trimmed);
    onValueChange([...chips, trimmed].join("\n"));
    setText("");
  }

  function removeChip(index: number) {
    onValueChange(chips.filter((_, i) => i !== index).join("\n"));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <li key={`${chip}-${i}`}>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 py-0.5 pl-2 pr-1 text-xs">
                {chip}
                <button
                  type="button"
                  onClick={() => removeChip(i)}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label={`Remove ${chip}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <TermAutocomplete
        id={id}
        category={category}
        value={text}
        onChange={setText}
        onSelectTerm={(term) => addChip(displayTerm(term, locale), term)}
        onCommit={(freeText) => addChip(freeText)}
        placeholder={placeholder}
        clearOnSelect
      />
    </div>
  );
}
