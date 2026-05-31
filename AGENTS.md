<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# CareFlow design conventions

**Every UI must support both light and dark mode — this is non-negotiable for all current and future work.**

- Theme is controlled by `next-themes` (class strategy) via `components/theme-provider.tsx`, with a toggle in the top navbar (`components/theme-toggle.tsx`). The `.dark` class on `<html>` activates dark tokens.
- Build all surfaces from the semantic theme tokens defined in `app/globals.css` (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-sidebar`, the `--status-*` clinical colors, etc.). **Never hardcode hex/oklch colors or one-off Tailwind palette classes (e.g. `bg-slate-900`, `text-zinc-50`) for foundational surfaces** — those don't adapt to theme changes.
- When you add a new color, define it as a CSS variable in **both** the `:root` (light) and `.dark` blocks of `globals.css`, then expose it through `@theme inline`.
- Any client component that reads the resolved theme must guard against hydration mismatch (mount check) and keep server/client markup identical until mounted.
- Aesthetic target: serious, clean, high-signal clinical operations tooling. Calm slate base, single restrained accent, generous spacing, `font-mono` (Geist Mono) for metrics/IDs/timestamps.
