"use client";

/**
 * Public landing page (`/`). French-first marketing surface that introduces
 * CareFlow and routes visitors to {@link /signup} (create a hospital) or
 * {@link /login}. Built from the `marketing` i18n namespace and theme tokens.
 *
 * Visuals are on-brand product mockups (live board, reports panel) assembled
 * from the same `--status-*` / `--chart-*` / `--triage-*` tokens the real app
 * uses — so they adapt to light/dark and never drift from the product.
 */

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BedDouble,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Languages,
  Pill,
  Route,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
  WifiOff,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Decorative product mockups — pure presentation, no real patient data.
// ---------------------------------------------------------------------------

type StatusToken = "boarding" | "diagnostics" | "treatment" | "discharge";

interface MockColumn {
  labelKey: string;
  token: StatusToken;
  count: number;
  cards: { initials: string; triage: number }[];
}

const MOCK_COLUMNS: MockColumn[] = [
  {
    labelKey: "boardColumn.intake",
    token: "boarding",
    count: 5,
    cards: [
      { initials: "AO", triage: 2 },
      { initials: "KN", triage: 4 },
    ],
  },
  {
    labelKey: "boardColumn.consultation",
    token: "diagnostics",
    count: 3,
    cards: [
      { initials: "MB", triage: 3 },
      { initials: "SD", triage: 5 },
    ],
  },
  {
    labelKey: "boardColumn.treatment",
    token: "treatment",
    count: 4,
    cards: [
      { initials: "IA", triage: 1 },
      { initials: "FE", triage: 3 },
    ],
  },
  {
    labelKey: "boardColumn.discharge",
    token: "discharge",
    count: 2,
    cards: [{ initials: "OW", triage: 4 }],
  },
];

function BoardMockup() {
  const { t } = useT();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Activity className="size-4 text-primary" strokeWidth={2.25} />
        <span className="text-xs font-semibold">{t("marketing.mockBoardTitle")}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span
              className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
              style={{ backgroundColor: "var(--status-clearance)" }}
            />
            <span
              className="relative inline-flex size-2 rounded-full"
              style={{ backgroundColor: "var(--status-clearance)" }}
            />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            live
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {MOCK_COLUMNS.map((col) => (
          <div key={col.labelKey} className="rounded-lg bg-muted/50 p-2">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--status-${col.token})` }}
              />
              <span className="truncate text-[11px] font-medium">
                {t(col.labelKey)}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {col.count}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {col.cards.map((card, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card p-1.5"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[8px] font-semibold text-accent-foreground">
                    {card.initials}
                  </span>
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="h-1 w-full rounded-full bg-foreground/15" />
                    <span className="h-1 w-2/3 rounded-full bg-foreground/10" />
                  </span>
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--triage-${card.triage})` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MOCK_REPORT_ROWS = [
  { labelKey: "marketing.mockReportsAdmissions", value: "128", pct: 64, chart: 1 },
  { labelKey: "marketing.mockReportsOutpatients", value: "342", pct: 90, chart: 3 },
  { labelKey: "marketing.mockReportsOccupancy", value: "84%", pct: 84, chart: 4 },
];

const MOCK_BARS = [40, 62, 48, 80, 58, 92, 70];

function ReportsMockup() {
  const { t } = useT();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <BarChart3 className="size-4 text-primary" strokeWidth={2.25} />
        <span className="text-xs font-semibold">
          {t("marketing.mockReportsTitle")}
        </span>
      </div>
      <div className="p-4">
        {/* Faux weekly bar chart */}
        <div className="flex h-20 items-end gap-1.5">
          {MOCK_BARS.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${h}%`,
                backgroundColor: "var(--chart-1)",
                opacity: 0.35 + (h / 100) * 0.65,
              }}
            />
          ))}
        </div>
        {/* Stat rows with progress bars */}
        <div className="mt-4 flex flex-col gap-3">
          {MOCK_REPORT_ROWS.map((row) => (
            <div key={row.labelKey} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">
                  {t(row.labelKey)}
                </span>
                <span className="font-mono text-sm font-semibold">
                  {row.value}
                </span>
              </div>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${row.pct}%`,
                    backgroundColor: `var(--chart-${row.chart})`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface JourneyStep {
  icon: LucideIcon;
  token: StatusToken | "clearance";
  title: string;
  body: string;
}

interface Role {
  icon: LucideIcon;
  label: string;
  desc: string;
}

export default function LandingPage() {
  const { t } = useT();

  const stats = [
    { value: t("marketing.statRecordValue"), label: t("marketing.statRecordLabel") },
    { value: t("marketing.statRolesValue"), label: t("marketing.statRolesLabel") },
    {
      value: t("marketing.statBilingualValue"),
      label: t("marketing.statBilingualLabel"),
    },
    {
      value: t("marketing.statOfflineValue"),
      label: t("marketing.statOfflineLabel"),
    },
  ];

  const journey: JourneyStep[] = [
    {
      icon: UserPlus,
      token: "boarding",
      title: t("marketing.journeyStep1Title"),
      body: t("marketing.journeyStep1Body"),
    },
    {
      icon: Stethoscope,
      token: "diagnostics",
      title: t("marketing.journeyStep2Title"),
      body: t("marketing.journeyStep2Body"),
    },
    {
      icon: FlaskConical,
      token: "diagnostics",
      title: t("marketing.journeyStep3Title"),
      body: t("marketing.journeyStep3Body"),
    },
    {
      icon: Pill,
      token: "treatment",
      title: t("marketing.journeyStep4Title"),
      body: t("marketing.journeyStep4Body"),
    },
    {
      icon: ClipboardCheck,
      token: "clearance",
      title: t("marketing.journeyStep5Title"),
      body: t("marketing.journeyStep5Body"),
    },
  ];

  const features: Feature[] = [
    { icon: Route, title: t("marketing.f1Title"), body: t("marketing.f1Body") },
    { icon: Users, title: t("marketing.f2Title"), body: t("marketing.f2Body") },
    { icon: BedDouble, title: t("marketing.f3Title"), body: t("marketing.f3Body") },
    { icon: Languages, title: t("marketing.f4Title"), body: t("marketing.f4Body") },
    { icon: ShieldCheck, title: t("marketing.f5Title"), body: t("marketing.f5Body") },
    { icon: Zap, title: t("marketing.f6Title"), body: t("marketing.f6Body") },
  ];

  const roles: Role[] = [
    {
      icon: ClipboardList,
      label: t("marketing.roleReception"),
      desc: t("marketing.roleReceptionDesc"),
    },
    {
      icon: Activity,
      label: t("marketing.roleNurse"),
      desc: t("marketing.roleNurseDesc"),
    },
    {
      icon: Stethoscope,
      label: t("marketing.roleDoctor"),
      desc: t("marketing.roleDoctorDesc"),
    },
    {
      icon: FlaskConical,
      label: t("marketing.roleLab"),
      desc: t("marketing.roleLabDesc"),
    },
    {
      icon: Pill,
      label: t("marketing.rolePharmacy"),
      desc: t("marketing.rolePharmacyDesc"),
    },
    {
      icon: Building2,
      label: t("marketing.roleAdmin"),
      desc: t("marketing.roleAdminDesc"),
    },
  ];

  const heroPills = [
    { icon: WifiOff, label: t("marketing.statOfflineValue") },
    { icon: Languages, label: t("marketing.statBilingualValue") },
    { icon: ShieldCheck, label: t("marketing.f5Title") },
  ];

  return (
    <div className="w-full">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Soft dotted backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.4] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-16 text-center md:px-8 md:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {t("marketing.heroEyebrow")}
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            {t("marketing.heroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            {t("marketing.heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className={cn(buttonVariants({ size: "lg" }), "gap-2")}
            >
              {t("marketing.getStarted")}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="#journey"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              {t("marketing.heroExplore")}
            </Link>
          </div>
          {/* Trust pills */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {heroPills.map((pill) => {
              const Icon = pill.icon;
              return (
                <span
                  key={pill.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
                >
                  <Icon className="size-3.5" />
                  {pill.label}
                </span>
              );
            })}
          </div>

          {/* Hero product shot */}
          <div className="relative mx-auto mt-12 max-w-3xl">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-3xl opacity-60 blur-2xl"
              style={{
                background:
                  "linear-gradient(120deg, color-mix(in oklab, var(--status-boarding) 18%, transparent), color-mix(in oklab, var(--status-treatment) 18%, transparent))",
              }}
            />
            <BoardMockup />
          </div>
        </div>
      </section>

      {/* ===== Stat strip ===== */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-px px-4 md:grid-cols-4 md:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="px-2 py-8 text-center">
              <div className="font-mono text-3xl font-semibold tracking-tight md:text-4xl">
                {stat.value}
              </div>
              <p className="mx-auto mt-2 max-w-[16ch] text-xs text-muted-foreground">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Patient journey ===== */}
      <section
        id="journey"
        className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16 md:px-8 md:py-24"
      >
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {t("marketing.journeyEyebrow")}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
            {t("marketing.journeyTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t("marketing.journeySubtitle")}
          </p>
        </div>

        <ol className="relative mt-12 grid gap-8 md:grid-cols-5 md:gap-4">
          {/* Connecting line (desktop) */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-5 hidden h-px bg-border md:block"
          />
          {journey.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative flex flex-col md:items-center md:text-center">
                <span
                  className="relative z-10 flex size-10 items-center justify-center rounded-full border bg-card"
                  style={{
                    borderColor: `var(--status-${step.token})`,
                    color: `var(--status-${step.token})`,
                  }}
                >
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <div className="mt-3">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-0.5 text-sm font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-xs text-muted-foreground md:max-w-[22ch]">
                    {step.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ===== Showcase: live board ===== */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid w-full max-w-5xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:px-8 md:py-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              {t("marketing.showcaseBoardEyebrow")}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              {t("marketing.showcaseBoardTitle")}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              {t("marketing.showcaseBoardBody")}
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {[
                t("marketing.showcaseBoardPoint1"),
                t("marketing.showcaseBoardPoint2"),
                t("marketing.showcaseBoardPoint3"),
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--status-clearance)" }}
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <BoardMockup />
        </div>
      </section>

      {/* ===== Showcase: reports & beds ===== */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-20">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="order-2 md:order-1">
            <ReportsMockup />
          </div>
          <div className="order-1 md:order-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              {t("marketing.showcaseReportsEyebrow")}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              {t("marketing.showcaseReportsTitle")}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              {t("marketing.showcaseReportsBody")}
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {[
                t("marketing.showcaseReportsPoint1"),
                t("marketing.showcaseReportsPoint2"),
                t("marketing.showcaseReportsPoint3"),
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--status-clearance)" }}
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ===== Feature grid ===== */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-24">
          <div className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("marketing.featuresTitle")}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              {t("marketing.featuresSubtitle")}
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-foreground/20"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-foreground">
                    <Icon className="size-5" strokeWidth={2} />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== Roles band ===== */}
      <section className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-24">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("marketing.rolesTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            {t("marketing.rolesSubtitle")}
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <div
                key={role.label}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                  <Icon className="size-[18px]" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{role.label}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {role.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20 md:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 text-center md:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.5] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
              backgroundSize: "20px 20px",
            }}
          />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {t("marketing.ctaTitle")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
              {t("marketing.ctaBody")}
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className={cn(buttonVariants({ size: "lg" }), "gap-2")}
              >
                {t("marketing.getStarted")}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                {t("marketing.signIn")}
              </Link>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              {t("marketing.ctaNote")}
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        {t("marketing.footerNote")}
      </footer>
    </div>
  );
}
