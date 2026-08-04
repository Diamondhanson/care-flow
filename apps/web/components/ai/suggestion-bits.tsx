"use client";

/**
 * Small shared pieces for AI suggestion cards (Phase 22): confidence badge,
 * source chips, rationale line, disclaimer. All theme-token based — light and
 * dark both work, and the cf-accent signature stays reserved for the panel
 * header (never for clinical meaning).
 */

import { Badge } from "@/components/ui/badge";
import { useT } from "@/components/locale-provider";
import { msgKey } from "@/i18n";
import type { Confidence } from "@careflow/shared/types/ai";

/** Confidence → status token (calm, non-alarming mapping). */
const CONFIDENCE_TOKEN: Record<Confidence, string> = {
  low: "var(--status-warning)",
  moderate: "var(--status-diagnostics)",
  high: "var(--success)",
};

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const { t } = useT();
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 text-[10px] uppercase"
      style={{ color: CONFIDENCE_TOKEN[level] }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: CONFIDENCE_TOKEN[level] }}
      />
      {t(msgKey(`ai.confidence.${level}`))}
    </Badge>
  );
}

export function SourceChips({ sources }: { sources: string[] }) {
  const { t } = useT();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t("ai.sources")}
      </span>
      {sources.slice(0, 8).map((s) => (
        <span
          key={s}
          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export function WhyLine({ rationale }: { rationale: string }) {
  const { t } = useT();
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold">{t("ai.why")}: </span>
      {rationale}
    </p>
  );
}

export function AiDisclaimer() {
  const { t } = useT();
  return (
    <p className="border-t border-border pt-2 text-[11px] text-muted-foreground/80">
      {t("ai.disclaimer")}
    </p>
  );
}
