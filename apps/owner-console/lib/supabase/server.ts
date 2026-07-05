import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Cookie-bound Supabase client for the owner console's SERVER side (RSC, route
 * handlers, server actions). Carries the signed-in owner's session so
 * `auth.getUser()` resolves who is acting. This is the ANON client — it never
 * reads cross-tenant data; that goes through the service-role admin client
 * behind a `requirePlatformAdmin()` guard.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        toSet: { name: string; value: string; options?: CookieOptions }[],
      ) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only — safe to
          // ignore; the session is refreshed in the route handler / middleware.
        }
      },
    },
  });
}
