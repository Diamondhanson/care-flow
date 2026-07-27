import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Shared chrome for the public legal pages (`/privacy`, `/terms`). Server
 * component — no hooks — so each page can stay static and export `metadata`.
 * Built from the same theme tokens + container widths as the landing page so it
 * adapts to light/dark and never drifts from the product's look.
 */
export function LegalShell({
  title,
  lastUpdated,
  intro,
  children,
  related,
}: {
  title: string;
  /** Human-readable date, e.g. "10 July 2026". */
  lastUpdated: string;
  /** Short plain-language summary shown under the title. */
  intro: React.ReactNode;
  /** The numbered <LegalSection> blocks. */
  children: React.ReactNode;
  /** Cross-link to the sibling legal page: { href, label }. */
  related: { href: string; label: string };
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 md:px-8 md:py-20">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to home
      </Link>

      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
        Legal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        {title}
      </h1>
      <p className="mt-3 font-mono text-xs text-muted-foreground">
        Last updated {lastUpdated}
      </p>

      {/* Placeholder disclaimer — this is a starting template, not legal advice. */}
      <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This document is a plain-language template provided as a starting point.
        It is not legal advice. Review and adapt it with qualified counsel — and
        replace the bracketed placeholders (company name, contact details,
        governing law) — before relying on it.
      </div>

      <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
        {intro}
      </p>

      <div className="mt-10 flex flex-col gap-8">{children}</div>

      <div className="mt-14 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={related.href}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          {related.label}
        </Link>
        <p className="text-xs text-muted-foreground">
          CareFlow — the hospital&apos;s own operational record.
        </p>
      </div>
    </div>
  );
}

/** One numbered section within a legal page. */
export function LegalSection({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        <span className="mr-2 font-mono text-sm text-muted-foreground">
          {String(n).padStart(2, "0")}
        </span>
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** A themed bullet list for use inside a LegalSection. */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted-foreground/50">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
