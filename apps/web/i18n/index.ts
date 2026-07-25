/**
 * i18n core — locale registry + a pure `translate()` used by the `useT()` hook.
 * Kept free of React/DOM so it is directly unit-testable in a node environment.
 */

import { en, type Messages } from "./en";
import { fr } from "./fr";

/**
 * Every valid dot-path to a string leaf of the message dictionary.
 *
 * Keys are mapped over `keyof T & (string | number)` (not `& string`) because
 * the dictionary contains numeric literal keys (e.g. `liveBoard.triage` 1–5);
 * intersecting those with `string` alone would silently drop them. `${K}`
 * renders numeric keys in their string form, matching runtime dot-paths.
 */
type Paths<T> = {
  [K in keyof T & (string | number)]: T[K] extends string
    ? `${K}`
    : T[K] extends object
      ? `${K}.${Paths<T[K]>}`
      : never;
}[keyof T & (string | number)];

/** Compile-time-checked translation key — a typo'd key is a type error. */
export type MessageKey = Paths<Messages>;

/**
 * Boundary escape hatch for keys assembled from runtime data (e.g. audit-log
 * table names coming off the wire). If the resulting key is wrong, `translate`
 * falls back to displaying the raw key rather than crashing. Use sparingly —
 * statically known keys must stay as literals so the compiler checks them.
 */
export function msgKey(key: string): MessageKey {
  return key as MessageKey;
}

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
  key: MessageKey,
  params?: TParams,
): string {
  const raw =
    lookup(DICTIONARIES[locale], key) ??
    lookup(DICTIONARIES[DEFAULT_LOCALE], key) ??
    key;
  return interpolate(raw, params);
}
