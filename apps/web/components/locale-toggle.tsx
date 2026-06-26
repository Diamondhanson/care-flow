"use client";

import { useT, useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

/**
 * FR/EN toggle. Shows the locale it will switch *to*. Mount-guarded like
 * ThemeToggle: renders a stable label until hydrated to avoid a mismatch.
 */
export function LocaleToggle() {
  const { mounted, locale, setLocale } = useLocale();
  const { t } = useT();

  const next = locale === "en" ? "fr" : "en";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("shell.switchLanguage")}
      title={t("shell.switchLanguage")}
      onClick={() => setLocale(next)}
    >
      <span className="text-xs font-semibold uppercase tabular-nums">
        {mounted ? next : "fr"}
      </span>
    </Button>
  );
}
