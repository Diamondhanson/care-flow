import type * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The clinical `--status-*` theme tokens defined in `app/globals.css`.
 * Every tone exists in both the `:root` (light) and `.dark` blocks, so a
 * StatusBadge adapts to theme changes automatically.
 */
export type StatusTone =
  | "boarding"
  | "treatment"
  | "diagnostics"
  | "discharge"
  | "clearance"
  | "warning"
  | "deceased";

/**
 * Centralizes the repeated status-chip recipes used across the app:
 *
 * - `soft` (default): tinted chip — `color: var(--status-X)` on a
 *   `color-mix(in oklab, var(--status-X) 16%, transparent)` background
 *   (the `statusBadgeStyle` recipe from the billing/diagnostics pages).
 * - `solid`: filled chip — `var(--status-X)` background with the matching
 *   `var(--status-X-foreground)` text (the live-board badge recipe).
 *   Note: `warning` has no `-foreground` token in globals.css, so use the
 *   `soft` variant for that tone.
 *
 * Sizes:
 * - `sm` (default): 10px uppercase chip, matching the existing
 *   `text-[10px] uppercase` badges.
 * - `md`: 11px chip for inline pills (e.g. the patient-card next-step nudge).
 *
 * Children may combine an icon and a label — the underlying Badge already
 * handles icon sizing (`[&>svg]:size-3`) and gap.
 */
export function StatusBadge({
  tone,
  variant = "soft",
  size = "sm",
  className,
  style,
  children,
}: {
  tone: StatusTone;
  variant?: "soft" | "solid";
  size?: "sm" | "md";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const toneStyle: React.CSSProperties =
    variant === "solid"
      ? {
          backgroundColor: `var(--status-${tone})`,
          color: `var(--status-${tone}-foreground)`,
        }
      : {
          color: `var(--status-${tone})`,
          backgroundColor: `color-mix(in oklab, var(--status-${tone}) 16%, transparent)`,
        };
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        size === "sm" ? "text-[10px] uppercase" : "text-[11px]",
        className,
      )}
      style={{ ...toneStyle, ...style }}
    >
      {children}
    </Badge>
  );
}
