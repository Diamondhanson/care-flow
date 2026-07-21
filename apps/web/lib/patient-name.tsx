/**
 * Patient-name presentation — one place that owns how a person's name looks
 * everywhere in CareFlow. Two design rules (non-negotiable, see the product
 * brief): a patient's name is always Title Cased, and it is rendered in the
 * distinct `--patient-name` teal so it is instantly pickable out of the
 * surrounding clinical text (in both light and dark mode).
 */
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Title Case a patient's name: "JOHN DOE" / "john doe" → "John Doe". Capitalises
 * the first letter after a space, hyphen, apostrophe, or dot so compound names
 * ("mary-jane", "o'brien") render correctly. Returns "" for blank input.
 */
export function formatPatientName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'’.])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface PatientNameProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** The name (or anonymous label) to display. */
  name: string | null | undefined;
  /**
   * Title Case the name before rendering (default true). Pass false for an
   * anonymous placeholder / identifier that should keep its exact casing.
   */
  format?: boolean;
}

/**
 * Render a patient's name in the shared teal, always Title Cased. Use this
 * everywhere a patient name appears so the two rules stay consistent.
 */
export function PatientName({
  name,
  format = true,
  className,
  ...props
}: PatientNameProps) {
  const text = format ? formatPatientName(name) : name ?? "";
  return (
    <span className={cn("font-medium text-patient-name", className)} {...props}>
      {text}
    </span>
  );
}
