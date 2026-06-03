/**
 * i18n core — locale registry + a pure `translate()` used by the `useT()` hook.
 * Kept free of React/DOM so it is directly unit-testable in a node environment.
 */

import { en } from "./en";
import { fr } from "./fr";

export type Locale = "en" | "fr";

export const LOCALES: Locale[] = ["en", "fr"];

/** First-load / SSR locale. French is opt-in via the navbar toggle. */
export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, unknown> = { en, fr };

export type TParams = Record<string, string | number>;

/** Resolve a dot-path (e.g. "nav.intake") to a string, or undefined. */
function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Translate a key for a locale, falling back to the default locale's value and
 * finally to the raw key (so a missing string is visible rather than silently
 * blank). `{param}` placeholders are interpolated from `params`.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: TParams,
): string {
  const raw =
    lookup(DICTIONARIES[locale], key) ??
    lookup(DICTIONARIES[DEFAULT_LOCALE], key) ??
    key;
  return interpolate(raw, params);
}
