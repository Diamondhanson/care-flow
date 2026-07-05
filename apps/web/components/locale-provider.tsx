"use client";

/**
 * LocaleProvider — client-side locale state for the FR/EN UI, persisted to
 * localStorage. Mirrors RoleProvider's hydration discipline: it stays on the
 * DEFAULT_LOCALE until mounted so server + first-paint markup is identical to
 * the static `lang="en"` in the root layout (per AGENTS.md), then re-renders in
 * the stored locale.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALES,
  translate,
  type Locale,
  type TParams,
} from "@/i18n";

const STORAGE_KEY = "careflow_locale";

interface LocaleContextValue {
  /** False until the client has hydrated; guard locale-dependent UI with it. */
  mounted: boolean;
  /** The stored preference (defaults to DEFAULT_LOCALE before mount). */
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function isLocale(value: string | null): value is Locale {
  return value != null && (LOCALES as string[]).includes(value);
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (isLocale(saved)) setLocaleState(saved);
    setMounted(true);
  }, []);

  // Keep the document language in sync with the active locale.
  useEffect(() => {
    if (mounted) document.documentElement.lang = locale;
  }, [mounted, locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence errors (private mode, etc.) */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ mounted, locale, setLocale }),
    [mounted, locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}

export type TFunction = (key: string, params?: TParams) => string;

/**
 * The bound translate function for the active locale. Resolves against
 * DEFAULT_LOCALE until mounted so server/first-paint markup never mismatches.
 * `activeLocale` is exposed for date/number formatting at call sites.
 */
export function useT(): { t: TFunction; locale: Locale; mounted: boolean } {
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : DEFAULT_LOCALE;
  const t = useCallback<TFunction>(
    (key, params) => translate(activeLocale, key, params),
    [activeLocale],
  );
  return { t, locale: activeLocale, mounted };
}
