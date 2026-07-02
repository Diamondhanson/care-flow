import { NextResponse, type NextRequest } from "next/server";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth return: exchange the PKCE code for a session (written to cookies by the
 * server client), then send the owner to the dashboard. Authorization itself is
 * enforced on the dashboard via `requirePlatformAdmin()`.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await getServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", request.url));
}
