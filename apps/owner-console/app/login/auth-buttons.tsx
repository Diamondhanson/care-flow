"use client";

import { getBrowserSupabase } from "@/lib/supabase/browser";
import { c } from "@/lib/ui";

export function GoogleSignIn() {
  async function signIn() {
    await getBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button
      type="button"
      onClick={signIn}
      style={{
        width: "100%",
        padding: "10px 16px",
        borderRadius: 8,
        border: `1px solid ${c.border}`,
        background: c.accent,
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Continue with Google
    </button>
  );
}

export function SignOutButton() {
  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button
      type="button"
      onClick={signOut}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        border: `1px solid ${c.border}`,
        background: "transparent",
        color: c.muted,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}
