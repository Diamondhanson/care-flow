"use client";

/**
 * GuidedTour (Phase 16) — a short, first-load orientation so the first five
 * minutes teach themselves, for real onboarding and for live demos. It is a
 * centered, step-through overlay (deliberately NOT anchored to DOM positions,
 * which are fragile across the responsive layout and locale text lengths).
 *
 * Shown once on first load, then dismissed permanently via localStorage — the
 * same private-mode-tolerant pattern as RoleProvider / LocaleProvider. A "?"
 * button in the navbar re-opens it any time (handy mid-demo) by dispatching the
 * `OPEN_TOUR_EVENT` window event, which this component listens for.
 *
 * Hydration discipline (AGENTS.md): nothing renders until `mounted`, so server
 * and first-paint markup stay identical and there is no mismatch warning.
 */

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  MousePointerClick,
  ClipboardPlus,
  Languages,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";

const STORAGE_KEY = "careflow_tour_seen";

/** Dispatch to (re-)open the tour, e.g. from the navbar help button. */
export const OPEN_TOUR_EVENT = "careflow:open-tour";

interface TourStep {
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string;
  /** Suffix of a `--status-{token}` accent for the step's icon chip. */
  token: "boarding" | "diagnostics" | "treatment" | "discharge";
}

const STEPS: readonly TourStep[] = [
  {
    icon: LayoutDashboard,
    titleKey: "tour.boardTitle",
    bodyKey: "tour.boardBody",
    token: "boarding",
  },
  {
    icon: MousePointerClick,
    titleKey: "tour.cardTitle",
    bodyKey: "tour.cardBody",
    token: "diagnostics",
  },
  {
    icon: ClipboardPlus,
    titleKey: "tour.registerTitle",
    bodyKey: "tour.registerBody",
    token: "treatment",
  },
  {
    icon: Languages,
    titleKey: "tour.switchTitle",
    bodyKey: "tour.switchBody",
    token: "discharge",
  },
] as const;

export function GuidedTour() {
  const { t } = useT();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // First-load check + replay listener. Runs once after hydration.
  useEffect(() => {
    setMounted(true);
    let seen = false;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);

    const onReplay = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, onReplay);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, onReplay);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode — fine, tour just shows again next load */
    }
  }, []);

  // Escape closes (counts as dismissal); lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismiss]);

  if (!mounted || !open) return null;

  const step = STEPS[index];
  const Icon = step.icon;
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
    >
      {/* Backdrop — clicking it skips the tour. */}
      <button
        type="button"
        aria-label={t("tour.skip")}
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-sm"
      />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("tour.skip")}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <span
          className="inline-flex size-12 items-center justify-center rounded-lg"
          style={{
            backgroundColor: `var(--status-${step.token})`,
            color: `var(--status-${step.token}-foreground)`,
          }}
        >
          <Icon className="size-6" />
        </span>

        <h2
          id="tour-title"
          className="mt-4 text-lg font-semibold tracking-tight text-foreground"
        >
          {t(step.titleKey)}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t(step.bodyKey)}
        </p>

        {/* Step dots */}
        <div className="mt-5 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.titleKey}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === index ? "1.25rem" : "0.375rem",
                backgroundColor:
                  i === index ? "var(--primary)" : "var(--border)",
              }}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("tour.step", { n: index + 1, total: STEPS.length })}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                {t("tour.back")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={dismiss}>
                {t("tour.skip")}
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={dismiss}>
                {t("tour.done")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                {t("tour.next")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Navbar "?" button that replays the tour. Render inside the app shell. */
export function TourHelpButton() {
  const { t } = useT();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("tour.help")}
      title={t("tour.help")}
      onClick={() => window.dispatchEvent(new Event(OPEN_TOUR_EVENT))}
    >
      <span className="text-base font-semibold leading-none">?</span>
    </Button>
  );
}
