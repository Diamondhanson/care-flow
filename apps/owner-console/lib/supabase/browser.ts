"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon) — used only to kick off owner sign-in
 *  (Google OAuth). The session lands in cookies for the server to read. */
export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
