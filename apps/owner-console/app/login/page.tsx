import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";
import { getPlatformAdmin } from "@/lib/auth";
import { Card, c } from "@/lib/ui";
import { GoogleSignIn, SignOutButton } from "./auth-buttons";

export const metadata = { title: "Sign in — CareFlow Owner Console" };

export default async function LoginPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already an authorized admin → straight to the dashboard.
  if (user) {
    const admin = await getPlatformAdmin();
    if (admin) redirect("/");
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "80px 24px" }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: c.muted,
          margin: "0 0 8px",
        }}
      >
        CareFlow · Platform owner
      </p>
      <h1 style={{ fontSize: 24, margin: "0 0 20px" }}>Owner Console</h1>
      <Card>
        {user ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, color: c.text, fontSize: 14 }}>
              Signed in as <strong>{user.email}</strong>, but this account isn&apos;t
              a platform admin.
            </p>
            <p style={{ margin: 0, color: c.faint, fontSize: 13 }}>
              Add this email to <code>PLATFORM_ADMIN_EMAILS</code> to grant access.
            </p>
            <div>
              <SignOutButton />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, color: c.muted, fontSize: 14 }}>
              Sign in with an authorized owner account to manage hospital tenants.
            </p>
            <GoogleSignIn />
          </div>
        )}
      </Card>
    </main>
  );
}
