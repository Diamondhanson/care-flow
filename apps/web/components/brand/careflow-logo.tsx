/**
 * CareFlow brand marks — the single source of truth for the logo in the UI.
 *
 * The symbol is a geometric "C" drawn as one continuous flowing channel with a
 * bright node riding at its head: a patient tracked through the journey, from
 * admission to follow-up. See the brand guide for spacing, colour and usage.
 *
 * `CareFlowMark`  — the symbol on its own (sidebar, small spaces, splash).
 * `CareFlowLogo`  — the mark + "CareFlow" wordmark lockup (headers, auth).
 *
 * Colour: by default the mark is two-tone Signal Cyan (channel + brighter node),
 * which reads on both the light and dark canvas. Pass `variant="mono"` for a
 * single-colour version that inherits `currentColor` (exported reports, one-ink).
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "color" | "mono";

/** Geometry: design space 1000×1000, centred (500,500). Arc R=300, stroke 150,
 *  node r=103 at the top terminal (40°); the bottom terminal (−40°) is round-capped. */
export function CareFlowMark({
  className,
  variant = "color",
  title,
}: {
  className?: string;
  variant?: Variant;
  title?: string;
}) {
  const channel = variant === "mono" ? "currentColor" : "var(--cf-accent-deep)";
  const node = variant === "mono" ? "currentColor" : "var(--cf-accent-bright)";
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M 729.81 307.16 A 300 300 0 1 1 729.81 692.84"
        stroke={channel}
        strokeWidth={150}
        strokeLinecap="round"
      />
      <circle cx="729.81" cy="307.16" r="103" fill={node} />
    </svg>
  );
}

/**
 * The mark inside the app's slate tile — matches the installed app icon, used
 * where the logo needs a solid ground (auth headers, splash).
 */
export function CareFlowTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-md bg-primary shadow-sm",
        className
      )}
    >
      <CareFlowMark className="size-[62%]" />
    </span>
  );
}

/**
 * Full horizontal lockup: mark + "CareFlow" wordmark (Geist, the app typeface).
 * `subtitle` renders a small line beneath the wordmark (e.g. the status-board
 * label in the sidebar). `href` wraps the lockup in a link when provided.
 */
export function CareFlowLogo({
  className,
  markClassName,
  subtitle,
  href,
  onClick,
  wordmarkClassName,
}: {
  className?: string;
  markClassName?: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  wordmarkClassName?: string;
}) {
  const inner = (
    <>
      <CareFlowTile className={cn("size-9", markClassName)} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "text-[15px] font-semibold tracking-tight text-foreground",
            wordmarkClassName
          )}
        >
          CareFlow
        </span>
        {subtitle ? (
          <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cn("flex items-center gap-2.5", className)}
      >
        {inner}
      </Link>
    );
  }
  return <span className={cn("flex items-center gap-2.5", className)}>{inner}</span>;
}
