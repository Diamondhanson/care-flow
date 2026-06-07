"use client";

/**
 * Public landing page (`/`). French-first marketing surface that introduces
 * CareFlow and routes visitors to {@link /signup} (create a hospital) or
 * {@link /login}. Built from the `marketing` i18n namespace and theme tokens.
 */

import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  Languages,
  Route,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

export default function LandingPage() {
  const { t } = useT();

  const features: Feature[] = [
    { icon: Route, title: t("marketing.f1Title"), body: t("marketing.f1Body") },
    { icon: Users, title: t("marketing.f2Title"), body: t("marketing.f2Body") },
    {
      icon: BedDouble,
      title: t("marketing.f3Title"),
      body: t("marketing.f3Body"),
    },
    {
      icon: Languages,
      title: t("marketing.f4Title"),
      body: t("marketing.f4Body"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8">
      {/* Hero */}
      <section className="flex flex-col items-center py-16 text-center md:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {t("marketing.heroEyebrow")}
        </p>
        <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {t("marketing.heroTitle")}
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
          {t("marketing.heroSubtitle")}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
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
        <p className="mt-6 text-xs text-muted-foreground">
          {t("marketing.heroNote")}
        </p>
      </section>

      {/* Features */}
      <section className="pb-16 md:pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
          {t("marketing.featuresTitle")}
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6"
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
      </section>

      {/* CTA */}
      <section className="pb-20">
        <div className="rounded-2xl border border-border bg-card p-8 text-center md:p-12">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("marketing.ctaTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
            {t("marketing.ctaBody")}
          </p>
          <Link
            href="/signup"
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-6 gap-2"
            )}
          >
            {t("marketing.getStarted")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        {t("marketing.footerNote")}
      </footer>
    </div>
  );
}
