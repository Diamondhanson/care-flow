import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { RealtimeEngine } from "@/components/pwa/realtime-engine";

/**
 * Layout for the authenticated dashboard. Everything under `(app)` is gated by
 * {@link RequireAuth} and framed by the {@link AppShell} (sidebar + navbar).
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <RealtimeEngine />
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
