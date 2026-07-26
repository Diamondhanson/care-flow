/**
 * Shared render helpers for the jsdom component tests (*.domtest.tsx).
 *
 * Components under test translate through `useT`, so everything renders inside
 * a LocaleProvider. ThemeProvider is intentionally omitted — none of the tested
 * components read the resolved theme (they style via CSS tokens only).
 *
 * `withAuth: true` additionally wraps the tree in the real AuthProvider. The
 * dom setup file guarantees the Supabase env vars are ABSENT, so AuthProvider
 * takes its "backend not configured" path: no Supabase client is constructed
 * and children render immediately.
 */
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";

import { LocaleProvider } from "@/components/locale-provider";
import { AuthProvider } from "@/components/auth-provider";

export function renderWithProviders(
  ui: ReactElement,
  opts: { withAuth?: boolean } = {},
): RenderResult {
  const tree = opts.withAuth ? (
    <AuthProvider>
      <LocaleProvider>{ui}</LocaleProvider>
    </AuthProvider>
  ) : (
    <LocaleProvider>{ui}</LocaleProvider>
  );
  return render(tree);
}
