/**
 * Locale-aware formatting helpers — pure wrappers over the Intl APIs so the
 * same call works in client components (locale from `useLocale()`) and in pure
 * modules like `reports.ts` / `export.ts` (locale threaded as an argument).
 */

import type { Locale } from "./index";

const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  fr: "fr-FR",
};

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(
    toDate(value),
  );
}

export function formatDateTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(
    toDate(value),
  );
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], options).format(value);
}

/** `whole` is a 0–100 percentage (e.g. 87 → "87%" / "87 %"). */
export function formatPercent(
  whole: number,
  locale: Locale,
  maximumFractionDigits = 1,
): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: "percent",
    maximumFractionDigits,
  }).format(whole / 100);
}
