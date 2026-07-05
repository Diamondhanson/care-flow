import type { CSSProperties, ReactNode } from "react";

/** Minimal dark palette for the console (mirrors the hospital app's slate base).
 *  Inline-styled for the MVP; a shared design system can come later. */
export const c = {
  bg: "#0f172a",
  card: "#1e293b",
  border: "#334155",
  text: "#f8fafc",
  muted: "#94a3b8",
  faint: "#64748b",
  accent: "#3f6fd6",
  danger: "#e0405a",
  ok: "#21a45a",
  warn: "#e0a106",
};

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: c.card,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  trial: c.warn,
  active: c.ok,
  suspended: c.danger,
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? c.muted;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color,
        border: `1px solid ${color}`,
      }}
    >
      {status}
    </span>
  );
}
